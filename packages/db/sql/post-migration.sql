-- Run AFTER `pnpm db:migrate`. These pieces live in raw SQL because they
-- depend on Supabase's `auth` schema or use Postgres features that drizzle-kit
-- doesn't model cleanly.

-- ---------------------------------------------------------------------
-- 1) Auto-create a `profiles` row when a user signs up via Supabase Auth.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_balance numeric(14,2) := coalesce(
    (current_setting('app.default_starting_balance_usd', true))::numeric,
    500.00
  );
  derived_handle text := coalesce(
    new.raw_user_meta_data->>'handle',
    split_part(new.email, '@', 1)
  );
begin
  insert into public.profiles (id, email, handle, available_balance_usd)
  values (new.id, new.email, derived_handle, default_balance)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2) Updated-at trigger for profiles.
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3) Row-Level Security
-- App always uses the SERVICE ROLE key from the server, which bypasses
-- RLS. We still enable it so direct client access (anon key) is safe.
-- ---------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.user_cards             enable row level security;
alter table public.listings               enable row level security;
alter table public.auctions               enable row level security;
alter table public.bids                   enable row level security;
alter table public.balance_holds          enable row level security;
alter table public.pack_purchases         enable row level security;
alter table public.portfolio_snapshots    enable row level security;

-- A user can read their own profile.
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (auth.uid() = id);

-- A user can read their own collection.
drop policy if exists "user_cards self read" on public.user_cards;
create policy "user_cards self read" on public.user_cards
  for select using (auth.uid() = owner_id);

-- Listings, auctions, bids: publicly readable (it's a marketplace).
drop policy if exists "listings public read" on public.listings;
create policy "listings public read" on public.listings for select using (true);
drop policy if exists "auctions public read" on public.auctions;
create policy "auctions public read" on public.auctions for select using (true);
drop policy if exists "bids public read" on public.bids;
create policy "bids public read" on public.bids for select using (true);

-- pack_purchases / balance_holds / portfolio_snapshots: self-only.
drop policy if exists "pack_purchases self" on public.pack_purchases;
create policy "pack_purchases self" on public.pack_purchases
  for select using (auth.uid() = user_id);
drop policy if exists "balance_holds self" on public.balance_holds;
create policy "balance_holds self" on public.balance_holds
  for select using (auth.uid() = user_id);
drop policy if exists "portfolio_snapshots self" on public.portfolio_snapshots;
create policy "portfolio_snapshots self" on public.portfolio_snapshots
  for select using (auth.uid() = user_id);

-- NB: All writes go through server APIs using the service role key.
-- We deliberately do NOT add INSERT/UPDATE/DELETE policies for anon.

-- ---------------------------------------------------------------------
-- 4) Helpful index for the auction-close worker (cheap to scan due dates).
-- ---------------------------------------------------------------------
create index if not exists auctions_due_ix
  on public.auctions (end_at)
  where status in ('live','extended','scheduled');
