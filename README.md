# Perfume Stock Manager — Supabase Auth + Vercel

## Environment Variables di Vercel (Production)
- `SUPABASE_URL`: Project URL.
- `SUPABASE_ANON_KEY`: publishable/anon key (boleh dikirim ke browser melalui endpoint config; bukan secret key).
- `SUPABASE_SERVICE_ROLE_KEY`: service-role/secret key; server-side only, jangan pernah masukkan ke frontend atau GitHub.

`ADMIN_USERNAME` dan `ADMIN_PASSWORD` tidak lagi digunakan.

## Migrasi Supabase Auth
1. Pastikan skema awal dan `migration_stage2.sql` sudah berhasil dijalankan.
2. Jalankan `migration_stage3_auth.sql` di Supabase SQL Editor.
3. Buka Supabase Dashboard → Authentication → Users → Add user, lalu buat user dengan email dan password yang Anda pilih.
4. Salin UUID user tersebut. Di SQL Editor jalankan, ganti UUID contoh dengan UUID akun Anda:
   ```sql
   insert into public.app_admins (user_id) values ('UUID_DARI_AUTH_USERS')
   on conflict (user_id) do nothing;
   ```
5. Di Vercel → Settings → Environment Variables, tambahkan tiga variabel di atas untuk Production. Jangan masukkan key service-role ke browser.
6. Redeploy Vercel. Buka website dan login dengan email/password yang dibuat pada langkah 3.

## Akses terbatas
Server memvalidasi access token Supabase Auth lalu mengecek UUID user di `public.app_admins`. Akun yang hanya dibuat di Authentication tetapi belum dimasukkan ke `app_admins` akan ditolak. Jangan membuat policy publik untuk tabel stok.

## Lokal
Salin `.env.example` menjadi `.env`, isi tiga variabel yang diperlukan, lalu jalankan `npm install` dan `npm start`. Jangan commit `.env`.
