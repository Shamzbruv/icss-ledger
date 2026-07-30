create table if not exists public.link_hub_settings (
    id integer primary key check (id = 1),
    content jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.link_hub_settings enable row level security;

-- The server uses its service-role connection. Public access is provided only
-- through GET /api/link-hub; writes pass through the authenticated admin API.
