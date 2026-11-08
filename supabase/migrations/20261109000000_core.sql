-- Surety core schema: the database mirrors job state; the XRPL ledger is settlement truth.
-- Drops are numeric(20,0) (returned to TypeScript as strings). Ripple time is integer seconds.

create table jobs (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null check (ref ~ '^[A-Za-z0-9._:-]{1,64}$'),
  network text not null default 'testnet' check (network = 'testnet'),
  buyer_address text not null,
  seller_address text not null,
  amount_drops numeric(20,0) not null check (amount_drops > 0),
  source_text text not null,
  criteria jsonb not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  policy_version text not null,
  cancel_after_seconds integer not null check (cancel_after_seconds between 60 and 86400),
  state text not null default 'DRAFT' check (state in (
    'DRAFT', 'CREATE_PENDING', 'LOCKED', 'IN_PROGRESS', 'DELIVERED', 'EVALUATING', 'APPROVED',
    'FINISH_PENDING', 'PAID', 'REJECTED_AWAITING_EXPIRY', 'REVIEW_REQUIRED', 'EXPIRED_AWAITING_CANCEL',
    'CANCEL_PENDING', 'REFUNDED', 'CREATE_FAILED', 'RECONCILIATION_REQUIRED'
  )),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table escrows (
  job_id uuid primary key references jobs(id),
  network text not null check (network = 'testnet'),
  owner text not null,
  offer_sequence integer not null,
  destination text not null,
  amount_drops numeric(20,0) not null,
  condition text not null,
  cancel_after integer not null,
  create_tx_hash text not null unique,
  create_ledger_index integer not null,
  unique (network, owner, offer_sequence)
);

create table transactions (
  id bigint generated always as identity primary key,
  operation_id uuid not null unique,
  job_id uuid not null references jobs(id),
  type text not null check (type in ('create', 'finish', 'cancel')),
  tx_hash text unique,
  status text not null check (status in ('pending', 'validated', 'failed')),
  result text,
  ledger_index integer,
  fee_drops numeric(20,0),
  submitted_at timestamptz not null default now(),
  validated_at timestamptz
);

create table job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references jobs(id),
  from_state text,
  to_state text not null,
  actor text not null,
  reason_codes text[] not null default '{}',
  correlation_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index jobs_state_idx on jobs (state);
create index escrows_cancel_after_idx on escrows (cancel_after);
create index job_events_job_id_id_idx on job_events (job_id, id);

-- The event log is the audit trail: rows are only ever added.
create function job_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'job_events is append-only: % is not allowed', tg_op;
end;
$$;

create trigger job_events_append_only
  before update or delete on job_events
  for each row execute function job_events_append_only();

-- Browser access arrives in Phase 5 with explicit policies. Until then nothing but the backend
-- (connecting as postgres, which bypasses RLS) can read or write these tables.
alter table jobs enable row level security;
alter table escrows enable row level security;
alter table transactions enable row level security;
alter table job_events enable row level security;
