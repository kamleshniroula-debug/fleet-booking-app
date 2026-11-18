-- Applied in production by Supabase migration 20261118060416.

grant update (status) on public.pvr_partner_requests to authenticated;

create policy pvr_requests_approve_saved_booking on public.pvr_partner_requests
  for update to authenticated
  using ((select public.pvr_is_active_admin()) and status = 'pending')
  with check (
    (select public.pvr_is_active_admin())
    and status = 'approved'
    and exists (
      select 1
      from public.pvr_workbook_snapshots as snapshot
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(snapshot.payload #> '{sheets,Bookings}') = 'array'
          then snapshot.payload #> '{sheets,Bookings}' else '[]'::jsonb end
      ) as saved(booking)
      where snapshot.user_id = (select auth.uid())
        and saved.booking ->> 'Booking ID' = 'BKG-PARTNER-' || pvr_partner_requests.request_id::text
        and saved.booking ->> 'Vehicle ID' = pvr_partner_requests.vehicle_id
        and saved.booking ->> 'Start AD' = pvr_partner_requests.start_ad::text
        and saved.booking ->> 'End AD Exclusive' = pvr_partner_requests.end_ad_exclusive::text
        and saved.booking ->> 'Status' = 'Active'
    )
  );
