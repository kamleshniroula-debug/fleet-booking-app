begin;

create table if not exists public.pvr_staff_expenses (
  id uuid primary key,
  submitted_by uuid not null,
  vehicle_id text not null,
  bill_date date not null,
  total_npr numeric(12,2) not null check (total_npr > 0),
  kind text not null check (kind in ('washing', 'extra')),
  note text not null check (char_length(note) <= 250),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
alter table public.pvr_staff_expenses enable row level security;
revoke all on public.pvr_staff_expenses from public, anon, authenticated;

create or replace function public.pvr_staff_submit_expense(
  p_id uuid, p_vehicle_id text, p_bill_date date, p_total_npr numeric, p_kind text, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  staff_state jsonb;
  expense_note text := btrim(coalesce(p_note, ''));
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
  if p_kind is null or p_kind not in ('washing', 'extra') then
    raise exception 'Choose a valid expense type.';
  end if;
  if char_length(expense_note) > 250 or (p_kind = 'extra' and expense_note = '') then
    raise exception 'Enter a description of up to 250 characters for an extra expense.';
  end if;
  insert into public.pvr_staff_expenses(id, submitted_by, vehicle_id, bill_date, total_npr, kind, note)
  values (p_id, auth.uid(), p_vehicle_id, p_bill_date, p_total_npr, p_kind, expense_note)
  on conflict (id) do nothing;
  if not exists (
    select 1 from public.pvr_staff_expenses b where b.id = p_id
      and b.submitted_by = auth.uid() and b.vehicle_id = p_vehicle_id
      and b.bill_date = p_bill_date and b.total_npr = p_total_npr
      and b.kind = p_kind and b.note = expense_note
  ) then raise exception 'This bill ID was already used for a different entry.'; end if;
end;
$$;

create or replace function public.pvr_staff_admin_expenses_pending()
returns table(id uuid, vehicle_id text, bill_date date, total_npr numeric, kind text, note text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Administrator sign-in required.'; end if;
  perform public.pvr_staff_admin_pending();
  return query select b.id, b.vehicle_id, b.bill_date, b.total_npr, b.kind, b.note
    from public.pvr_staff_expenses b where b.applied_at is null order by b.created_at, b.id;
end;
$$;

create or replace function public.pvr_staff_admin_expenses_ack(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Administrator sign-in required.'; end if;
  perform public.pvr_staff_admin_pending();
  update public.pvr_staff_expenses b set applied_at = now()
    where b.applied_at is null and b.id = any(p_ids);
end;
$$;

revoke all on function public.pvr_staff_submit_expense(uuid,text,date,numeric,text,text),
  public.pvr_staff_admin_expenses_pending(), public.pvr_staff_admin_expenses_ack(uuid[]) from public, anon;
grant execute on function public.pvr_staff_submit_expense(uuid,text,date,numeric,text,text),
  public.pvr_staff_admin_expenses_pending(), public.pvr_staff_admin_expenses_ack(uuid[]) to authenticated;
commit;
