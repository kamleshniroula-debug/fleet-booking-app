PRINCE VEHICLE RENTAL — EMAIL-BASED PARTNER ACCESS

1. Back up your Supabase project and existing GitHub pages.
2. Run setup.sql in Supabase SQL Editor once.
3. In Supabase Edge Functions, create a function named partner-email-access.
   Paste the contents of index.ts and deploy with Verify JWT enabled.
   Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are available as server-side secrets.
   Never paste the service-role key into an HTML file.
4. Upload prince-rental-admin-email-assignment.html as admin-access.html
   (or the existing name used by your Rental Companies sidebar link).
5. Upload prince-rental-partner-auto-assignment.html as rental-partner.html.
6. In admin panel, enter company name, then partner email, then assign.
7. Partner signs in using that exact Google account. The portal claims the preapproved email.

Note: An email assignment is pending until the partner logs in; the function deliberately
never exposes a list of Supabase Authentication users. Booking approval remains disabled.
Test with a non-admin partner account before production use.
