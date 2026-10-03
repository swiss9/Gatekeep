-- =====================================================================
-- Gatekeep Shop — seed data
-- Optional. Populates 6 demo products and 4 categories so the storefront
-- has something to show on first open. Safe to delete the products after.
-- =====================================================================

-- Store settings singleton (already inserted by schema.sql, but make sure).
insert into public.store_settings (id) values (1)
on conflict (id) do nothing;

-- Categories
insert into public.categories (name, position) values
  ('Audio', 0),
  ('Home', 1),
  ('Beauty', 2),
  ('Accessories', 3)
on conflict (name) do nothing;

-- Products
insert into public.products
  (name, description, price, category_id, pastel_color, stock, active)
select
  'Aria Wireless Headphones',
  'Over-ear wireless headphones with 40-hour battery, plush memory-foam cushions and studio-tuned 40mm drivers. Folds flat into a felt travel case.',
  129, id, 'blue', 14, true
from public.categories where name = 'Audio'
on conflict do nothing;

insert into public.products
  (name, description, price, category_id, pastel_color, stock, active)
select
  'Ember Soy Candle',
  'Hand-poured soy wax candle with notes of amber, fig and cedar. Wooden lid doubles as a coaster. 45-hour burn time.',
  28, id, 'pink', 32, true
from public.categories where name = 'Home'
on conflict do nothing;

insert into public.products
  (name, description, price, category_id, pastel_color, stock, active)
select
  'Everyday Canvas Tote',
  'Heavyweight 16oz organic canvas tote with an interior zip pocket, reinforced straps and a base that actually holds its shape.',
  45, id, 'yellow', 21, true
from public.categories where name = 'Accessories'
on conflict do nothing;

insert into public.products
  (name, description, price, category_id, pastel_color, stock, active)
select
  'Terra Ceramic Vase',
  'Hand-thrown stoneware vase with a matte terracotta glaze. Each piece is glazed individually, so no two are exactly alike.',
  36, id, 'mint', 9, true
from public.categories where name = 'Home'
on conflict do nothing;

insert into public.products
  (name, description, price, category_id, pastel_color, stock, active)
select
  'Dew Facial Mist',
  'Hydrating facial mist with rose water, niacinamide and aloe vera. 100ml in a recyclable frosted glass bottle.',
  22, id, 'pink', 44, true
from public.categories where name = 'Beauty'
on conflict do nothing;

insert into public.products
  (name, description, price, category_id, pastel_color, stock, active)
select
  'Loop Steel Bottle',
  'Double-wall vacuum insulated steel bottle. Keeps drinks cold for 24 hours or hot for 12. 750ml, leakproof loop cap.',
  32, id, 'blue', 27, true
from public.categories where name = 'Accessories'
on conflict do nothing;
