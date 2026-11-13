-- The buyer's side of a negotiation: what the buyer changed since the brief, the messages that wait
-- for the buyer before they go to a supplier (and the ones the buyer wrote), and the buyer's chat with
-- its own agent. None of it moves money, and none of it reaches a supplier except a sent draft, which
-- is stored as an ordinary chat message at that moment.

create table buyer_controls (
  sourcing_id uuid primary key references sourcings(id),
  autonomy text check (autonomy in ('full', 'approve')),
  push text check (push in ('gentle', 'firm')),
  wrap_up_at timestamptz
);

alter table buyer_controls enable row level security;

create table message_drafts (
  id uuid primary key default gen_random_uuid(),
  sourcing_id uuid not null references sourcings(id),
  supplier text not null,
  author text not null check (author in ('negotiator', 'buyer')),
  body text not null check (char_length(body) between 1 and 1000),
  state text not null default 'pending' check (state in ('pending', 'sent', 'discarded')),
  sent_body text check (sent_body is null or char_length(sent_body) between 1 and 1000),
  message_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz
);

create index message_drafts_sourcing_idx on message_drafts (sourcing_id, created_at);

alter table message_drafts enable row level security;

create table buyer_chat (
  id uuid primary key default gen_random_uuid(),
  sourcing_id uuid not null references sourcings(id),
  role text not null check (role in ('buyer', 'agent')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp()
);

create index buyer_chat_sourcing_idx on buyer_chat (sourcing_id, created_at);

alter table buyer_chat enable row level security;
