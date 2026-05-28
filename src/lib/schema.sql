-- Run this in your Supabase SQL Editor

-- Profiles table (one row per user, auto-created on sign-up)
create table public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  username    text unique,
  created_at  timestamptz default now()
);

-- Secure it: users can only read/write their own profile
alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
