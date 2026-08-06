-- ============ REVELLE BEAUTY: full migration to Supabase ============
-- Generated from the local dev database. Runs in one transaction.
begin;

-- ============ 0001_init.sql ============
-- Revelle Beauty — schema
-- Runs on plain PostgreSQL 15+ and on Supabase unchanged.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------- enums ----------

do $$ begin
  create type product_status as enum ('draft', 'active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum (
    'pending', 'paid', 'fulfilled', 'cancelled', 'refunded', 'expired', 'needs_review'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('unpaid', 'paid', 'refunded', 'partially_refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stock_reason as enum ('order', 'manual', 'restock', 'cancellation', 'correction');
exception when duplicate_object then null; end $$;

-- ---------- helpers ----------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- categories ----------

create table if not exists categories (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid references categories(id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description     text,
  hero_image_path text,
  display_order   integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint categories_not_self_parent check (parent_id is null or parent_id <> id)
);

create index if not exists categories_parent_order_idx on categories (parent_id, display_order, name);
create index if not exists categories_active_idx on categories (is_active) where is_active;

drop trigger if exists categories_touch on categories;
create trigger categories_touch before update on categories
  for each row execute function set_updated_at();

-- Max 2 levels (Lips > Lip Color). Loosen later by dropping this trigger.
create or replace function categories_enforce_depth()
returns trigger language plpgsql as $$
declare gp uuid;
begin
  if new.parent_id is not null then
    select parent_id into gp from categories where id = new.parent_id;
    if gp is not null then
      raise exception 'Category nesting is limited to two levels';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists categories_depth_guard on categories;
create trigger categories_depth_guard
  before insert or update of parent_id on categories
  for each row execute function categories_enforce_depth();

-- ---------- products ----------

create table if not exists products (
  id                     uuid primary key default gen_random_uuid(),
  category_id            uuid not null references categories(id) on delete restrict,
  slug                   text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name                   text not null check (char_length(btrim(name)) between 1 and 140),
  tagline                text,
  description            text,
  ingredients            text,
  how_to_use             text,

  base_price_cents       integer not null check (base_price_cents >= 0),
  compare_at_price_cents integer check (compare_at_price_cents is null or compare_at_price_cents > base_price_cents),
  currency               char(3) not null default 'USD',

  sku                    text unique,
  status                 product_status not null default 'draft',
  track_inventory        boolean not null default true,
  variant_label          text not null default 'Shade',
  is_featured            boolean not null default false,
  display_order          integer not null default 0,

  meta_title             text,
  meta_description       text,

  search_vector tsvector generated always as (
      setweight(to_tsvector('english', coalesce(name, '')),        'A') ||
      setweight(to_tsvector('english', coalesce(tagline, '')),     'B') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored,

  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists products_category_idx on products (category_id, display_order, name);
create index if not exists products_active_idx   on products (status) where status = 'active';
create index if not exists products_featured_idx on products (is_featured) where is_featured;
create index if not exists products_search_idx   on products using gin (search_vector);
create index if not exists products_created_idx  on products (created_at desc);

drop trigger if exists products_touch on products;
create trigger products_touch before update on products
  for each row execute function set_updated_at();

-- ---------- product_variants (the shade model) ----------

create table if not exists product_variants (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references products(id) on delete cascade,

  name                 text not null check (char_length(btrim(name)) between 1 and 60),
  slug                 text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  hex_color            char(7) check (hex_color ~ '^#[0-9a-f]{6}$'),
  hex_color_secondary  char(7) check (hex_color_secondary ~ '^#[0-9a-f]{6}$'),
  finish               text,

  sku                  text unique,
  price_cents_override integer check (price_cents_override >= 0),
  stock_quantity       integer not null default 0 check (stock_quantity >= 0),
  is_available         boolean not null default true,
  is_default           boolean not null default false,
  display_order        integer not null default 0,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (product_id, name),
  unique (product_id, slug),
  unique (id, product_id)
);

create index if not exists product_variants_product_idx on product_variants (product_id, display_order);
create unique index if not exists product_variants_one_default_idx
  on product_variants (product_id) where is_default;

drop trigger if exists product_variants_touch on product_variants;
create trigger product_variants_touch before update on product_variants
  for each row execute function set_updated_at();

-- Normalize hex to lowercase so a pasted uppercase value never trips the CHECK.
create or replace function normalize_variant_hex()
returns trigger language plpgsql as $$
begin
  new.hex_color := lower(nullif(btrim(new.hex_color), ''));
  new.hex_color_secondary := lower(nullif(btrim(new.hex_color_secondary), ''));
  return new;
end $$;

drop trigger if exists product_variants_normalize_hex on product_variants;
create trigger product_variants_normalize_hex
  before insert or update on product_variants
  for each row execute function normalize_variant_hex();

-- ---------- product_images ----------

create table if not exists product_images (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  variant_id    uuid,
  storage_path  text not null unique,
  alt_text      text,
  width         integer,
  height        integer,
  is_primary    boolean not null default false,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),

  constraint product_images_variant_fk
    foreign key (variant_id, product_id)
    references product_variants (id, product_id)
    on delete set null (variant_id)
);

create index if not exists product_images_product_idx on product_images (product_id, display_order);
create index if not exists product_images_variant_idx on product_images (variant_id) where variant_id is not null;
create unique index if not exists product_images_one_primary_idx
  on product_images (product_id) where is_primary;

-- ---------- orders ----------

create sequence if not exists order_number_seq start 1001;

create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  order_number  text not null unique default ('RB-' || nextval('order_number_seq')),

  status         order_status   not null default 'pending',
  payment_status payment_status not null default 'unpaid',

  email          citext,
  customer_name  text,
  phone          text,

  shipping_name        text,
  shipping_line1       text,
  shipping_line2       text,
  shipping_city        text,
  shipping_state       text,
  shipping_postal_code text,
  shipping_country     char(2),

  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text unique,
  stripe_customer_id         text,

  currency              char(3) not null default 'USD',
  subtotal_cents        integer not null check (subtotal_cents  >= 0),
  shipping_cents        integer not null default 0 check (shipping_cents >= 0),
  tax_cents             integer not null default 0 check (tax_cents      >= 0),
  discount_cents        integer not null default 0 check (discount_cents >= 0),
  total_cents           integer not null check (total_cents >= 0),
  amount_refunded_cents integer not null default 0 check (amount_refunded_cents >= 0),

  tracking_number text,
  tracking_url    text,
  admin_notes     text,
  oversold        boolean not null default false,

  stripe_session_raw jsonb,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  paid_at      timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  expires_at   timestamptz,

  constraint orders_total_consistent
    check (total_cents = subtotal_cents + shipping_cents + tax_cents - discount_cents)
);

create index if not exists orders_status_created_idx on orders (status, created_at desc);
create index if not exists orders_created_idx        on orders (created_at desc);
create index if not exists orders_email_idx          on orders (email);
create index if not exists orders_pending_expiry_idx on orders (expires_at) where status = 'pending';

drop trigger if exists orders_touch on orders;
create trigger orders_touch before update on orders
  for each row execute function set_updated_at();

-- ---------- order_items (immutable snapshot) ----------

create table if not exists order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,

  product_id uuid references products(id)         on delete set null,
  variant_id uuid references product_variants(id) on delete set null,

  product_name     text    not null,
  product_slug     text    not null,
  variant_name     text    not null,
  variant_hex      char(7),
  sku              text,
  image_path       text,

  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity         integer not null check (quantity between 1 and 100),
  line_total_cents integer generated always as (unit_price_cents * quantity) stored,

  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx   on order_items (order_id);
create index if not exists order_items_variant_idx on order_items (variant_id);

-- ---------- webhook_events (Stripe idempotency) ----------

create table if not exists webhook_events (
  id              uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  type            text not null,
  payload         jsonb not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  error           text,
  attempts        integer not null default 0
);

create index if not exists webhook_events_unprocessed_idx
  on webhook_events (received_at) where processed_at is null;

-- ---------- inventory_adjustments (audit) ----------

create table if not exists inventory_adjustments (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references product_variants(id) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      stock_reason not null,
  order_id    uuid references orders(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists inventory_adjustments_variant_idx
  on inventory_adjustments (variant_id, created_at desc);

-- ---------- store_settings (single row) ----------

create table if not exists store_settings (
  id                            boolean primary key default true check (id),
  currency                      char(3) not null default 'USD',
  flat_shipping_cents           integer not null default 599 check (flat_shipping_cents >= 0),
  free_shipping_threshold_cents integer check (free_shipping_threshold_cents >= 0),
  allowed_shipping_countries    char(2)[] not null default '{US}',
  announcement                  text,
  checkout_enabled              boolean not null default true,
  updated_at                    timestamptz not null default now()
);

insert into store_settings (id) values (true) on conflict do nothing;

-- ---------- RLS lockdown (no-op on local Postgres, real on Supabase) ----------
-- The app connects via DATABASE_URL as the table owner / service role, which
-- bypasses RLS. anon/authenticated (Supabase's PostgREST roles) get nothing.

do $$
begin
  alter table categories            enable row level security;
  alter table products              enable row level security;
  alter table product_variants      enable row level security;
  alter table product_images        enable row level security;
  alter table orders                enable row level security;
  alter table order_items           enable row level security;
  alter table webhook_events        enable row level security;
  alter table inventory_adjustments enable row level security;
  alter table store_settings        enable row level security;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables    in schema public from anon;
    revoke all on all sequences in schema public from anon;
    execute 'alter default privileges in schema public revoke all on tables from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables    in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
  end if;
end $$;

-- ============ 0002_functions.sql ============
-- Revelle Beauty — transactional functions.
-- mark_order_paid is the atomic core: pay + decrement stock + audit, idempotent.

create or replace function mark_order_paid(
  p_order_id           uuid,
  p_payment_intent_id  text,
  p_email              text,
  p_customer_name      text,
  p_phone              text,
  p_shipping           jsonb,
  p_amount_total_cents integer,
  p_raw                jsonb
) returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders;
  v_item     record;
  v_updated  integer;
  v_oversold boolean := false;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  -- Idempotency: event-id dedupe is guard #1 (app layer); this is guard #2.
  if v_order.status <> 'pending' then
    return v_order;
  end if;

  for v_item in
    select variant_id, quantity from order_items
    where order_id = p_order_id and variant_id is not null
  loop
    update product_variants v
       set stock_quantity = v.stock_quantity - v_item.quantity
      from products p
     where v.id = v_item.variant_id
       and p.id = v.product_id
       and (not p.track_inventory or v.stock_quantity >= v_item.quantity);
    get diagnostics v_updated = row_count;

    if v_updated = 0 then
      -- Money is captured; never fail the order over stock. Flag for review.
      v_oversold := true;
    else
      insert into inventory_adjustments (variant_id, delta, reason, order_id)
      values (v_item.variant_id, -v_item.quantity, 'order', p_order_id);
    end if;
  end loop;

  update orders set
    status = case
               when v_oversold then 'needs_review'::order_status
               when p_amount_total_cents is not null
                    and p_amount_total_cents is distinct from total_cents
                 then 'needs_review'::order_status
               else 'paid'::order_status
             end,
    payment_status           = 'paid',
    oversold                 = v_oversold,
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    email                    = coalesce(p_email, email),
    customer_name            = coalesce(p_customer_name, customer_name),
    phone                    = coalesce(p_phone, phone),
    shipping_name        = coalesce(p_shipping->>'name',        shipping_name),
    shipping_line1       = coalesce(p_shipping->>'line1',       shipping_line1),
    shipping_line2       = coalesce(p_shipping->>'line2',       shipping_line2),
    shipping_city        = coalesce(p_shipping->>'city',        shipping_city),
    shipping_state       = coalesce(p_shipping->>'state',       shipping_state),
    shipping_postal_code = coalesce(p_shipping->>'postal_code', shipping_postal_code),
    shipping_country     = coalesce(p_shipping->>'country',     shipping_country),
    stripe_session_raw   = coalesce(p_raw, stripe_session_raw),
    paid_at              = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;

-- Flip stale pending orders to expired. Called hourly by the app.
create or replace function expire_stale_orders() returns integer
language sql as $$
  with u as (
    update orders set status = 'expired', cancelled_at = now()
    where status = 'pending' and created_at < now() - interval '2 hours'
    returning 1
  ) select count(*)::int from u;
$$;

-- ============ DATA ============
-- categories (4 rows)
insert into categories (id, parent_id, name, slug, description, hero_image_path, display_order, is_active, created_at, updated_at) values ('8bb03b6e-89e6-49c3-afd4-feaf31ef2341', null, 'Lips', 'lips', null, null, 1, true, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into categories (id, parent_id, name, slug, description, hero_image_path, display_order, is_active, created_at, updated_at) values ('1c814ab0-70ad-459e-a73a-62383c9db1aa', null, 'Skincare', 'skincare', null, null, 2, true, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into categories (id, parent_id, name, slug, description, hero_image_path, display_order, is_active, created_at, updated_at) values ('0b5e0b5f-8d84-443f-a344-1e3c601611cd', '8bb03b6e-89e6-49c3-afd4-feaf31ef2341', 'Lip Products & Oil', 'lip-oil', null, null, 1, true, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into categories (id, parent_id, name, slug, description, hero_image_path, display_order, is_active, created_at, updated_at) values ('61802a24-3e56-490a-a32a-e44f1b38b812', '8bb03b6e-89e6-49c3-afd4-feaf31ef2341', 'Lip Color', 'lip-color', null, null, 2, true, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');

-- products (16 rows)
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('bc3ee50b-0fd3-447b-a171-9505f92d3bb3', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'high-shine-lip-oil', 'High Shine Lip Oil', 'Glass-like shine, weightless feel.', 'A nourishing lip oil that delivers mirror shine without the stick. Infused with botanical oils that condition lips over time.', null, null, 2200, null, 'USD', null, 'active'::product_status, true, 'Shade', true, 1, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('940a2c7e-e417-484e-9856-1da6eb07cd63', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'ultra-light-lip-oil', 'Ultra Light Lip Oil (Square Tube)', 'Barely-there hydration with a whisper of color.', 'Our lightest formula in a sleek square tube. A veil of moisture and sheer color for everyday wear.', null, null, 1900, null, 'USD', null, 'active'::product_status, true, 'Shade', false, 2, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('d5fbcf95-2c0f-4884-9008-96af696bed14', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'lip-lustre-lip-gloss', 'Lip Lustre Lip Gloss', 'Cushioned shine that lasts.', 'A plush, non-sticky gloss with dimensional shine. Buildable color that flatters every skin tone.', null, null, 2000, null, 'USD', null, 'active'::product_status, true, 'Shade', true, 3, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('79f94bf3-12c9-43b0-a176-7447393f11a1', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'sugar-lip-scrub', 'Sugar Lip Scrub', 'Buff, smooth, and prep.', 'Fine sugar crystals melt away dryness, leaving lips soft and perfectly prepped for color.', null, null, 1600, null, 'USD', null, 'active'::product_status, true, 'Type', false, 4, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('3c5a5989-1076-45cc-a5ac-f8a68ca8c1b5', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'diamond-lip-gloss', 'Diamond Lip Gloss', 'Multidimensional sparkle.', 'Micro-fine pearls suspended in a cushiony gloss for a lit-from-within sparkle.', null, null, 2400, null, 'USD', null, 'active'::product_status, true, 'Shade', true, 5, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('8726e099-581e-4246-996f-2866237af7c5', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'nourishing-lip-tint', 'Nourishing Lip Tint', 'Color that cares.', 'A balmy tint that drenches lips in moisture while leaving a soft flush of color.', null, null, 1800, null, 'USD', null, 'active'::product_status, true, 'Shade', false, 6, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('3bea4a9a-89af-4c8a-9ff6-800a655b7158', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'magic-tone-lip', 'Magic Tone Lip', 'Reacts to you.', 'A pH-reactive formula that shifts to your most flattering shade. One tube, your color.', null, null, 2100, null, 'USD', null, 'active'::product_status, true, 'Shade', false, 7, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('4b2b00e5-596e-4446-b7c7-6e8c613369fb', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'lip-gloss-hyaluronic-acid', 'Lip Gloss with Hyaluronic Acid', 'Plumping hydration meets shine.', 'Hyaluronic acid draws in moisture for visibly fuller-looking lips under a glassy finish.', null, null, 2300, null, 'USD', null, 'active'::product_status, true, 'Shade', false, 8, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('5abc6804-5001-4fef-a716-f98ec110db77', '0b5e0b5f-8d84-443f-a344-1e3c601611cd', 'peptide-lip-lacquer', 'Peptide Lip Lacquer', 'Treatment-level shine.', 'A peptide-infused lacquer that supports smoother, bouncier-looking lips with every wear.', null, null, 2600, null, 'USD', null, 'active'::product_status, true, 'Shade', false, 9, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('e3b4a7ca-0ce6-422e-80f8-759cb24d5576', '61802a24-3e56-490a-a32a-e44f1b38b812', 'creamy-matte-lipstick', 'Creamy Matte Lipstick', 'Velvet color, zero drag.', 'A modern matte that glides on like a balm and sets to a soft-focus velvet finish.', null, null, 2400, null, 'USD', null, 'active'::product_status, true, 'Shade', true, 1, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('54bd0ea8-9620-40dc-9394-ddf414e07b30', '61802a24-3e56-490a-a32a-e44f1b38b812', 'long-lasting-matte-liquid-lipstick', 'Long-Lasting Matte Liquid Lipstick', 'All-day color. No compromise.', 'Transfer-resistant liquid color that stays comfortable from first coffee to last call.', null, null, 2500, null, 'USD', null, 'active'::product_status, true, 'Shade', false, 2, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('a2cf65aa-cae9-4aea-8b90-00453589cdca', '61802a24-3e56-490a-a32a-e44f1b38b812', 'matte-lip-liner', 'Matte Lip Liner', 'Define. Sculpt. Perfect.', 'A creamy, precise liner that shapes and fills with rich matte color.', null, null, 1500, null, 'USD', null, 'active'::product_status, true, 'Shade', false, 3, null, null, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('c9b01ee9-0b07-4085-8cab-3d64ebd0450c', '1c814ab0-70ad-459e-a73a-62383c9db1aa', 'radiance-face-serum', 'Radiance Face Serum', 'Glow, bottled.', 'A featherlight serum that leaves skin luminous and smooth. Placeholder product — details coming soon.', null, null, 3800, null, 'USD', null, 'active'::product_status, true, 'Size', false, 1, null, null, '2026-08-05T16:30:08.646Z', '2026-08-05T15:02:28.734Z', '2026-08-05T16:30:08.646Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('1491c666-c53d-4c40-a00b-bd7631fd2c1c', '1c814ab0-70ad-459e-a73a-62383c9db1aa', 'silk-hydration-moisturizer', 'Silk Hydration Moisturizer', 'Deep moisture, zero weight.', 'A silky daily moisturizer that cushions skin with lasting hydration. Placeholder product — details coming soon.', null, null, 3200, null, 'USD', null, 'active'::product_status, true, 'Size', false, 2, null, null, '2026-08-05T16:30:08.646Z', '2026-08-05T15:02:28.734Z', '2026-08-05T16:30:08.646Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('695b2b11-bf65-46bc-a27e-61950e093921', '1c814ab0-70ad-459e-a73a-62383c9db1aa', 'velvet-cloud-cleanser', 'Velvet Cloud Cleanser', 'Melts the day away.', 'A cushiony gel-cream cleanser that lifts makeup and impurities without stripping. Placeholder product — details coming soon.', null, null, 2600, null, 'USD', null, 'active'::product_status, true, 'Size', false, 3, null, null, '2026-08-05T16:30:08.646Z', '2026-08-05T16:30:08.646Z', '2026-08-05T16:30:08.646Z');
insert into products (id, category_id, slug, name, tagline, description, ingredients, how_to_use, base_price_cents, compare_at_price_cents, currency, sku, status, track_inventory, variant_label, is_featured, display_order, meta_title, meta_description, published_at, created_at, updated_at) values ('1d8378cf-47ae-4b83-99e6-981e3c483260', '1c814ab0-70ad-459e-a73a-62383c9db1aa', 'golden-hour-face-oil', 'Golden Hour Face Oil', 'Lit from within.', 'A fast-absorbing botanical oil blend for a soft-focus, golden-hour finish. Placeholder product — details coming soon.', null, null, 4200, null, 'USD', null, 'active'::product_status, true, 'Size', false, 4, null, null, '2026-08-05T16:30:08.646Z', '2026-08-05T16:30:08.646Z', '2026-08-05T16:30:08.646Z');

-- product_variants (46 rows)
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('df31de01-2620-4267-b50d-1fb1657faf5a', 'bc3ee50b-0fd3-447b-a171-9505f92d3bb3', 'Clear Glaze', 'clear-glaze', '#f6ece4', null, 'glossy', null, null, 50, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('92bad42b-1af6-49f3-a732-316ded94b071', 'bc3ee50b-0fd3-447b-a171-9505f92d3bb3', 'Peach Nectar', 'peach-nectar', '#f0a882', null, 'glossy', null, null, 50, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('8e5f4653-dca5-4743-b091-c8d8e9ec4b07', 'bc3ee50b-0fd3-447b-a171-9505f92d3bb3', 'Plum Drift', 'plum-drift', '#7e4560', null, 'glossy', null, null, 50, true, false, 5, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('88d4bc21-db32-4634-9a28-674788c6ee5d', '940a2c7e-e417-484e-9856-1da6eb07cd63', 'Bare Ivory', 'bare-ivory', '#f2e6da', null, 'sheer', null, null, 40, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('6be895f1-4030-4276-a798-6d912026bce9', '940a2c7e-e417-484e-9856-1da6eb07cd63', 'Soft Blush', 'soft-blush', '#e8a6a6', null, 'sheer', null, null, 40, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('751c9f19-9124-42d9-84a0-1c75f410bdba', '940a2c7e-e417-484e-9856-1da6eb07cd63', 'Coral Air', 'coral-air', '#f08a6a', null, 'sheer', null, null, 40, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('3a538ca6-00a7-4544-83d0-7a5ebd9d7656', '940a2c7e-e417-484e-9856-1da6eb07cd63', 'Berry Mist', 'berry-mist', '#a34f6e', null, 'sheer', null, null, 40, true, false, 4, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('28565b82-ed2b-4b0a-bd46-cbdadbff8214', 'd5fbcf95-2c0f-4884-9008-96af696bed14', 'Champagne', 'champagne', '#e2c391', null, 'shimmer', null, null, 45, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('34579d11-a2e5-43e3-9c7f-f912d5dfa37a', 'd5fbcf95-2c0f-4884-9008-96af696bed14', 'Nude Silk', 'nude-silk', '#cf9c86', null, 'glossy', null, null, 45, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('64606918-9ab0-4f18-a2d6-7c8801b4fa2e', 'd5fbcf95-2c0f-4884-9008-96af696bed14', 'Rosewood', 'rosewood', '#a85f68', null, 'glossy', null, null, 45, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('30c9e318-cb8a-41c3-a648-4876bd68e4a5', 'd5fbcf95-2c0f-4884-9008-96af696bed14', 'Mauve Hour', 'mauve-hour', '#8d5f79', null, 'glossy', null, null, 45, true, false, 4, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('44b31d5d-ef55-4a90-885a-dab365c4ae4e', '79f94bf3-12c9-43b0-a176-7447393f11a1', 'Default', 'default', null, null, null, null, null, 60, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('19b9c488-9111-4f3a-8e8d-2f2d7598e263', '3c5a5989-1076-45cc-a5ac-f8a68ca8c1b5', 'Diamond Clear', 'diamond-clear', '#efe7e2', '#d8c39a', 'metallic', null, null, 35, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('a3772e3e-d70f-4a69-9533-91607c10a452', '3c5a5989-1076-45cc-a5ac-f8a68ca8c1b5', 'Icy Pink', 'icy-pink', '#e5a8bd', '#cfd8e8', 'metallic', null, null, 35, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('42af945a-df60-4003-abcd-a7d17bb3fce3', '3c5a5989-1076-45cc-a5ac-f8a68ca8c1b5', 'Gold Dust', 'gold-dust', '#c9a24a', '#f0dfae', 'metallic', null, null, 35, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('f30cd3e5-b68a-47f7-8939-37692477f9b6', '8726e099-581e-4246-996f-2866237af7c5', 'Petal', 'petal', '#e79aa4', null, 'sheer', null, null, 40, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('b721d34a-13ae-4df0-9b58-8faf469b9b2c', '8726e099-581e-4246-996f-2866237af7c5', 'Guava', 'guava', '#e2705f', null, 'sheer', null, null, 40, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('38173088-27c8-4d64-bfcf-1d11faef088e', '8726e099-581e-4246-996f-2866237af7c5', 'Wine', 'wine', '#7a2f3d', null, 'sheer', null, null, 40, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('8e2fc49d-4798-4999-aaf7-39d711d91b60', '8726e099-581e-4246-996f-2866237af7c5', 'Cocoa', 'cocoa', '#8a5344', null, 'sheer', null, null, 40, true, false, 4, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('e46cb12b-095d-4df0-a907-956a7fe6c740', '3bea4a9a-89af-4c8a-9ff6-800a655b7158', 'Magic Rose', 'magic-rose', '#c85a76', null, 'sheer', null, null, 30, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('b2dd8c22-b20b-44c0-9e3c-6aacb920c950', '3bea4a9a-89af-4c8a-9ff6-800a655b7158', 'Magic Coral', 'magic-coral', '#e2745c', null, 'sheer', null, null, 30, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('e91a093a-ff9b-4056-b67f-39e7344043d1', '3bea4a9a-89af-4c8a-9ff6-800a655b7158', 'Magic Berry', 'magic-berry', '#8e3a5a', null, 'sheer', null, null, 30, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('3ecef443-0021-4934-9896-2e48974ce799', '4b2b00e5-596e-4446-b7c7-6e8c613369fb', 'Hydra Clear', 'hydra-clear', '#f3ebe6', null, 'glossy', null, null, 40, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('3cd8978f-78f9-422b-a5dd-60cac9b11006', '4b2b00e5-596e-4446-b7c7-6e8c613369fb', 'Hydra Rose', 'hydra-rose', '#dd8f9c', null, 'glossy', null, null, 40, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('822653a0-d744-41ac-82bf-dc54e9d49cc9', '4b2b00e5-596e-4446-b7c7-6e8c613369fb', 'Hydra Nude', 'hydra-nude', '#c79a84', null, 'glossy', null, null, 40, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('f02397f0-105f-4d82-a684-71304842b577', '5abc6804-5001-4fef-a716-f98ec110db77', 'Lacquer Nude', 'lacquer-nude', '#c58f7c', null, 'glossy', null, null, 35, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('69ef6715-66f1-4ff1-915b-8f92b66cd41f', '5abc6804-5001-4fef-a716-f98ec110db77', 'Lacquer Red', 'lacquer-red', '#b3202f', null, 'glossy', null, null, 35, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('da455362-0cab-4a5e-99f6-7be604ae5bb2', '5abc6804-5001-4fef-a716-f98ec110db77', 'Lacquer Plum', 'lacquer-plum', '#6f3149', null, 'glossy', null, null, 35, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('73fe5e7f-cb4c-4617-8327-7800717acbfe', 'e3b4a7ca-0ce6-422e-80f8-759cb24d5576', 'Ivory Rose', 'ivory-rose', '#c98a86', null, 'matte', null, null, 50, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('91aadc87-bd90-4504-ad17-8539e8fec4e7', 'e3b4a7ca-0ce6-422e-80f8-759cb24d5576', 'Classic Red', 'classic-red', '#b31b2c', null, 'matte', null, null, 50, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('4d21c065-8890-4ffb-9cb3-a654c2c9ddd4', 'e3b4a7ca-0ce6-422e-80f8-759cb24d5576', 'Terracotta', 'terracotta', '#a55340', null, 'matte', null, null, 50, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('dbd5aab6-4c31-4cb3-af00-b3e041e99ae4', 'e3b4a7ca-0ce6-422e-80f8-759cb24d5576', 'Deep Berry', 'deep-berry', '#6d2740', null, 'matte', null, null, 50, true, false, 4, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('0a7eb11c-53a4-4ac0-9164-1b20d81a0c11', 'e3b4a7ca-0ce6-422e-80f8-759cb24d5576', 'Nude Beige', 'nude-beige', '#bb8f76', null, 'matte', null, null, 50, true, false, 5, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('b7f8e9d2-447a-4e3b-87cd-6e3a5d7bd8a0', '54bd0ea8-9620-40dc-9394-ddf414e07b30', 'Velvet Nude', 'velvet-nude', '#b5806f', null, 'matte', null, null, 45, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('082c02e6-e88c-4b3c-98ac-3aac8a2e2592', '54bd0ea8-9620-40dc-9394-ddf414e07b30', 'Velvet Red', 'velvet-red', '#a01423', null, 'matte', null, null, 45, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('3e6c45e5-4eea-4c6b-896c-01cf3bf5aa1a', '54bd0ea8-9620-40dc-9394-ddf414e07b30', 'Velvet Mauve', 'velvet-mauve', '#8b5a6b', null, 'matte', null, null, 45, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('2db3953d-3972-4642-ab2e-3e7cf7d65aa5', '54bd0ea8-9620-40dc-9394-ddf414e07b30', 'Velvet Cocoa', 'velvet-cocoa', '#6f4436', null, 'matte', null, null, 45, true, false, 4, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('c942591e-1732-48c4-9c5b-4fdcf817e95b', 'a2cf65aa-cae9-4aea-8b90-00453589cdca', 'Nude Outline', 'nude-outline', '#b98a76', null, 'matte', null, null, 55, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('09851ed6-17e5-404e-a487-06d3fa98aacd', 'a2cf65aa-cae9-4aea-8b90-00453589cdca', 'Red Outline', 'red-outline', '#9b1b28', null, 'matte', null, null, 55, true, false, 2, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('81dfe335-27c1-4331-a60f-723b85e6dae4', 'a2cf65aa-cae9-4aea-8b90-00453589cdca', 'Berry Outline', 'berry-outline', '#7a3448', null, 'matte', null, null, 55, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:02:28.734Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('51e87222-cdde-40c7-a3cb-e9ee221bb943', 'bc3ee50b-0fd3-447b-a171-9505f92d3bb3', 'Rose Elixir', 'rose-elixir', '#d9738a', null, 'glossy', null, null, 48, true, false, 3, '2026-08-05T15:02:28.734Z', '2026-08-05T15:04:05.483Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('f672598c-9d97-4b6e-af73-95458caa3521', 'bc3ee50b-0fd3-447b-a171-9505f92d3bb3', 'Cherry Sheen', 'cherry-sheen', '#b03246', null, 'glossy', null, null, 49, true, false, 4, '2026-08-05T15:02:28.734Z', '2026-08-05T15:21:05.735Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('66e058cc-8190-4bbe-a5f2-212c677e72d8', 'c9b01ee9-0b07-4085-8cab-3d64ebd0450c', 'Default', 'default', null, null, null, null, null, 40, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T16:30:08.646Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('1e28ae2a-4aa1-46b5-b5f8-666298f00c06', '1491c666-c53d-4c40-a00b-bd7631fd2c1c', 'Default', 'default', null, null, null, null, null, 40, true, true, 1, '2026-08-05T15:02:28.734Z', '2026-08-05T16:30:08.646Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('5b5c9b86-9912-4a08-8cb3-285b3c2e2fd8', '695b2b11-bf65-46bc-a27e-61950e093921', 'Default', 'default', null, null, null, null, null, 40, true, true, 1, '2026-08-05T16:30:08.646Z', '2026-08-05T16:30:08.646Z');
insert into product_variants (id, product_id, name, slug, hex_color, hex_color_secondary, finish, sku, price_cents_override, stock_quantity, is_available, is_default, display_order, created_at, updated_at) values ('e124d919-2bad-4906-975e-3bafc734f199', '1d8378cf-47ae-4b83-99e6-981e3c483260', 'Default', 'default', null, null, null, null, null, 40, true, true, 1, '2026-08-05T16:30:08.646Z', '2026-08-05T16:30:08.646Z');

-- product_images: empty

-- orders (2 rows)
insert into orders (id, order_number, status, payment_status, email, customer_name, phone, shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_state, shipping_postal_code, shipping_country, stripe_checkout_session_id, stripe_payment_intent_id, stripe_customer_id, currency, subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, amount_refunded_cents, tracking_number, tracking_url, admin_notes, oversold, stripe_session_raw, created_at, updated_at, paid_at, fulfilled_at, cancelled_at, expires_at) values ('6a73cf8c-6151-41bd-b89b-fa107ade29f1', 'RB-1001', 'paid'::order_status, 'paid'::payment_status, 'test@revelle.local', 'Varlee Fofana', null, 'Varlee Fofana', '123 Test Street', null, 'Testville', 'CA', '90210', 'US', 'mock_6a73cf8c-6151-41bd-b89b-fa107ade29f1', 'mock_pi_6a73cf8c-6151-41bd-b89b-fa107ade29f1', null, 'USD', 4400, 599, 0, 0, 4999, 0, null, null, null, false, '{"mock":true,"paidAt":"2026-08-05T15:04:05.482Z"}'::jsonb, '2026-08-05T15:03:34.448Z', '2026-08-05T15:04:05.483Z', '2026-08-05T15:04:05.483Z', null, null, '2026-08-05T15:33:34.448Z');
insert into orders (id, order_number, status, payment_status, email, customer_name, phone, shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_state, shipping_postal_code, shipping_country, stripe_checkout_session_id, stripe_payment_intent_id, stripe_customer_id, currency, subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, amount_refunded_cents, tracking_number, tracking_url, admin_notes, oversold, stripe_session_raw, created_at, updated_at, paid_at, fulfilled_at, cancelled_at, expires_at) values ('9208aef4-f3d4-4c8d-bcd4-77e74a395208', 'RB-1002', 'paid'::order_status, 'paid'::payment_status, 'test@example.com', 'Test Customer', null, 'Test Customer', '123 Test Street', null, 'Testville', 'CA', '90210', 'US', 'mock_9208aef4-f3d4-4c8d-bcd4-77e74a395208', 'mock_pi_9208aef4-f3d4-4c8d-bcd4-77e74a395208', null, 'USD', 2200, 599, 0, 0, 2799, 0, null, null, null, false, '{"mock":true,"paidAt":"2026-08-05T15:21:05.734Z"}'::jsonb, '2026-08-05T15:20:54.983Z', '2026-08-05T15:21:05.735Z', '2026-08-05T15:21:05.735Z', null, null, '2026-08-05T15:50:54.983Z');

-- order_items (2 rows)
insert into order_items (id, order_id, product_id, variant_id, product_name, product_slug, variant_name, variant_hex, sku, image_path, unit_price_cents, quantity, created_at) values ('8bc47c74-e50b-45ac-a301-87e69e6817a3', '6a73cf8c-6151-41bd-b89b-fa107ade29f1', 'bc3ee50b-0fd3-447b-a171-9505f92d3bb3', '51e87222-cdde-40c7-a3cb-e9ee221bb943', 'High Shine Lip Oil', 'high-shine-lip-oil', 'Rose Elixir', '#d9738a', null, null, 2200, 2, '2026-08-05T15:03:34.448Z');
insert into order_items (id, order_id, product_id, variant_id, product_name, product_slug, variant_name, variant_hex, sku, image_path, unit_price_cents, quantity, created_at) values ('c2691303-6b43-47b5-8292-6fddf705bcf3', '9208aef4-f3d4-4c8d-bcd4-77e74a395208', 'bc3ee50b-0fd3-447b-a171-9505f92d3bb3', 'f672598c-9d97-4b6e-af73-95458caa3521', 'High Shine Lip Oil', 'high-shine-lip-oil', 'Cherry Sheen', '#b03246', null, null, 2200, 1, '2026-08-05T15:20:54.983Z');

-- inventory_adjustments (2 rows)
insert into inventory_adjustments (id, variant_id, delta, reason, order_id, note, created_at) values ('f0f921aa-9c6a-49f1-8d52-8beb07780d82', '51e87222-cdde-40c7-a3cb-e9ee221bb943', -2, 'order'::stock_reason, '6a73cf8c-6151-41bd-b89b-fa107ade29f1', null, '2026-08-05T15:04:05.483Z');
insert into inventory_adjustments (id, variant_id, delta, reason, order_id, note, created_at) values ('ae259f82-0d94-4362-a558-320b254ebc3b', 'f672598c-9d97-4b6e-af73-95458caa3521', -1, 'order'::stock_reason, '9208aef4-f3d4-4c8d-bcd4-77e74a395208', null, '2026-08-05T15:21:05.735Z');

-- store_settings
update store_settings set
  currency = 'USD',
  flat_shipping_cents = 599,
  free_shipping_threshold_cents = 5000,
  allowed_shipping_countries = array['US','CA']::char(2)[],
  announcement = 'COMPLIMENTARY SHIPPING ON ORDERS OVER $50',
  checkout_enabled = true
where id;

select setval('order_number_seq', 1002);

-- migration bookkeeping
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
insert into schema_migrations (filename) values
  ('0001_init.sql'), ('0002_functions.sql'), ('0003_seed.sql'), ('0004_skincare_dummies.sql'),
  ('supabase_full_migration.sql')
on conflict do nothing;

commit;