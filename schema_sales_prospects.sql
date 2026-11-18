create table public.sales_prospects (
 id uuid primary key default gen_random_uuid(),
 business text not null check (trim(business) <> ''),
 contact_name text, email text not null check (email ~ '^[^ @]+@[^ @]+\.[^ @]+$'), phone text, whatsapp text,
 location text, source_url text not null check (source_url ~ '^https://'),
 product text not null check (product in ('ICSS Bookings','ICSS Plaza','iCreate Solutions & Services')),
 fit text not null, email_draft text not null, whatsapp_draft text not null, call_script text not null,
 discovered_on date not null default (now() at time zone 'America/Jamaica')::date,
 stage integer not null default 0 check (stage between 0 and 5),
 suppressed boolean not null default false, follow_up date, notes text not null default '', revision integer not null default 0
);
create unique index sales_prospect_email on public.sales_prospects(lower(trim(email)));
create unique index sales_prospect_business on public.sales_prospects(lower(trim(business)));
create index sales_prospect_queue on public.sales_prospects(discovered_on desc,id);
alter table public.sales_prospects enable row level security;
revoke all on public.sales_prospects from public, anon, authenticated;
grant select,insert,update on public.sales_prospects to service_role;
grant select on public.sales_prospects to authenticated;
grant update(stage,suppressed,follow_up,notes,revision) on public.sales_prospects to authenticated;
create policy prospect_owner_read on public.sales_prospects for select to authenticated
using ((select auth.uid()) = 'a339e1af-365a-40f7-82fa-01aff0b5a3ec'::uuid);
create policy prospect_owner_update on public.sales_prospects for update to authenticated
using ((select auth.uid()) = 'a339e1af-365a-40f7-82fa-01aff0b5a3ec'::uuid)
with check ((select auth.uid()) = 'a339e1af-365a-40f7-82fa-01aff0b5a3ec'::uuid);
