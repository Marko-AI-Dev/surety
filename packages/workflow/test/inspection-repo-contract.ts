import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@surety/contracts";
import {
  AttestationConflict,
  type DealsRepo,
  InspectionClosed,
  type InspectionRepo,
  type Job,
  type JobState,
  type JobsRepo,
  type NewAttestation,
} from "../src/index";
import { quote } from "../../../scripts/deal-fixtures";
import { acceptDecision, dealJob, newIntent } from "./deal-repo-contract";
import { escrowFor, walk } from "./repo-contract";

// One behavioural suite for every InspectionRepo implementation: in-memory (pnpm test) and Postgres (pnpm test:db).

type Repo = JobsRepo & DealsRepo & InspectionRepo;

const hashOf = (v: unknown) => sha256Hex(canonicalJson(v));
const checks = { passed: true, results: [{ id: "quantity", status: "pass" as const }] };

// A deal accepted with its job walked along `path` (the job starts in DRAFT).
export async function dealWithJob(repo: Repo, path: JobState[]): Promise<{ dealId: string; job: Job }> {
  const intent = newIntent();
  const deal = await repo.createDeal(intent, "AWAITING_QUOTE", { actor: "policy", reasonCodes: ["policy_passed"] });
  await repo.saveQuote(deal.id, quote, hashOf(quote), checks, { actor: "supplier", reasonCodes: ["quote_received"] });
  const { job } = await repo.acceptDeal(deal.id, acceptDecision, dealJob(intent), { actor: "deal_agent", reasonCodes: ["agent_accepted"] });
  // A TESTUSD escrow needs its issuer (the same one fake-signer.ts reports).
  await repo.attachEscrow(escrowFor(job, Math.floor(Date.now() / 1000) + 600, { issuer: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" }));
  return { dealId: deal.id, job: await walk(repo, job, path) };
}

export const LOCKED: JobState[] = ["CREATE_PENDING", "LOCKED"];
export const DELIVERED: JobState[] = [...LOCKED, "IN_PROGRESS", "DELIVERED"];

export function attestation(dealId: string, jobId: string, overrides: Partial<NewAttestation> = {}): NewAttestation {
  return {
    dealId,
    jobId,
    inspector: "Port inspector (demo)",
    blNumber: "SZXDUR-55120",
    outcome: "attested",
    note: "400 cartons counted, seal intact",
    ...overrides,
  };
}

export function describeInspectionRepo(name: string, make: () => Promise<Repo>): void {
  describe(`InspectionRepo contract: ${name}`, () => {
    let repo: Repo;

    beforeEach(async () => {
      repo = await make();
    });

    afterEach(async () => {
      await repo.close();
    });

    it("an attestation is stored once and read back by job", async () => {
      const { dealId, job } = await dealWithJob(repo, LOCKED);
      const other = await dealWithJob(repo, LOCKED);
      const stored = await repo.addAttestation(attestation(dealId, job.id));
      expect(stored).toMatchObject(attestation(dealId, job.id));
      expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(stored.createdAt).toISOString()).toBe(stored.createdAt);
      expect(await repo.getAttestation(job.id)).toEqual(stored);
      expect(await repo.getAttestation(other.job.id)).toBeNull();
    });

    it("a LOCKED, IN_PROGRESS or DELIVERED job takes an attestation", async () => {
      for (const path of [LOCKED, [...LOCKED, "IN_PROGRESS" as const], DELIVERED]) {
        const { dealId, job } = await dealWithJob(repo, path);
        await expect(repo.addAttestation(attestation(dealId, job.id))).resolves.toMatchObject({ jobId: job.id });
      }
    });

    it("the same attestation again returns the stored row", async () => {
      const { dealId, job } = await dealWithJob(repo, DELIVERED);
      const first = await repo.addAttestation(attestation(dealId, job.id));
      expect(await repo.addAttestation(attestation(dealId, job.id))).toEqual(first);
    });

    it("a different outcome or B/L number throws AttestationConflict", async () => {
      const { dealId, job } = await dealWithJob(repo, DELIVERED);
      const first = await repo.addAttestation(attestation(dealId, job.id));
      await expect(repo.addAttestation(attestation(dealId, job.id, { outcome: "refused" }))).rejects.toBeInstanceOf(AttestationConflict);
      await expect(repo.addAttestation(attestation(dealId, job.id, { blNumber: "SZXDUR-55121" }))).rejects.toBeInstanceOf(AttestationConflict);
      await expect(repo.addAttestation(attestation(dealId, job.id, { note: "Seal broken" }))).rejects.toBeInstanceOf(AttestationConflict);
      expect(await repo.getAttestation(job.id)).toEqual(first);
    });

    it("a job in PAID, REFUNDED, EVALUATING or REVIEW_REQUIRED throws InspectionClosed and stores nothing", async () => {
      const paths: JobState[][] = [
        [...DELIVERED, "EVALUATING", "APPROVED", "FINISH_PENDING", "PAID"],
        [...LOCKED, "EXPIRED_AWAITING_CANCEL", "CANCEL_PENDING", "REFUNDED"],
        [...DELIVERED, "EVALUATING"],
        [...DELIVERED, "EVALUATING", "REVIEW_REQUIRED"],
        [],
      ];
      for (const path of paths) {
        const { dealId, job } = await dealWithJob(repo, path);
        await expect(repo.addAttestation(attestation(dealId, job.id))).rejects.toBeInstanceOf(InspectionClosed);
        expect(await repo.getAttestation(job.id)).toBeNull();
      }
    });

    it("an attestation naming a job the deal does not own throws InspectionClosed", async () => {
      const a = await dealWithJob(repo, DELIVERED);
      const b = await dealWithJob(repo, DELIVERED);
      await expect(repo.addAttestation(attestation(a.dealId, b.job.id))).rejects.toBeInstanceOf(InspectionClosed);
      expect(await repo.getAttestation(b.job.id)).toBeNull();
    });
  });
}
