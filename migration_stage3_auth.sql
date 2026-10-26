-- PERFUME STOCK MANAGER: Supabase Auth allowlist
-- Jalankan sekali di Supabase Dashboard -> SQL Editor.
-- Buat akun terlebih dahulu di Authentication -> Users, lalu salin UUID-nya.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
grant all on public.app_admins to service_role;

-- Setelah akun dibuat di Authentication -> Users, jalankan perintah ini
-- dengan mengganti UUID_DARI_AUTH_USERS menggunakan UUID akun Anda:
-- insert into public.app_admins (user_id) values ('UUID_DARI_AUTH_USERS')
-- on conflict (user_id) do nothing;
