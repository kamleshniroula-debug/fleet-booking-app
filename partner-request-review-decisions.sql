create table pvr_partner_security.request_review_claims (
  request_id uuid primary key references public.pvr_partner_requests(request_id) on delete cascade,
  token uuid not null,
  reviewer uuid not null,
  claimed_at timestamptz not null
);
alter table pvr_partner_security.request_review_claims enable row level security;
revoke all on pvr_partner_security.request_review_claims from public, anon, authenticated;

create function pvr_partner_security.review_partner_request(p_request_id uuid, p_claim uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer uuid := auth.uid();
  request_status text;
  claim pvr_partner_security.request_review_claims%rowtype;
begin
  if reviewer is null or not coalesce(public.pvr_is_active_admin(), false) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_claim is null or p_action is null or p_action not in ('claim', 'reject') then
    raise exception 'Invalid review action.' using errcode = '22023';
  end if;

  select status into request_status from public.pvr_partner_requests where request_id = p_request_id for update;
  if not found or request_status <> 'pending' then
    raise exception 'This request is no longer pending. Close the review and refresh the inbox.';
  end if;

  select * into claim from pvr_partner_security.request_review_claims where request_id = p_request_id;

  if p_action = 'claim' then
    if claim.token is not null
       and (claim.token <> p_claim or claim.reviewer <> reviewer)
       and claim.claimed_at > now() - interval '5 minutes' then
      raise exception 'This request is being reviewed in another session. Try again in a few minutes.';
    end if;
    insert into pvr_partner_security.request_review_claims(request_id, token, reviewer, claimed_at)
      values (p_request_id, p_claim, reviewer, now())
      on conflict (request_id) do update
        set token = excluded.token, reviewer = excluded.reviewer, claimed_at = excluded.claimed_at;
    return;
  end if;

  if claim.token is distinct from p_claim or claim.reviewer is distinct from reviewer
     or claim.claimed_at <= now() - interval '5 minutes' then
    raise exception 'The review expired. Try again.';
  end if;
  if exists (
    select 1 from public.pvr_workbook_snapshots as snapshot
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(snapshot.payload #> '{sheets,Bookings}') = 'array'
        then snapshot.payload #> '{sheets,Bookings}' else '[]'::jsonb end
    ) as saved(booking)
    where saved.booking ->> 'Booking ID' = 'BKG-PARTNER-' || p_request_id::text
  ) then
    raise exception 'A booking already exists for this request. Review the booking before changing its request status.';
  end if;

  update public.pvr_partner_requests set status = 'rejected' where request_id = p_request_id;
  delete from pvr_partner_security.request_review_claims where request_id = p_request_id;
end;
$$;

revoke all on function pvr_partner_security.review_partner_request(uuid, uuid, text) from public, anon;
grant execute on function pvr_partner_security.review_partner_request(uuid, uuid, text) to authenticated;

create function public.pvr_review_partner_request(p_request_id uuid, p_claim uuid, p_action text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select pvr_partner_security.review_partner_request(p_request_id, p_claim, p_action);
$$;

revoke all on function public.pvr_review_partner_request(uuid, uuid, text) from public, anon;
grant execute on function public.pvr_review_partner_request(uuid, uuid, text) to authenticated;
