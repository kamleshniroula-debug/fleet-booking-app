-- Run AFTER rental-company-setup.sql. This grants only verified active admins
-- management of companies and partner login assignments.
-- Does NOT grant approval or booking confirmation rights.
grant insert, update on public.pvr_rental_companies to authenticated;
grant insert, update on public.pvr_partner_members to authenticated;

drop policy if exists pvr_companies_admin_insert on public.pvr_rental_companies;
create policy pvr_companies_admin_insert on public.pvr_rental_companies
 for insert to authenticated with check (public.pvr_is_active_admin());
drop policy if exists pvr_companies_admin_update on public.pvr_rental_companies;
create policy pvr_companies_admin_update on public.pvr_rental_companies
 for update to authenticated using (public.pvr_is_active_admin())
 with check (public.pvr_is_active_admin());
drop policy if exists pvr_partner_members_admin_insert on public.pvr_partner_members;
create policy pvr_partner_members_admin_insert on public.pvr_partner_members
 for insert to authenticated with check (public.pvr_is_active_admin());
drop policy if exists pvr_partner_members_admin_update on public.pvr_partner_members;
create policy pvr_partner_members_admin_update on public.pvr_partner_members
 for update to authenticated using (public.pvr_is_active_admin())
 with check (public.pvr_is_active_admin());
