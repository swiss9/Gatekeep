-- =====================================================================
-- Gatekeep Shop — full schema
-- Telegram Mini App commerce backend. Run this once on a fresh
-- Supabase project. It creates every table, index, function, trigger,
-- RLS policy, and storage bucket the app needs.
--
-- After this: optionally run supabase/seed.sql to add demo products.
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- profiles
-- One row per Telegram user. id is our own UUID (not Supabase Auth's),
-- because we mint our own JWTs. telegram_id is the real identity.
-- =====================================================================
create table public.profiles (
  id           uuid primary key,
  telegram_id  bigint unique not null,
  username     text,
  first_name   text,
  role         text not null default 'customer'
                 check (role in ('customer','admin','superadmin')),
  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index idx_profiles_role
  on public.profiles(role) where role in ('admin','superadmin');
create index idx_profiles_telegram on public.profiles(telegram_id);

alter table public.profiles enable row level security;

-- =====================================================================
-- is_admin() helper
-- security definer so it can read profiles from inside a policy on
-- profiles without recursing. stable because the answer does not
-- change within a statement.
-- =====================================================================
create function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('admin','superadmin')
  );
$$;

create policy profiles_read_own on public.profiles
  for select using (auth.uid() = id);

create policy profiles_read_admin on public.profiles
  for select using (public.is_admin(auth.uid()));

-- Writes go through the server's service role. No client write policies.

-- =====================================================================
-- Role-change guard
-- Only the server (service_role) may change a role. PostgREST sets the
-- effective Postgres role via SET LOCAL ROLE, so current_user is the
-- right thing to check here — not the JWT claim.
-- =====================================================================
create function public.prevent_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    if current_user <> 'service_role' then
      raise exception 'Role changes must go through the server';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- =====================================================================
-- store_settings (singleton row, id always 1)
-- Every storefront-level config lives here. Admin edits via the app;
-- the server writes; everyone reads.
-- =====================================================================
create table public.store_settings (
  id                  int primary key default 1 check (id = 1),
  store_name          text not null default 'Gatekeep Shop',
  store_tagline       text not null default 'General Goods',
  currency_symbol     text not null default '$',
  currency_code       text not null default 'usd'
                        check (currency_code ~ '^[a-z]{3}$'),
  shipping_threshold  numeric not null default 60,
  shipping_cost       numeric not null default 6,

  -- Home banner
  banner_enabled      boolean not null default true,
  banner_eyebrow      text not null default 'NEW',
  banner_title        text not null default 'Welcome to your store.',
  banner_subtitle     text not null default 'Free shipping on orders over $60.',
  banner_cta          text not null default 'Shop all',
  banner_cta_action   text not null default 'all'
                        check (banner_cta_action in ('all','category','search')),
  banner_color        text not null default 'mint'
                        check (banner_color in ('mint','blue','pink','yellow','neutral')),

  -- Product page perks (three configurable bullets)
  perks_enabled       boolean not null default true,
  perk_1_text         text not null default 'Free shipping over $60',
  perk_2_text         text not null default '30-day easy returns',
  perk_3_text         text not null default 'Secure checkout',

  -- Payment provider flags + config
  payment_provider    text not null default 'manual'
                        check (payment_provider in
                          ('manual','cod','bank','crypto','stars','stripe')),
  payment_url         text not null default '',
  payment_ton_address text not null default '',

  -- Telegram Stars
  stars_enabled       boolean not null default false,
  stars_rate          numeric not null default 77,

  -- Bank transfer
  bank_enabled        boolean not null default false,
  bank_details        text not null default '',

  -- Crypto
  crypto_enabled      boolean not null default false,
  crypto_btc          text not null default '',
  crypto_eth          text not null default '',
  crypto_usdt_trc20   text not null default '',
  crypto_ton          text not null default '',

  -- Stripe
  stripe_enabled      boolean not null default false,

  updated_at          timestamptz not null default now()
);

insert into public.store_settings (id) values (1)
on conflict (id) do nothing;

alter table public.store_settings enable row level security;

create policy settings_read_all on public.store_settings
  for select using (true);

create policy settings_update_admin on public.store_settings
  for update using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =====================================================================
-- categories
-- =====================================================================
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy categories_read_all on public.categories
  for select using (true);

create policy categories_write_admin on public.categories
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =====================================================================
-- products
-- digital_file_paths is an array of storage paths inside the private
-- 'digital-goods' bucket. Products can ship multiple files (e.g. a
-- PDF + a zip of assets + a README); the delivery flow signs each one
-- separately and sends a download button per file.
-- =====================================================================
create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text default '',
  price              numeric not null,
  category_id        uuid references public.categories(id) on delete set null,
  image_url          text,
  pastel_color       text not null default 'blue'
                       check (pastel_color in ('blue','pink','yellow','mint')),
  stock              int not null default 0,
  active             boolean not null default true,
  rating             numeric not null default 5.0,
  review_count       int not null default 0,
  delivery_type      text not null default 'physical'
                       check (delivery_type in ('physical','digital','none')),
  digital_file_paths text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_products_category on public.products(category_id);
create index idx_products_active on public.products(active) where active = true;
create index idx_products_delivery
  on public.products(delivery_type) where delivery_type = 'digital';

alter table public.products enable row level security;

-- Public sees active products only. Admins see everything.
create policy products_read_active on public.products
  for select using (active = true or public.is_admin(auth.uid()));

create policy products_write_admin on public.products
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =====================================================================
-- orders
-- =====================================================================
create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  order_code             text unique not null,
  user_id                uuid references public.profiles(id) on delete set null,
  customer_name          text not null,
  customer_address       text not null,
  customer_city          text not null,
  customer_zip           text,
  status                 text not null default 'Pending payment'
                           check (status in
                             ('Pending payment','Paid','Processing',
                              'In transit','Delivered','Cancelled')),
  payment_method         text not null default 'manual',
  subtotal               numeric not null,
  shipping               numeric not null,
  total                  numeric not null,

  -- Confirmation timestamps + who confirmed
  payment_confirmed_at   timestamptz,
  paid_confirmed_at      timestamptz,
  paid_confirmed_by      uuid references public.profiles(id) on delete set null,
  delivered_at           timestamptz,

  -- Proof of payment (buyer-submitted)
  payment_proof_url          text,
  payment_proof_note         text,
  payment_tx_hash            text,
  payment_proof_submitted_at timestamptz,

  -- External checkout URL (Stars invoice / Stripe session)
  payment_redirect_url   text,

  -- True if paid via admin "Simulate payment" test action
  payment_simulated      boolean not null default false,

  created_at             timestamptz not null default now()
);

create index idx_orders_user on public.orders(user_id);
create index idx_orders_status on public.orders(status);

alter table public.orders enable row level security;

create policy orders_insert_authenticated on public.orders
  for insert with check (auth.uid() = user_id);

create policy orders_read_own on public.orders
  for select using (auth.uid() = user_id);

create policy orders_read_admin on public.orders
  for select using (public.is_admin(auth.uid()));

create policy orders_update_admin on public.orders
  for update using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =====================================================================
-- order_items
-- =====================================================================
create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  product_name  text not null,
  product_price numeric not null,
  quantity      int not null check (quantity > 0),
  pastel_color  text
);

create index idx_order_items_order on public.order_items(order_id);

alter table public.order_items enable row level security;

create policy order_items_read on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (o.user_id = auth.uid() or public.is_admin(auth.uid()))
    )
  );

create policy order_items_insert on public.order_items
  for insert with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

-- =====================================================================
-- admin_invites
-- One-time tokens embedded in Telegram startapp links. Redeemed by the
-- server on /api/auth/validate. Not exposed to clients directly.
-- =====================================================================
create table public.admin_invites (
  id           uuid primary key default gen_random_uuid(),
  token        text unique not null,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  grants_role  text not null default 'admin'
                 check (grants_role in ('admin','superadmin')),
  expires_at   timestamptz not null,
  used_by      uuid references public.profiles(id) on delete set null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index idx_admin_invites_token_live
  on public.admin_invites(token) where used_by is null;

alter table public.admin_invites enable row level security;

create policy admin_invites_read on public.admin_invites
  for select using (public.is_admin(auth.uid()));

create policy admin_invites_write on public.admin_invites
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =====================================================================
-- decrement_stock()
-- Atomic compare-and-decrement. The UPDATE ... WHERE stock >= qty
-- takes a row lock and writes in one statement, so concurrent orders
-- cannot lose an update. Returns false if stock was insufficient.
-- Called only by the server; explicitly revoked from clients.
-- =====================================================================
create function public.decrement_stock(
  p_product_id uuid,
  p_qty        int
)
returns boolean
language plpgsql
as $$
declare
  affected int;
begin
  if p_qty is null or p_qty <= 0 then
    return false;
  end if;

  update public.products
     set stock      = stock - p_qty,
         updated_at = now()
   where id = p_product_id
     and stock >= p_qty;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

-- =====================================================================
-- Storage buckets
-- products      — public read, admin write. Product cover images.
-- digital-goods — private, admin write only. Delivered via signed URL.
-- receipts      — private, buyer write to their own folder, admin read.
-- =====================================================================

insert into storage.buckets (id, name, public) values
  ('products',      'products',      true),
  ('digital-goods', 'digital-goods', false),
  ('receipts',      'receipts',      false)
on conflict (id) do nothing;

-- ---- products bucket policies ----
create policy "products_storage_read" on storage.objects
  for select using (bucket_id = 'products');

create policy "products_storage_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'products' and public.is_admin(auth.uid()));

create policy "products_storage_modify" on storage.objects
  for update to authenticated
  using (bucket_id = 'products' and public.is_admin(auth.uid()))
  with check (bucket_id = 'products' and public.is_admin(auth.uid()));

create policy "products_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'products' and public.is_admin(auth.uid()));

-- ---- digital-goods bucket policies ----
create policy "digital_goods_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'digital-goods' and public.is_admin(auth.uid()));

create policy "digital_goods_admin_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'digital-goods' and public.is_admin(auth.uid()));

create policy "digital_goods_admin_modify" on storage.objects
  for update to authenticated
  using (bucket_id = 'digital-goods' and public.is_admin(auth.uid()))
  with check (bucket_id = 'digital-goods' and public.is_admin(auth.uid()));

create policy "digital_goods_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'digital-goods' and public.is_admin(auth.uid()));

-- ---- receipts bucket policies ----
-- Path convention: <user_id>/<order_id>.<ext>. The folder prefix is
-- the only thing RLS uses to scope reads/writes to the owning buyer.
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

-- =====================================================================
-- Grants
-- Supabase is phasing out automatic grants. Without these, the anon
-- key, the authenticated JWT, and the server's service role cannot
-- reach the tables, and every request fails with "permission denied".
--
-- Narrow on anon/authenticated (DML only, no TRUNCATE/REFERENCES),
-- broad on service_role (server owns the data).
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated;

grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated;

grant all on all sequences in schema public to service_role;

-- is_admin() is called from RLS policies, so anon/authenticated need
-- EXECUTE on it. The functions below get their grants set explicitly.
grant execute on function public.is_admin(uuid)
  to anon, authenticated, service_role;

-- decrement_stock must only be reachable by the server.
revoke all on function public.decrement_stock(uuid, int)
  from public, anon, authenticated;
grant execute on function public.decrement_stock(uuid, int)
  to service_role;

-- Future tables/functions created in public inherit these grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- =====================================================================
-- Done. Optionally run supabase/seed.sql for demo products.
-- =====================================================================
