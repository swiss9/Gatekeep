-- =====================================================================
-- Gatekeep Shop — migration 001
-- Core schema, RLS policies, and helper functions.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles (created FIRST so is_admin can reference it below)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key,
  telegram_id  bigint unique not null,
  username     text,
  first_name   text,
  role         text not null default 'customer'
                 check (role in ('customer', 'admin', 'superadmin')),
  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_profiles_role
  on public.profiles(role) where role in ('admin','superadmin');
create index if not exists idx_profiles_telegram
  on public.profiles(telegram_id);

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------
-- Helper: admin check. security definer + stable is required — without
-- it, calling is_admin() from a policy on profiles would recurse.
-- ---------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('admin', 'superadmin')
  );
$$;

-- RLS policies for profiles
create policy profiles_read_own on public.profiles
  for select using (auth.uid() = id);

create policy profiles_read_admin on public.profiles
  for select using (public.is_admin(auth.uid()));

-- Writes go through the server (service role). No insert/update/delete
-- policies for regular users.

-- ---------------------------------------------------------------------
-- Role-change guard
-- ---------------------------------------------------------------------
create or replace function public.prevent_role_change()
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

drop trigger if exists trg_prevent_role_change on public.profiles;
create trigger trg_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- ---------------------------------------------------------------------
-- store_settings (singleton)
-- ---------------------------------------------------------------------
create table if not exists public.store_settings (
  id                  int primary key default 1 check (id = 1),
  store_name          text not null default 'Gatekeep Shop',
  store_tagline       text not null default 'General Goods',
  currency_symbol     text not null default '$',
  shipping_threshold  numeric not null default 60,
  shipping_cost       numeric not null default 6,
  banner_enabled      boolean not null default true,
  banner_eyebrow      text not null default 'NEW',
  banner_title        text not null default 'Welcome to your store.',
  banner_subtitle     text not null default 'Free shipping on orders over $60.',
  banner_cta          text not null default 'Shop all',
  banner_cta_action   text not null default 'all'
                        check (banner_cta_action in ('all','category','search')),
  banner_color        text not null default 'mint'
                        check (banner_color in ('mint','blue','pink','yellow','neutral')),
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

-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
create table if not exists public.categories (
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

-- ---------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text default '',
  price         numeric not null,
  category_id   uuid references public.categories(id) on delete set null,
  image_url     text,
  pastel_color  text not null default 'blue'
                  check (pastel_color in ('blue','pink','yellow','mint')),
  stock         int not null default 0,
  active        boolean not null default true,
  rating        numeric not null default 5.0,
  review_count  int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_active   on public.products(active) where active = true;

alter table public.products enable row level security;

create policy products_read_active on public.products
  for select using (active = true or public.is_admin(auth.uid()));

create policy products_write_admin on public.products
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_code        text unique not null,
  user_id           uuid references public.profiles(id) on delete set null,
  customer_name     text not null,
  customer_address  text not null,
  customer_city     text not null,
  customer_zip      text,
  status            text not null default 'Processing'
                      check (status in ('Processing','In transit','Delivered','Cancelled')),
  payment_method    text not null default 'card',
  subtotal          numeric not null,
  shipping          numeric not null,
  total             numeric not null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_orders_user   on public.orders(user_id);
create index if not exists idx_orders_status on public.orders(status);

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

-- ---------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------
create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  product_name   text not null,
  product_price  numeric not null,
  quantity       int not null check (quantity > 0),
  pastel_color   text
);

create index if not exists idx_order_items_order on public.order_items(order_id);

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

-- ---------------------------------------------------------------------
-- Storage bucket for product images.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;

drop policy if exists "products_storage_read"   on storage.objects;
drop policy if exists "products_storage_write"  on storage.objects;
drop policy if exists "products_storage_modify" on storage.objects;
drop policy if exists "products_storage_delete" on storage.objects;

create policy "products_storage_read" on storage.objects
  for select using (bucket_id = 'products');

create policy "products_storage_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'products'
    and public.is_admin(auth.uid())
  );

create policy "products_storage_modify" on storage.objects
  for update to authenticated
  using (bucket_id = 'products' and public.is_admin(auth.uid()))
  with check (bucket_id = 'products' and public.is_admin(auth.uid()));

create policy "products_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'products' and public.is_admin(auth.uid()));
