import { beforeEach, describe, expect, it } from "vitest";
import { SignerClientError } from "@surety/signer-client";
import { type JobsRepo, TransitionError, createMemoryRepo, fundJob, operationId } from "../src/index";
import { FakeSigner, signerError } from "./fake-signer";
import { newJob, walk } from "./repo-contract";

const CLOSE = 800_000_000;
let repo: JobsRepo;
let signer: FakeSigner;

const deps = () => ({ repo, signer, actor: "buyer-agent" });

beforeEach(() => {
  repo = createMemoryRepo();
  signer = new FakeSigner(CLOSE);
});

describe("fundJob", () => {
  it("locks a draft job: escrow stored, create tx validated, events DRAFT -> CREATE_PENDING -> LOCKED", async () => {
    const job = await repo.createJob(newJob({ cancelAfterSeconds: 120 }));
    const opId = operationId(job.id, "create");

    const locked = await fundJob(deps(), job.id);

    expect(locked).toMatchObject({ id: job.id, state: "LOCKED", version: 2 });
    expect(signer.calls).toEqual([
      {
        method: "create",
        opId,
        req: {
          opId,
          jobRef: job.ref,
          destination: job.sellerAddress,
          amountDrops: job.amountDrops,
          cancelAfterSeconds: 120,
        },
      },
    ]);
    const escrow = await repo.getEscrow(job.id);
    expect(escrow).toMatchObject({
      jobId: job.id,
      owner: signer.buyer,
      destination: job.sellerAddress,
      amountDrops: job.amountDrops,
      cancelAfter: CLOSE + 120,
    });
    const [tx] = await repo.listTransactions(job.id);
    expect(tx).toMatchObject({ operationId: opId, type: "create", status: "validated", result: "tesSUCCESS" });
    expect(tx?.txHash).toBe(escrow?.createTxHash);
    const events = await repo.listEvents(job.id);
    expect(events.map((e) => [e.fromState, e.toState])).toEqual([
      ["DRAFT", "CREATE_PENDING"],
      ["CREATE_PENDING", "LOCKED"],
    ]);
    expect(events[1]).toMatchObject({
      actor: "buyer-agent",
      reasonCodes: ["validated_tesSUCCESS"],
      detail: { txHash: escrow?.createTxHash },
    });
  });

  it("ends CREATE_FAILED when the signer refuses the amount, recording the refusal", async () => {
    const job = await repo.createJob(newJob());
    signer.script(operationId(job.id, "create"), signerError("amount_over_cap"));

    const failed = await fundJob(deps(), job.id);

    expect(failed.state).toBe("CREATE_FAILED");
    expect(await repo.getEscrow(job.id)).toBeNull();
    expect(await repo.listTransactions(job.id)).toMatchObject([
      { type: "create", status: "failed", result: "amount_over_cap", txHash: null },
    ]);
    const events = await repo.listEvents(job.id);
    expect(events.at(-1)).toMatchObject({ toState: "CREATE_FAILED", reasonCodes: ["amount_over_cap"] });
  });

  it("ends CREATE_FAILED when the signer reports the create failed conclusively (op_failed)", async () => {
    const job = await repo.createJob(newJob());
    signer.script(operationId(job.id, "create"), signerError("op_failed"));

    const failed = await fundJob(deps(), job.id);

    expect(failed.state).toBe("CREATE_FAILED");
    expect(await repo.getEscrow(job.id)).toBeNull();
    expect(await repo.listTransactions(job.id)).toMatchObject([{ type: "create", status: "failed", result: "op_failed" }]);
    expect((await repo.listEvents(job.id)).at(-1)).toMatchObject({ toState: "CREATE_FAILED", reasonCodes: ["op_failed"] });
  });

  it("stays CREATE_PENDING on ledger_failure and resumes with the same opId to reach LOCKED", async () => {
    const job = await repo.createJob(newJob());
    signer.script(operationId(job.id, "create"), signerError("ledger_failure"));

    await expect(fundJob(deps(), job.id)).rejects.toBeInstanceOf(SignerClientError);
    expect((await repo.getJob(job.id))?.state).toBe("CREATE_PENDING");

    const locked = await fundJob(deps(), job.id);

    expect(locked.state).toBe("LOCKED");
    expect(signer.count("create")).toBe(2);
    expect(signer.opIds("create")).toEqual([operationId(job.id, "create")]);
    expect(await repo.listTransactions(job.id)).toHaveLength(1);
  });

  it("resumes after a crash between storing the escrow and the LOCKED transition", async () => {
    const job = await repo.createJob(newJob());
    let crashed = false;
    const crashing: JobsRepo = {
      ...repo,
      transition: async (id, from, to, event) => {
        if (to === "LOCKED" && !crashed) {
          crashed = true;
          throw new Error("process died");
        }
        return repo.transition(id, from, to, event);
      },
    };
    await expect(fundJob({ repo: crashing, signer, actor: "buyer-agent" }, job.id)).rejects.toThrow("process died");
    expect(await repo.getEscrow(job.id)).not.toBeNull();

    const locked = await fundJob(deps(), job.id);

    expect(locked.state).toBe("LOCKED");
    expect(signer.opIds("create")).toEqual([operationId(job.id, "create")]);
  });

  it("refuses a job that is past funding without calling the signer", async () => {
    const job = await repo.createJob(newJob());
    await fundJob(deps(), job.id);
    const inProgress = await walk(repo, (await repo.getJob(job.id))!, ["IN_PROGRESS"]);

    await expect(fundJob(deps(), inProgress.id)).rejects.toBeInstanceOf(TransitionError);
    expect(signer.count("create")).toBe(1);
  });
});
