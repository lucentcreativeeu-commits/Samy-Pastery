-- ═══════════════════════════════════════════════════════════════
-- SAMY CLOUD BAKERY — Supabase Schema (v2 — FIXED)
-- Run this in your Supabase SQL Editor.
--
-- KEY FIXES:
--   - Order status: pending → in_making → delivered (+ cancelled)
--   - Categories table (admin-managed, drives customer filters)
--   - menu_item_images table (up to 4 images per item)
--   - menu_item_variants table (flavors/options)
--   - RLS: authenticated role can read + write menu, orders, categories
--   - adminResetAllStock: requires a valid filter row in Supabase
-- ═══════════════════════════════════════════════════════════════

-- ── CATEGORIES ───────────────────────────────────────────────
create table if not exists categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  slug       text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- ── MENU ITEMS ───────────────────────────────────────────────
create table if not exists menu_items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category_id   uuid references categories(id) on delete set null,
  category      text not null default 'desserts',   -- kept for backward compat
  subcategory   text,
  description   text,
  price         numeric(10,2) not null default 0,
  available     boolean not null default true,
  image_url     text,             -- primary image (backward compat)
  daily_stock   integer,          -- null = unlimited; 0 = sold out
  created_at    timestamptz default now()
);

-- ── MENU ITEM IMAGES (up to 4 per item) ─────────────────────
create table if not exists menu_item_images (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references menu_items(id) on delete cascade,
  url        text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- ── MENU ITEM VARIANTS (flavors / options) ───────────────────
create table if not exists menu_item_variants (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references menu_items(id) on delete cascade,
  name       text not null,   -- e.g. "Dark Chocolate", "Vanilla Bean"
  price_mod  numeric(10,2) not null default 0,  -- price adjustment (+/-)
  available  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- ── ORDERS ───────────────────────────────────────────────────
-- Status flow: pending → in_making → delivered (or cancelled)
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  phone         text not null,
  delivery_type text not null default 'pickup' check (delivery_type in ('pickup','delivery')),
  address       text,
  notes         text,
  total         numeric(10,2) not null default 0,
  status        text not null default 'pending'
                check (status in ('pending','in_making','delivered','cancelled')),
  cancel_reason text,
  created_at    timestamptz default now()
);

-- ── ORDER ITEMS ──────────────────────────────────────────────
create table if not exists order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  item_id     uuid references menu_items(id) on delete set null,
  item_name   text not null,
  variant     text,           -- chosen flavor/variant name (if any)
  price       numeric(10,2) not null,
  qty         integer not null default 1 check (qty >= 1),
  created_at  timestamptz default now()
);

-- ── REVIEWS ──────────────────────────────────────────────────
create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  rating      integer not null check (rating between 1 and 5),
  message     text,
  created_at  timestamptz default now()
);

-- ── NEWSLETTER ───────────────────────────────────────────────
create table if not exists newsletter_subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  created_at  timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

alter table categories           enable row level security;
alter table menu_items           enable row level security;
alter table menu_item_images     enable row level security;
alter table menu_item_variants   enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table reviews              enable row level security;
alter table newsletter_subscribers enable row level security;

-- ── DROP OLD POLICIES (idempotent) ───────────────────────────
drop policy if exists "Public can read available menu items"        on menu_items;
drop policy if exists "Service role full access to menu_items"      on menu_items;
drop policy if exists "Anyone can insert orders"                    on orders;
drop policy if exists "Service role full access to orders"          on orders;
drop policy if exists "Authenticated admins can read orders"        on orders;
drop policy if exists "Authenticated admins can update orders"      on orders;
drop policy if exists "Service role full access to order_items"     on order_items;
drop policy if exists "Anyone can insert order_items"               on order_items;
drop policy if exists "Authenticated can read order_items"          on order_items;
drop policy if exists "Anyone can insert reviews"                   on reviews;
drop policy if exists "Authenticated can read reviews"              on reviews;
drop policy if exists "Anyone can subscribe"                        on newsletter_subscribers;
drop policy if exists "Authenticated can read subscribers"          on newsletter_subscribers;

-- ── CATEGORIES ───────────────────────────────────────────────
create policy "Public can read categories"
  on categories for select using (true);

create policy "Authenticated admins full access to categories"
  on categories for all using (auth.role() = 'authenticated');

-- ── MENU ITEMS ───────────────────────────────────────────────
create policy "Public can read available menu items"
  on menu_items for select using (available = true);

-- Authenticated admins can do everything (read all, insert, update, delete)
create policy "Authenticated admins full access to menu_items"
  on menu_items for all using (auth.role() = 'authenticated');

-- ── MENU ITEM IMAGES ─────────────────────────────────────────
create policy "Public can read menu item images"
  on menu_item_images for select using (true);

create policy "Authenticated admins full access to menu_item_images"
  on menu_item_images for all using (auth.role() = 'authenticated');

-- ── MENU ITEM VARIANTS ───────────────────────────────────────
create policy "Public can read menu item variants"
  on menu_item_variants for select using (true);

create policy "Authenticated admins full access to menu_item_variants"
  on menu_item_variants for all using (auth.role() = 'authenticated');

-- ── ORDERS ───────────────────────────────────────────────────
-- Anyone (customer) can place an order
create policy "Anyone can insert orders"
  on orders for insert with check (true);

-- Authenticated admins can read and update all orders
create policy "Authenticated admins full access to orders"
  on orders for all using (auth.role() = 'authenticated');

-- service_role bypass for serverless functions
create policy "Service role full access to orders"
  on orders for all using (auth.role() = 'service_role');

-- ── ORDER ITEMS ──────────────────────────────────────────────
create policy "Anyone can insert order_items"
  on order_items for insert with check (true);

create policy "Authenticated can read order_items"
  on order_items for select using (auth.role() = 'authenticated');

create policy "Service role full access to order_items"
  on order_items for all using (auth.role() = 'service_role');

-- ── REVIEWS ──────────────────────────────────────────────────
create policy "Anyone can insert reviews"
  on reviews for insert with check (true);

create policy "Authenticated can read reviews"
  on reviews for select using (auth.role() = 'authenticated');

-- ── NEWSLETTER ───────────────────────────────────────────────
create policy "Anyone can subscribe"
  on newsletter_subscribers for insert with check (true);

create policy "Authenticated can read subscribers"
  on newsletter_subscribers for select using (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════
create index if not exists orders_status_idx         on orders(status);
create index if not exists orders_created_idx        on orders(created_at desc);
create index if not exists order_items_order_idx     on order_items(order_id);
create index if not exists menu_items_cat_idx        on menu_items(category);
create index if not exists menu_items_cat_id_idx     on menu_items(category_id);
create index if not exists menu_items_avail_idx      on menu_items(available);
create index if not exists menu_item_images_item_idx on menu_item_images(item_id);
create index if not exists menu_item_variants_item   on menu_item_variants(item_id);

-- ═══════════════════════════════════════════════════════════════
-- SEED CATEGORIES
-- ═══════════════════════════════════════════════════════════════
insert into categories (name, slug, sort_order) values
  ('Desserts', 'desserts', 1),
  ('Drinks',   'drinks',   2),
  ('Starters', 'starters', 3),
  ('Mains',    'mains',    4)
on conflict (slug) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- SEED MENU ITEMS (with category_id resolved)
-- ═══════════════════════════════════════════════════════════════
with cat as (select id, slug from categories)
insert into menu_items (name, category_id, category, subcategory, description, price, available, daily_stock)
select
  v.name, c.id, v.category, v.subcategory, v.description, v.price, v.available, v.daily_stock
from (values
  ('Molten Core Cheesecake',       'desserts', 'desserts', 'Signature',  'Torched at 240°C. A hyper-creamy volcanic core. Flagship build.',              42.00::numeric, true, 20),
  ('The Obsidian Cookie Box',      'desserts', 'desserts', 'Signature',  'Six artisanal cookies injected with dark single-estate ganache.',              35.00::numeric, true, 15),
  ('Smoked Vanilla Bean Tart',     'desserts', 'desserts', 'Seasonal',   'Charcoal-infused shortbread, cold-smoked Madagascar vanilla mousse.',          48.00::numeric, true, 10),
  ('Mini Cheesecake (Individual)', 'desserts', 'desserts', 'Individual', 'A meticulous 10cm personal adaptation of our legendary molten recipe.',        18.00::numeric, true, 30),
  ('Cloud Cold Brew',              'drinks',   'drinks',   'Beverages',  'Single-origin cold brew, 24h steep, oat cream.',                               8.00::numeric,  true, 40),
  ('Burnt Caramel Latte',          'drinks',   'drinks',   'Beverages',  'House-made burnt caramel syrup with steamed oat milk and double espresso.',     9.50::numeric,  true, 25)
) as v(name, slug, category, subcategory, description, price, available, daily_stock)
join cat c on c.slug = v.slug
on conflict do nothing;
