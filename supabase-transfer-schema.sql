create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  wallet_id text unique not null,
  display_name text,
  balance numeric(12, 2) not null default 5000,
  created_at timestamptz not null default now()
);

alter table public.wallets
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists wallet_id text,
  add column if not exists display_name text,
  add column if not exists balance numeric(12, 2) not null default 5000,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists wallets_wallet_id_key
on public.wallets (wallet_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  sender_wallet_id uuid references public.wallets(id),
  receiver_wallet_id uuid references public.wallets(id),
  amount numeric(12, 2) not null default 0,
  note text,
  status text not null default 'completed',
  type text not null default 'peer_transfer',
  created_at timestamptz not null default now()
);

alter table public.transactions
  add column if not exists sender_wallet_id uuid references public.wallets(id),
  add column if not exists receiver_wallet_id uuid references public.wallets(id),
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists note text,
  add column if not exists status text not null default 'completed',
  add column if not exists type text not null default 'peer_transfer',
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_amount_positive'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_amount_positive check (amount > 0);
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Users can manage their own profile" on public.profiles;
drop policy if exists "Users can read wallets for QR transfers" on public.wallets;
drop policy if exists "Users can manage their own wallet" on public.wallets;
drop policy if exists "Users can read their transactions" on public.transactions;

create policy "Users can manage their own profile"
on public.profiles for all
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can read wallets for QR transfers"
on public.wallets for select
to authenticated
using (true);

create policy "Users can manage their own wallet"
on public.wallets for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read their transactions"
on public.transactions for select
to authenticated
using (
  exists (
    select 1
    from public.wallets
    where wallets.user_id = auth.uid()
      and (wallets.id = transactions.sender_wallet_id or wallets.id = transactions.receiver_wallet_id)
  )
);

create or replace function public.process_peer_transfer(
  receiver_wallet_code text,
  transfer_amount numeric,
  transfer_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sender public.wallets%rowtype;
  receiver public.wallets%rowtype;
  transaction_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if transfer_amount <= 0 then
    raise exception 'Transfer amount must be greater than zero';
  end if;

  select * into sender
  from public.wallets
  where user_id = auth.uid()
  for update;

  if sender.id is null then
    raise exception 'Sender wallet not found';
  end if;

  select * into receiver
  from public.wallets
  where wallet_id = receiver_wallet_code
  for update;

  if receiver.id is null then
    raise exception 'Receiver wallet not found';
  end if;

  if sender.id = receiver.id then
    raise exception 'Cannot transfer to the same wallet';
  end if;

  if sender.balance < transfer_amount then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.wallets
  set balance = balance - transfer_amount
  where id = sender.id;

  update public.wallets
  set balance = balance + transfer_amount
  where id = receiver.id;

  insert into public.transactions (
    sender_wallet_id,
    receiver_wallet_id,
    amount,
    note,
    status,
    type
  )
  values (
    sender.id,
    receiver.id,
    transfer_amount,
    transfer_note,
    'completed',
    'peer_transfer'
  )
  returning id into transaction_id;

  return transaction_id;
end;
$$;

grant execute on function public.process_peer_transfer(text, numeric, text) to authenticated;
