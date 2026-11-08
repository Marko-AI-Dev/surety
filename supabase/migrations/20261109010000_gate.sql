-- Surety verification gate: the delivered answer, every decision about it, and the one-use
-- authorizations the gate mints for the signer.

alter table jobs
  add column criteria_text text,
  add column deliverable jsonb,
  add column deliverable_hash text check (deliverable_hash ~ '^[0-9a-f]{64}$'),
  add column delivered_at timestamptz;

-- One row per judgement. mode, provider and model are null when no engine was asked (a failed rule
-- is declined without calling Jev). Scores are the provider's raw probabilities.
create table decisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  request_id uuid unique not null,
  mode text check (mode in ('live', 'fixture')),
  outcome text not null check (outcome in ('APPROVE', 'DECLINE', 'ESCALATE', 'UNAVAILABLE')),
  satisfaction numeric,
  injection_risk numeric,
  provider text,
  model text,
  latency_ms integer,
  cost_usd numeric,
  reason_codes text[] not null default '{}',
  rules jsonb not null,
  policy_version text not null,
  deliverable_hash text not null check (deliverable_hash ~ '^[0-9a-f]{64}$'),
  decided_at timestamptz not null default now()
);

-- Trusted services only. A retry reuses its row; a new attempt gets a new row and operation id.
create table authorizations (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decisions(id),
  job_id uuid not null references jobs(id),
  attempt integer not null check (attempt >= 0),
  operation_id uuid not null unique,
  binding_hash text not null unique,
  signed jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  unique (decision_id, attempt)
);

create index decisions_job_id_decided_at_idx on decisions (job_id, decided_at);
create index authorizations_job_id_idx on authorizations (job_id);

alter table decisions enable row level security;
alter table authorizations enable row level security;
