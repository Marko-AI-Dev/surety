-- Phase 4d: the inspector's second key. A person reads the bill of lading number off the shipment and
-- attests it (or refuses). One attestation per deal, never updated or deleted; Surety Verify releases a
-- sourcing deal only when the attested number matches the supplier's documents.

create table inspections (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references deals(id),
  job_id uuid not null unique references jobs(id),
  inspector text not null check (char_length(inspector) between 1 and 120),
  bl_number text not null check (char_length(bl_number) between 1 and 120),
  outcome text not null check (outcome in ('attested', 'refused')),
  note text not null default '' check (char_length(note) <= 280),
  created_at timestamptz not null default clock_timestamp()
);

create function inspections_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'inspections is append-only: % is not allowed', tg_op;
end;
$$;

create trigger inspections_append_only
  before update or delete on inspections
  for each row execute function inspections_append_only();

alter table inspections enable row level security;
