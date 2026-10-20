-- Private catalog for independently managed static sites; no Appwrite or 1HourMart data.
create table if not exists public.sites (
  id uuid primary key,
  slug text not null unique,
  payload jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint sites_slug_format check (length(slug) <= 50 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint sites_payload_object check (jsonb_typeof(payload) = 'object')
);
create index if not exists sites_updated_at_idx on public.sites (updated_at desc);
alter table public.sites enable row level security;
revoke all on table public.sites from public, anon, authenticated;
grant all on table public.sites to service_role;

-- Optional durable publisher credential fallback when a deployment secret is not provisioned.
-- Values are AES-GCM ciphertext encrypted by the Edge Function with a service-role-derived key.
create table if not exists public.site_manager_secrets (
  id text primary key check (id = 'github_publisher'),
  iv text not null,
  ciphertext text not null,
  tag text not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.site_manager_secrets enable row level security;
revoke all on table public.site_manager_secrets from public, anon, authenticated;
grant all on table public.site_manager_secrets to service_role;

-- Strictly increasing server-generated revision for Edge compare-and-swap updates.
create or replace function public.site_catalog_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond'); return new; end; $$;
drop trigger if exists sites_touch_updated_at on public.sites;
create trigger sites_touch_updated_at before update on public.sites
for each row execute function public.site_catalog_touch_updated_at();
