-- Guards for resuming evaluations a dead worker left behind, without leases.

-- One verdict per job and deliverable: two evaluators racing on the same job cannot both record
-- one. The loser re-reads the winner's decision.
alter table decisions
  add constraint decisions_job_id_deliverable_hash_key unique (job_id, deliverable_hash);

-- How many times an EVALUATING job has been picked up again after its evaluator died. Bounded by
-- the engine, so a job whose evaluation always fails is held for review instead of retried forever.
alter table jobs
  add column evaluation_resumes integer not null default 0 check (evaluation_resumes >= 0);
