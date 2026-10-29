-- Restore the durable claim store used by existing client relationship workers.
-- Creating this table does not enqueue or send messages.
create table if not exists public.client_relationship_messages (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    client_id uuid references public.clients(id) on delete cascade,
    client_service_id uuid references public.client_services(id) on delete set null,
    message_type text not null,
    occurrence_key text not null,
    status text not null default 'processing',
    sent_at timestamptz,
    last_error text
);
create unique index if not exists idx_client_relationship_messages_occurrence_unique
    on public.client_relationship_messages(client_id, message_type, occurrence_key);
create index if not exists idx_client_relationship_messages_status
    on public.client_relationship_messages(status, updated_at);
alter table public.client_relationship_messages enable row level security;
revoke all on table public.client_relationship_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.client_relationship_messages to service_role;
