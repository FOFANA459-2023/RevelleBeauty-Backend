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
