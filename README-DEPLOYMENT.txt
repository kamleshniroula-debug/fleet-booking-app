PRINCE VEHICLE RENTAL — FOUR-PANEL RELEASE
November 2026 | Midnight Mist theme

CONTENTS
index.html                 Main fleet dashboard (unchanged original upload)
rental-admin.html          Rental company administrator panel
rental-partner.html        Rental company partner portal
staff.html                 Staff request panel
manifest.webmanifest       Installable-app manifest
icons/                    PWA icons generated from supplied logo
sql/01-rental-companies.sql
sql/02-rental-admin-permissions.sql

NO SEPARATE CUSTOMER PANEL IS INCLUDED. Existing customer records in the main dashboard remain untouched.

DEPLOYMENT (GitHub Pages)
1. Back up the existing GitHub repository and Supabase data first.
2. Upload the HTML files, manifest and icons to the repository root. Preserve all other existing website assets and JS libraries; do not delete files from the existing repository.
3. In Supabase SQL Editor, review then execute 01 and then 02, ONLY if these migrations are not already applied. They create/manage partner tables and permissions. Do not rerun unrelated older SQL migrations.
4. Supabase Authentication > URL Configuration: authorize your deployed GitHub Pages origin and redirect URLs for all four pages.
5. Test Google sign-in with separate administrator, staff and partner accounts. Test permissions and company isolation. Test requests with sample data before inviting external partners.

SECURITY / NOT YET LIVE-COMPLETE
- Partner booking requests are REQUESTS ONLY, not confirmed fleet bookings.
- Approve buttons remain disabled: OneDrive Excel booking confirmation and atomic overlap prevention are not implemented in the supplied code.
- This release does NOT deploy to GitHub, change Supabase, or prove live Google sign-in or database policies.
- The main dashboard still references jszip.min.js. Keep the existing copy in your repository; it is not included in this package.
- The supplied main dashboard has not been altered. Some pages may contain existing animation assets inherited from their previous versions.
- Customer request functionality in the main dashboard is preserved. Only the standalone customer portal is excluded.
- SQL migrations assume existing pvr_members and pvr_public_vehicles tables; verify before executing.

LINKS AFTER DEPLOYMENT (assuming current repository)
https://kamleshniroula-debug.github.io/fleet-booking-app/
https://kamleshniroula-debug.github.io/fleet-booking-app/rental-admin.html
https://kamleshniroula-debug.github.io/fleet-booking-app/rental-partner.html
https://kamleshniroula-debug.github.io/fleet-booking-app/staff.html
