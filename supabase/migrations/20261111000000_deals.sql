-- Deals: an import purchase before its escrow lock. The intent, the supplier's quote and the deal
-- agent's decision. Accepting a quote creates the escrow job in the same transaction that sets job_id.

create table deals (
  id uuid primary key default gen_random_uuid(),
  -- The purchase order number; the escrow job uses it as its ref.
  ref text unique not null check (ref ~ '^PO-[A-Z0-9-]{1,28}$'),
  intent jsonb not null,
  intent_hash text not null check (intent_hash ~ '^[0-9a-f]{64}$'),
  quote jsonb,
  quote_hash text check (quote_hash ~ '^[0-9a-f]{64}$'),
  quote_checks jsonb,
  decision jsonb,
  state text not null constraint deals_state_check check (state in (
    'POLICY_REFUSED', 'AWAITING_QUOTE', 'QUOTE_RECEIVED', 'DECLINED', 'ACCEPTED'
  )),
  job_id uuid unique references jobs(id),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deals_accepted_has_job check ((state = 'ACCEPTED') = (job_id is not null)),
  constraint deals_quote_has_hash check ((quote is null) = (quote_hash is null))
);

create table deal_events (
  id bigint generated always as identity primary key,
  deal_id uuid not null references deals(id),
  from_state text,
  to_state text not null,
  actor text not null,
  reason_codes text[] not null default '{}',
  detail jsonb,
  created_at timestamptz not null default now()
);

create index deals_created_at_idx on deals (created_at desc, id);
create index deal_events_deal_id_id_idx on deal_events (deal_id, id);

-- The deal's audit trail: rows are only ever added.
create function deal_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'deal_events is append-only: % is not allowed', tg_op;
end;
$$;

create trigger deal_events_append_only
  before update or delete on deal_events
  for each row execute function deal_events_append_only();

-- Every answer behind a borderline decision that was asked three times (median of three).
alter table decisions add column samples jsonb;

alter table deals enable row level security;
alter table deal_events enable row level security;
