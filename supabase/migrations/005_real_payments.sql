-- =====================================================================
-- Gatekeep Shop — migration 005
-- Real payment methods: Stars, Stripe (Checkout Sessions), bank,
-- crypto, COD, manual. Proof-of-payment fields on orders. Private
-- receipts bucket. Currency code for Stripe.
-- Run after 004. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- store_settings: migrate payment_provider values, narrow the constraint
-- ---------------------------------------------------------------------
alter table public.store_settings
  drop constraint if exists store_settings_payment_provider_check;

-- Legacy values → new equivalents.
update public.store_settings set payment_provider = 'manual' where payment_provider in ('none','custom');
update public.store_settings set payment_provider = 'stripe' where payment_provider = 'stripe_link';

alter table public.store_settings
  add constraint store_settings_payment_provider_check
  check (payment_provider in ('manual','cod','bank','crypto','stars','stripe'));

-- ---------------------------------------------------------------------
-- store_settings: per-method configuration
-- ---------------------------------------------------------------------
alter table public.store_settings
  add column if not exists stars_enabled boolean not null default false,
  add column if not exists stars_rate numeric not null default 77,
  add column if not exists bank_enabled boolean not null default false,
  add column if not exists bank_details text not null default '',
  add column if not exists crypto_enabled boolean not null default false,
  add column if not exists crypto_btc text not null default '',
  add column if not exists crypto_eth text not null default '',
  add column if not exists crypto_usdt_trc20 text not null default '',
  add column if not exists crypto_ton text not null default '',
  add column if not exists stripe_enabled boolean not null default false;

-- ---------------------------------------------------------------------
-- store_settings: 3-letter ISO currency code (Stripe rejects symbols)
-- ---------------------------------------------------------------------
alter table public.store_settings
  add column if not exists currency_code text not null default 'usd';

alter table public.store_settings
  drop constraint if exists store_settings_currency_code_check;

alter table public.store_settings
  add constraint store_settings_currency_code_check
  check (currency_code ~ '^[a-z]{3}$');

-- ---------------------------------------------------------------------
-- orders: proof of payment + who confirmed
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_proof_url text,
  add column if not exists payment_proof_note text,
  add column if not exists payment_tx_hash text,
  add column if not exists paid_confirmed_at timestamptz,
  add column if not exists paid_confirmed_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------
-- Private receipts bucket. Path convention: <user_id>/<order_id>.<ext>
-- RLS uses the folder prefix to scope reads/writes to the owning user.
-- Admins read via signed URLs generated server-side (service role).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "receipts_insert_own" on storage.objects;
drop policy if exists "receipts_read_own_or_admin" on storage.objects;

create policy "receipts_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "receipts_read_own_or_admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin(auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- orders: persist the external checkout URL so the confirmation screen
-- can re-open it after a page reload or a Stripe deep-link return.
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_redirect_url text;
