-- What the buyer tells its negotiator during a negotiation. The negotiator reads these with its view
-- of the sourcing; they never reach a supplier.

create table buyer_notes (
  id uuid primary key default gen_random_uuid(),
  sourcing_id uuid not null references sourcings(id),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default clock_timestamp()
);

create index buyer_notes_sourcing_idx on buyer_notes (sourcing_id, created_at);

alter table buyer_notes enable row level security;
