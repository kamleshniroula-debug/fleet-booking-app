begin;

create table if not exists public.pvr_staff_charging_bills (
  id uuid primary key,
  submitted_by uuid not null,
  vehicle_id text not null,
  bill_date date not null,
  total_npr numeric(12,2) not null check (total_npr > 0),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
alter table public.pvr_staff_charging_bills enable row level security;
revoke all on public.pvr_staff_charging_bills from public, anon, authenticated;

create or replace function public.pvr_staff_submit_charging_bill(
  p_id uuid, p_vehicle_id text, p_bill_date date, p_total_npr numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare
  staff_state jsonb;
begin
  if auth.uid() is null then raise exception 'Staff sign-in required.'; end if;
  select to_jsonb(public.pvr_staff_state()) into staff_state;
  if not coalesce((staff_state->>'fresh')::boolean, false) then
    raise exception 'Ask the administrator to refresh the workbook before recording a bill.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(staff_state->'vehicles') v
    where v->>'Vehicle ID' = p_vehicle_id
  ) then raise exception 'Choose a vehicle from the fleet.'; end if;
  if p_bill_date is null or p_bill_date > (now() at time zone 'Asia/Kathmandu')::date then
    raise exception 'Choose today or an earlier bill date.';
  end if;
  if p_total_npr is null or p_total_npr <= 0 or p_total_npr >= 10000000000
     or p_total_npr <> round(p_total_npr, 2) then
    raise exception 'Enter a positive cost with up to two decimal places.';
  end if;
  insert into public.pvr_staff_charging_bills(id, submitted_by, vehicle_id, bill_date, total_npr)
  values (p_id, auth.uid(), p_vehicle_id, p_bill_date, p_total_npr)
  on conflict (id) do nothing;
  if not exists (
    select 1 from public.pvr_staff_charging_bills b where b.id = p_id
      and b.submitted_by = auth.uid() and b.vehicle_id = p_vehicle_id
      and b.bill_date = p_bill_date and b.total_npr = p_total_npr
  ) then raise exception 'This bill ID was already used for a different entry.'; end if;
end;
$$;

create or replace function public.pvr_staff_admin_charging_pending()
returns table(id uuid, vehicle_id text, bill_date date, total_npr numeric)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Administrator sign-in required.'; end if;
  perform public.pvr_staff_admin_pending();
  return query select b.id, b.vehicle_id, b.bill_date, b.total_npr
    from public.pvr_staff_charging_bills b where b.applied_at is null order by b.created_at, b.id;
end;
$$;

create or replace function public.pvr_staff_admin_charging_ack(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Administrator sign-in required.'; end if;
  perform public.pvr_staff_admin_pending();
  update public.pvr_staff_charging_bills b set applied_at = now()
    where b.applied_at is null and b.id = any(p_ids);
end;
$$;

revoke all on function public.pvr_staff_submit_charging_bill(uuid,text,date,numeric),
  public.pvr_staff_admin_charging_pending(), public.pvr_staff_admin_charging_ack(uuid[]) from public, anon;
grant execute on function public.pvr_staff_submit_charging_bill(uuid,text,date,numeric),
  public.pvr_staff_admin_charging_pending(), public.pvr_staff_admin_charging_ack(uuid[]) to authenticated;
commit;
