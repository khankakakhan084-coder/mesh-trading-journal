-- ==============================================================
--           MESH TRADING JOURNAL - SUPABASE DATABASE SETUP
-- ==============================================================
-- Paste this entire SQL into your Supabase Dashboard -> SQL Editor -> Run
-- This sets up the trades table, Row Level Security (RLS), and Storage bucket.

-- 1. Create trades table
create table if not exists public.trades (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  user_email text,
  pair text not null,
  direction text not null,
  rr text,
  result text not null,
  pnl numeric default 0,
  notes text,
  screenshot text,
  screenshot_name text,
  video text,
  video_name text,
  date date default current_date,
  time text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Index for faster queries per user
create index if not exists idx_trades_user_id on public.trades (user_id);
create index if not exists idx_trades_date on public.trades (date desc);

-- 2. Enable Row Level Security (RLS)
alter table public.trades enable row level security;

-- 3. RLS Policies: Users can only see & modify their OWN trades!
drop policy if exists "Users can select their own trades" on public.trades;
create policy "Users can select their own trades"
  on public.trades for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "Users can insert their own trades" on public.trades;
create policy "Users can insert their own trades"
  on public.trades for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "Users can update their own trades" on public.trades;
create policy "Users can update their own trades"
  on public.trades for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "Users can delete their own trades" on public.trades;
create policy "Users can delete their own trades"
  on public.trades for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- 4. Create Public Storage Bucket for Screenshots and Videos
insert into storage.buckets (id, name, public)
values ('trade-media', 'trade-media', true)
on conflict (id) do nothing;

-- Storage policies: Authenticated users can upload to their own user folder
drop policy if exists "Authenticated users can upload trade media" on storage.objects;
create policy "Authenticated users can upload trade media"
  on storage.objects for insert
  to authenticated
  with check ( bucket_id = 'trade-media' );

drop policy if exists "Anyone can view trade media" on storage.objects;
create policy "Anyone can view trade media"
  on storage.objects for select
  to public
  using ( bucket_id = 'trade-media' );

drop policy if exists "Users can delete their trade media" on storage.objects;
create policy "Users can delete their trade media"
  on storage.objects for delete
  to authenticated
  using ( bucket_id = 'trade-media' );
