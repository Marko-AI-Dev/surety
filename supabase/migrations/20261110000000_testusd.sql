-- TESTUSD, our self-issued test dollar. A job or an escrow holds exactly one amount: integer drops for
-- XRP, or integer cents for TESTUSD. Existing rows become XRP through the column default.

alter table jobs
  add column asset text not null default 'XRP' check (asset in ('XRP', 'TESTUSD')),
  add column amount_testusd_cents numeric(20,0) check (amount_testusd_cents > 0),
  alter column amount_drops drop not null,
  add constraint jobs_one_amount check (
    (asset = 'XRP' and amount_drops is not null and amount_testusd_cents is null)
    or (asset = 'TESTUSD' and amount_testusd_cents is not null and amount_drops is null)
  );

alter table escrows
  add column asset text not null default 'XRP' check (asset in ('XRP', 'TESTUSD')),
  add column amount_testusd_cents numeric(20,0) check (amount_testusd_cents > 0),
  -- The TESTUSD issuer the signer locked against. Present exactly when the escrow is TESTUSD.
  add column issuer text,
  alter column amount_drops drop not null,
  add constraint escrows_one_amount check (
    (asset = 'XRP' and amount_drops is not null and amount_testusd_cents is null)
    or (asset = 'TESTUSD' and amount_testusd_cents is not null and amount_drops is null)
  ),
  add constraint escrows_issuer_matches_asset check ((asset = 'TESTUSD') = (issuer is not null));
