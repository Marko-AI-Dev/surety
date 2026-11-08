import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Job,
  type JobsRepo,
  createMemoryRepo,
  fundJob,
  operationId,
  runExpirySweep,
} from "../src/index";
import { FakeSigner, signerError } from "./fake-signer";
import { newJob, walk } from "./repo-contract";

const CLOSE = 800_000_000;
const WINDOW = 120;
const CANCEL_AFTER = CLOSE + WINDOW;

let repo: JobsRepo;
let signer: FakeSigner;

async function fundedJob(): Promise<Job> {
  const job = await repo.createJob(newJob({ cancelAfterSeconds: WINDOW }));
  return fundJob({ repo, signer, actor: "buyer-agent" }, job.id);
}

function sweep(closeTime: number, log?: (line: string) => void) {
  return runExpirySweep({ repo, signer, ledgerCloseTime: async () => closeTime, log });
}

async function states(jobId: string) {
  return (await repo.listEvents(jobId)).map((e) => e.toState);
}

beforeEach(() => {
  repo = createMemoryRepo();
  signer = new FakeSigner(CLOSE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runExpirySweep: ledger time decides", () => {
  it("does nothing before cancel_after even when the laptop clock says 2099", async () => {
    const job = await fundedJob();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));

    const report = await sweep(CANCEL_AFTER - 10);

    expect(report).toEqual({ closeTime: CANCEL_AFTER - 10, refunded: [], pending: [], reconciliation: [] });
    expect((await repo.getJob(job.id))?.state).toBe("LOCKED");
    expect(signer.count("cancel")).toBe(0);
  });

  it("does nothing when ledger time equals cancel_after: XRPL needs it strictly past", async () => {
    const job = await fundedJob();
    expect((await sweep(CANCEL_AFTER)).refunded).toEqual([]);
    expect((await repo.getJob(job.id))?.state).toBe("LOCKED");
  });

  it("refunds once ledger time passes cancel_after even when the laptop clock says 2001", async () => {
    const job = await fundedJob();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
    const lines: string[] = [];

    const report = await sweep(CANCEL_AFTER + 1, (l) => lines.push(l));

    expect(report).toEqual({ closeTime: CANCEL_AFTER + 1, refunded: [job.id], pending: [], reconciliation: [] });
    expect((await repo.getJob(job.id))?.state).toBe("REFUNDED");
    const events = await repo.listEvents(job.id);
    expect(events.slice(2).map((e) => [e.fromState, e.toState, e.actor])).toEqual([
      ["LOCKED", "EXPIRED_AWAITING_CANCEL", "expiry-worker"],
      ["EXPIRED_AWAITING_CANCEL", "CANCEL_PENDING", "expiry-worker"],
      ["CANCEL_PENDING", "REFUNDED", "expiry-worker"],
    ]);
    expect(events[2]?.reasonCodes).toEqual(["ledger_time_past_cancel_after"]);
    const escrow = await repo.getEscrow(job.id);
    expect(signer.calls.at(-1)).toMatchObject({
      method: "cancel",
      req: { opId: operationId(job.id, "cancel"), owner: escrow?.owner, offerSequence: escrow?.offerSequence },
    });
    expect((await repo.listTransactions(job.id)).find((t) => t.type === "cancel")).toMatchObject({
      status: "validated",
      result: "tesSUCCESS",
      feeDrops: "12",
    });
    expect(lines.some((l) => l.includes("refunded") && l.includes(job.id))).toBe(true);
  });
});

describe("runExpirySweep: restart safety", () => {
  it("a brand-new sweep after a restart refunds a job the first sweep saw before expiry", async () => {
    const job = await fundedJob();
    const before = await runExpirySweep({ repo, signer, ledgerCloseTime: async () => CANCEL_AFTER - 5 });
    expect(before.refunded).toEqual([]);

    // Nothing carried over in memory: a new deps object, same database and signer.
    const restarted = { repo, signer, ledgerCloseTime: async () => CANCEL_AFTER + 30 };
    const after = await runExpirySweep(restarted);

    expect(after.refunded).toEqual([job.id]);
    expect(signer.opIds("cancel")).toEqual([operationId(job.id, "cancel")]);
  });

  it("keeps CANCEL_PENDING through op_pending, ledger_failure and an unreachable signer, then refunds with the same opId", async () => {
    const job = await fundedJob();
    const opId = operationId(job.id, "cancel");
    signer.script(opId, signerError("op_pending"), signerError("ledger_failure"), new TypeError("fetch failed"));

    for (let i = 0; i < 3; i++) {
      const report = await sweep(CANCEL_AFTER + 1 + i);
      expect(report.pending).toEqual([job.id]);
      expect(report.refunded).toEqual([]);
      expect((await repo.getJob(job.id))?.state).toBe("CANCEL_PENDING");
      expect(await states(job.id)).not.toContain("REFUNDED");
    }

    const report = await sweep(CANCEL_AFTER + 10);

    expect(report.refunded).toEqual([job.id]);
    expect(signer.count("cancel")).toBe(4);
    expect(signer.opIds("cancel")).toEqual([opId]);
    expect((await repo.listTransactions(job.id)).filter((t) => t.type === "cancel")).toHaveLength(1);
  });

  it("retries a conclusively failed cancel (op_failed) with the next attempt's opId and refunds", async () => {
    const job = await fundedJob();
    const first = operationId(job.id, "cancel", 0);
    const second = operationId(job.id, "cancel", 1);
    signer.script(first, signerError("op_failed"));

    const failed = await sweep(CANCEL_AFTER + 1);
    expect(failed.pending).toEqual([job.id]);
    expect((await repo.getJob(job.id))?.state).toBe("CANCEL_PENDING");

    const report = await sweep(CANCEL_AFTER + 5);

    expect(report.refunded).toEqual([job.id]);
    expect(signer.opIds("cancel")).toEqual([first, second]);
    expect(
      (await repo.listTransactions(job.id)).filter((t) => t.type === "cancel").map((t) => [t.operationId, t.status]),
    ).toEqual([
      [first, "failed"],
      [second, "validated"],
    ]);
  });

  it("gives up after three conclusively failed cancels: RECONCILIATION_REQUIRED with cancel_unresolved", async () => {
    const job = await fundedJob();
    for (const attempt of [0, 1, 2]) signer.script(operationId(job.id, "cancel", attempt), signerError("op_failed"));

    const reports = [];
    for (let i = 0; i < 3; i++) reports.push(await sweep(CANCEL_AFTER + 1 + i));

    expect(reports.map((r) => r.pending)).toEqual([[job.id], [job.id], []]);
    expect(reports[2]?.reconciliation).toEqual([job.id]);
    const events = await repo.listEvents(job.id);
    expect(events.at(-1)).toMatchObject({ toState: "RECONCILIATION_REQUIRED", reasonCodes: ["cancel_unresolved"] });
    expect(events.map((e) => e.toState)).not.toContain("REFUNDED");
    expect(signer.opIds("cancel")).toHaveLength(3);

    await sweep(CANCEL_AFTER + 100);
    expect(signer.count("cancel")).toBe(3);
  });

  it("treats cancel_not_yet_eligible from the signer as pending", async () => {
    const job = await fundedJob();
    signer.script(operationId(job.id, "cancel"), signerError("cancel_not_yet_eligible"));

    const report = await sweep(CANCEL_AFTER + 1);

    expect(report.pending).toEqual([job.id]);
    expect((await repo.getJob(job.id))?.state).toBe("CANCEL_PENDING");
  });
});

describe("runExpirySweep: resumes funding a crash left in CREATE_PENDING", () => {
  // A repo whose named method throws once, as if the process died at that point.
  function crashOnce(method: "attachEscrow" | "transition"): JobsRepo {
    let crashed = false;
    const crash = () => {
      if (crashed) return;
      crashed = true;
      throw new Error("process died");
    };
    return {
      ...repo,
      attachEscrow: async (row) => {
        if (method === "attachEscrow") crash();
        return repo.attachEscrow(row);
      },
      transition: async (id, from, to, event) => {
        if (method === "transition" && to === "LOCKED") crash();
        return repo.transition(id, from, to, event);
      },
    };
  }

  it("resumes a job that died after the signer validated the create but before storing the escrow", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const job = await repo.createJob(newJob({ cancelAfterSeconds: WINDOW }));
    await expect(fundJob({ repo: crashOnce("attachEscrow"), signer, actor: "buyer-agent" }, job.id)).rejects.toThrow(
      "process died",
    );
    expect(await repo.getEscrow(job.id)).toBeNull();

    // Too fresh: the original caller may still be finishing it.
    await sweep(CLOSE + 10);
    expect((await repo.getJob(job.id))?.state).toBe("CREATE_PENDING");

    vi.setSystemTime(new Date("2026-11-09T10:00:31Z"));
    await sweep(CLOSE + 20);
    expect((await repo.getJob(job.id))?.state).toBe("LOCKED");
    expect((await repo.getEscrow(job.id))?.cancelAfter).toBe(CANCEL_AFTER);

    const report = await sweep(CANCEL_AFTER + 1);
    expect(report.refunded).toEqual([job.id]);
    expect(signer.opIds("create")).toEqual([operationId(job.id, "create")]);
  });

  it("resumes a job that died after storing the escrow, on the very next sweep", async () => {
    const job = await repo.createJob(newJob({ cancelAfterSeconds: WINDOW }));
    await expect(fundJob({ repo: crashOnce("transition"), signer, actor: "buyer-agent" }, job.id)).rejects.toThrow(
      "process died",
    );

    await sweep(CLOSE + 10);
    expect((await repo.getJob(job.id))?.state).toBe("LOCKED");

    expect((await sweep(CANCEL_AFTER + 1)).refunded).toEqual([job.id]);
    expect(signer.opIds("create")).toEqual([operationId(job.id, "create")]);
  });
});

describe("runExpirySweep: what it must never do", () => {
  it.each(["escrow_not_found", "escrow_mismatch"])(
    "moves the job to RECONCILIATION_REQUIRED on %s, never REFUNDED, and leaves it alone afterwards",
    async (code) => {
      const job = await fundedJob();
      signer.script(operationId(job.id, "cancel"), signerError(code));

      const report = await sweep(CANCEL_AFTER + 1);

      expect(report.reconciliation).toEqual([job.id]);
      expect(report.refunded).toEqual([]);
      const events = await repo.listEvents(job.id);
      expect(events.at(-1)).toMatchObject({ toState: "RECONCILIATION_REQUIRED", reasonCodes: [code] });
      expect(events.map((e) => e.toState)).not.toContain("REFUNDED");

      await sweep(CANCEL_AFTER + 100);
      expect(signer.count("cancel")).toBe(1);
    },
  );

  it("never sweeps a PAID job", async () => {
    const job = await fundedJob();
    await walk(repo, job, ["IN_PROGRESS", "DELIVERED", "EVALUATING", "APPROVED", "FINISH_PENDING", "PAID"]);

    const report = await sweep(CANCEL_AFTER + 1);

    expect(report).toEqual({ closeTime: CANCEL_AFTER + 1, refunded: [], pending: [], reconciliation: [] });
    expect(signer.count("cancel")).toBe(0);
  });

  it("skips a job another sweep already moved, without calling the signer", async () => {
    const job = await fundedJob();
    // A listing taken before the other sweep acted, so this sweep's from-state is stale.
    const stale = await repo.listDueForCancel(CANCEL_AFTER + 1);
    await walk(repo, job, ["EXPIRED_AWAITING_CANCEL"]);
    const racing: JobsRepo = { ...repo, listDueForCancel: async () => stale };

    const report = await runExpirySweep({ repo: racing, signer, ledgerCloseTime: async () => CANCEL_AFTER + 1 });

    expect(report).toEqual({ closeTime: CANCEL_AFTER + 1, refunded: [], pending: [], reconciliation: [] });
    expect(signer.count("cancel")).toBe(0);
  });

  it("keeps going when one job fails", async () => {
    const first = await fundedJob();
    const second = await fundedJob();
    signer.script(operationId(first.id, "cancel"), new TypeError("fetch failed"));
    const lines: string[] = [];

    const report = await sweep(CANCEL_AFTER + 1, (l) => lines.push(l));

    expect(report.pending).toEqual([first.id]);
    expect(report.refunded).toEqual([second.id]);
    expect(lines.some((l) => l.includes("pending") && l.includes(first.id))).toBe(true);
  });
});
