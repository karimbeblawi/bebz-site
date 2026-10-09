-- Run once in the Supabase SQL editor before deploying the site.
-- Service role (API) can read/write; browsers cannot.

create table if not exists device_presence (
  device_id text not null,
  app_id text not null,
  seen_at timestamptz not null default now(),
  linked_at timestamptz,
  roku_client_id text,
  build text,
  app_language text,
  primary key (device_id, app_id)
);

alter table device_presence add column if not exists linked_at timestamptz;

alter table device_presence enable row level security;

create index if not exists device_links_device_id_idx
  on device_links (device_id);

create index if not exists device_links_arabic_device_id_idx
  on device_links_arabic (device_id);

create index if not exists devices_roku_client_id_idx
  on devices (roku_client_id);

create index if not exists devices_arabic_roku_client_id_idx
  on devices_arabic (roku_client_id);
