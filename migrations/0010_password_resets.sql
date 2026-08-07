-- Password reset tokens. Only the SHA-256 hash of the token is stored — a
-- database leak must not hand out working reset links.

create table if not exists password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists password_reset_tokens_customer_idx
  on password_reset_tokens (customer_id);

-- ---------- RLS (deny-all, same posture as everything else) ----------

alter table password_reset_tokens enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on password_reset_tokens from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on password_reset_tokens from authenticated;
  end if;
end $$;
