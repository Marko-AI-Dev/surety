-- Sourcing: the buyer's brief to its agent team, the invited suppliers and their committed quotes,
-- every chat message with its bouncer result, supplier suggestions and the operator's reviews.

create table sourcings (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null check (ref ~ '^SR-[A-Z0-9-]{1,24}$'),
  brief jsonb not null,
  state text not null constraint sourcings_state_check check (state in ('OPEN', 'SELECTED', 'CLOSED')),
  negotiation_ends_at timestamptz not null,
  selected_supplier text,
  deal_id uuid unique references deals(id),
  created_at timestamptz not null default now(),
  constraint sourcings_selected_has_deal check ((state = 'SELECTED') = (deal_id is not null))
);

create table sourcing_suppliers (
  sourcing_id uuid not null references sourcings(id),
  address text not null check (address ~ '^r[1-9A-HJ-NP-Za-km-z]{24,34}$'),
  name text not null,
  invited_at timestamptz not null default clock_timestamp(),
  quote jsonb,
  quote_hash text check (quote_hash ~ '^[0-9a-f]{64}$'),
  deal_id uuid unique references deals(id),
  primary key (sourcing_id, address),
  constraint sourcing_suppliers_quote_has_hash check ((quote is null) = (quote_hash is null))
);

create table sourcing_messages (
  id bigint generated always as identity primary key,
  sourcing_id uuid not null,
  supplier text not null,
  kind text not null check (kind in ('to_supplier', 'from_supplier', 'report')),
  body text not null,
  delivered_body text,
  verdict text not null check (verdict in ('deliver', 'quarantine')),
  card text check (card in ('yellow', 'red')),
  screen jsonb,
  offer jsonb,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (sourcing_id, supplier) references sourcing_suppliers (sourcing_id, address),
  constraint sourcing_messages_delivered_has_body check ((verdict = 'deliver') = (delivered_body is not null))
);

create table supplier_suggestions (
  id uuid primary key default gen_random_uuid(),
  sourcing_id uuid not null references sourcings(id),
  name text not null,
  address text not null check (address ~ '^r[1-9A-HJ-NP-Za-km-z]{24,34}$'),
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table supplier_reviews (
  id uuid primary key default gen_random_uuid(),
  address text not null check (address ~ '^r[1-9A-HJ-NP-Za-km-z]{24,34}$'),
  note text not null,
  cleared_at timestamptz not null default clock_timestamp()
);

create index sourcings_created_at_idx on sourcings (created_at desc, id);
create index sourcing_suppliers_address_idx on sourcing_suppliers (address, invited_at desc);
create index sourcing_messages_sourcing_idx on sourcing_messages (sourcing_id, id);
create index sourcing_messages_cards_idx on sourcing_messages (supplier, created_at) where card is not null;
create index sourcing_messages_quarantine_idx on sourcing_messages (id desc) where verdict = 'quarantine';
create index supplier_reviews_address_idx on supplier_reviews (address, cleared_at desc);

-- The chat record: rows are only ever added.
create function sourcing_messages_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'sourcing_messages is append-only: % is not allowed', tg_op;
end;
$$;

create trigger sourcing_messages_append_only
  before update or delete on sourcing_messages
  for each row execute function sourcing_messages_append_only();

alter table sourcings enable row level security;
alter table sourcing_suppliers enable row level security;
alter table sourcing_messages enable row level security;
alter table supplier_suggestions enable row level security;
alter table supplier_reviews enable row level security;
