-- =====================================================================
-- Gatekeep Shop — migration 005
-- Real payment methods: Stars, Stripe, bank, crypto, COD, manual.
-- Proof-of-payment fields on orders. Private receipts bucket.
-- Run after 004. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- store_settings: provider-specific configuration
-- ---------------------------------------------------------------------
alter table public.store_settings
  drop constraint if exists store_settings_payment_provider_check;

-- Migrate legacy values first, then re-add the narrower constraint.
update public.store_settings set payment_provider = 'manual' where payment_provider = 'none';
update public.store_settings set payment_provider = 'manual' where payment_provider = 'custom';

alter table public.store_settings
  add constraint store_settings_payment_provider_check
  check (payment_provider in ('manual','cod','bank','crypto','stars','stripe_link'));

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
