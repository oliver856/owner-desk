# Apex Owner Desk

Secure owner calling desk for Apex Homes.

- **`src/App.jsx`**: every screen (owner list, unit panel, calling, activity, phone). Edit this to change the look or layout.
- **`api/`**: the secure server code (sign-in checks, office-IP lock, daily limits, phone number release). Leave alone for UI changes.
- **`migrations/`**: database setup, already applied in Supabase.

Hosted on Vercel (Singapore region). Settings live in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, and `OFFICE_IPS` (empty while testing).
