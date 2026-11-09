import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Wallet } from "xrpl";
import type { ZodType } from "zod";
import {
  CancelEscrowRequestSchema,
  type CreateEscrowResponse,
  CreateEscrowRequestSchema,
  FinishEscrowRequestSchema,
  type HealthResponse,
  type SettleResponse,
  canonicalJson,
  sha256Hex,
  verifyAuthorization,
} from "@surety/contracts";
import {
  buildEscrowCancel,
  buildEscrowCreate,
  buildEscrowFinish,
  cancelAfterFrom,
  newPreimage,
  preimageCondition,
} from "@surety/xrpl-settlement";
import type { SignerConfig } from "./config";
import { SignerError } from "./errors";
import type { LedgerPort, SubmitResult } from "./ledger";
import { KeyedLock } from "./lock";
import { type Sealed, open, seal } from "./secretbox";
import { JsonFile } from "./store";

interface EscrowRecord {
  jobRef: string;
  owner: string;
  offerSequence: number;
  secretRef: string;
  condition: string;
  amountDrops: string;
  destination: string;
  cancelAfter: number;
  createTxHash: string;
  status: "locked" | "finished" | "cancelled";
  settleTxHash?: string;
}

type PendingCreate = Omit<EscrowRecord, "owner" | "createTxHash" | "status" | "settleTxHash">;

type OpType = "create" | "finish" | "cancel";

interface JournalEntry {
  opId: string;
  type: OpType;
  requestHash: string;
  status: "submitted" | "done" | "failed";
  txHash: string;
  lastLedgerSequence?: number;
  submittedAtLedger?: number;
  escrowKey: string;
  pending?: PendingCreate;
  response?: CreateEscrowResponse | SettleResponse;
  error?: string;
  updatedAt?: string;
}

export interface Signer {
  health(): Promise<HealthResponse>;
  createEscrow(req: unknown): Promise<CreateEscrowResponse>;
  finishEscrow(req: unknown): Promise<SettleResponse>;
  cancelEscrow(req: unknown): Promise<SettleResponse>;
}

export interface SignerDeps {
  config: SignerConfig;
  ledger: LedgerPort;
  buyer: Wallet;
  service: Wallet;
  now?: () => Date;
}

export function createSigner(deps: SignerDeps): Signer {
  const { config, ledger, buyer, service } = deps;
  const now = deps.now ?? (() => new Date());
  const escrows = new JsonFile<Record<string, EscrowRecord>>(join(config.dataDir, "escrows.json"), {});
  const secrets = new JsonFile<Record<string, Sealed>>(join(config.dataDir, "secrets.json"), {});
  const consumed = new JsonFile<Record<string, { opId: string; at: string }>>(
    join(config.dataDir, "consumed.json"),
    {},
  );
  const journal = new JsonFile<Record<string, JournalEntry>>(join(config.dataDir, "journal.json"), {});
  const locks = new KeyedLock();

  const escrowKey = (owner: string, offerSequence: number) => `${owner}:${offerSequence}`;

  function parse<T>(schema: ZodType<T>, raw: unknown): T {
    const r = schema.safeParse(raw);
    if (!r.success) {
      const detail = r.error.issues.map((i) => `${i.path.map(String).join(".") || "body"}: ${i.message}`);
      throw new SignerError("bad_request", detail.join("; "));
    }
    return r.data;
  }

  const requestHash = (type: OpType, req: unknown) => sha256Hex(canonicalJson({ type, req }));

  function writeJournal(entry: JournalEntry): void {
    journal.update((j) => ({ ...j, [entry.opId]: { ...entry, updatedAt: new Date().toISOString() } }));
  }

  // Validated tesSUCCESS is the only success. Everything else is recorded and surfaced.
  function finalize(entry: JournalEntry, res: SubmitResult): CreateEscrowResponse | SettleResponse {
    if (!res.validated || res.result !== "tesSUCCESS") {
      const error = `ledger returned ${res.result}`;
      writeJournal({ ...entry, status: "failed", error });
      throw new SignerError("op_failed", error);
    }
    let response: CreateEscrowResponse | SettleResponse;
    if (entry.type === "create" && entry.pending) {
      const p = entry.pending;
      const record: EscrowRecord = {
        ...p,
        owner: buyer.classicAddress,
        createTxHash: entry.txHash,
        status: "locked",
      };
      escrows.update((e) => ({ ...e, [entry.escrowKey]: record }));
      response = {
        opId: entry.opId,
        txHash: entry.txHash,
        owner: buyer.classicAddress,
        offerSequence: p.offerSequence,
        condition: p.condition,
        cancelAfter: p.cancelAfter,
        ledgerIndex: res.ledgerIndex,
        result: res.result,
      };
    } else {
      const status = entry.type === "finish" ? "finished" : "cancelled";
      escrows.update((e) => {
        const rec = e[entry.escrowKey];
        return rec ? { ...e, [entry.escrowKey]: { ...rec, status, settleTxHash: entry.txHash } } : e;
      });
      response = {
        opId: entry.opId,
        txHash: entry.txHash,
        ledgerIndex: res.ledgerIndex,
        result: res.result,
        feeDrops: res.feeDrops,
      };
    }
    writeJournal({ ...entry, status: "done", response });
    return response;
  }

  // Same opId: return the recorded outcome, or look up the journaled hash. Never sign again.
  async function replay<R>(type: OpType, opId: string, hash: string): Promise<R | undefined> {
    const entry = journal.get()[opId];
    if (!entry) return undefined;
    if (entry.type !== type || entry.requestHash !== hash) {
      throw new SignerError("op_conflict", "opId was already used with a different request");
    }
    if (entry.status === "done") return entry.response as R;
    if (entry.status === "failed") throw new SignerError("op_failed", entry.error ?? "operation failed");
    // Read the validated height BEFORE the lookup: if it is past LastLedgerSequence, every ledger the
    // transaction could be in is already validated, so the lookup that follows cannot miss a late inclusion.
    const heightBeforeLookup = await ledger.validatedLedgerIndex();
    const range =
      entry.submittedAtLedger !== undefined && entry.lastLedgerSequence !== undefined
        ? { minLedger: entry.submittedAtLedger, maxLedger: entry.lastLedgerSequence }
        : undefined;
    const r = await ledger.lookup(entry.txHash, range);
    if (!r.validated) {
      // Absence is proven only when the height is past LastLedgerSequence AND the node confirms it
      // holds every ledger in the range. Anything less stays pending.
      const provenAbsent =
        range !== undefined && heightBeforeLookup > range.maxLedger && r.searchedAll === true;
      if (provenAbsent) {
        const error = "transaction never validated and its LastLedgerSequence has passed, so it can never be included";
        writeJournal({ ...entry, status: "failed", error });
        throw new SignerError("op_failed", error);
      }
      throw new SignerError("op_pending", "transaction is not validated yet; retry with the same opId");
    }
    return finalize(entry, {
      validated: true,
      result: r.result ?? "unknown",
      ledgerIndex: r.ledgerIndex ?? 0,
      feeDrops: r.feeDrops ?? "0",
    }) as R;
  }

  // Nothing is signed yet when this fails, so the same opId can safely retry.
  async function prepare<T extends Parameters<LedgerPort["autofill"]>[0]>(tx: T): Promise<T> {
    try {
      return await ledger.autofill(tx);
    } catch {
      throw new SignerError("ledger_failure", "could not prepare the transaction; retry with the same opId");
    }
  }

  // The hash is journaled before submission so a crash or timeout can be resolved by lookup.
  async function submit(entry: JournalEntry, txBlob: string) {
    let submittedAtLedger: number;
    try {
      submittedAtLedger = await ledger.validatedLedgerIndex();
    } catch {
      throw new SignerError("ledger_failure", "could not read the ledger before submitting; retry with the same opId");
    }
    entry = { ...entry, submittedAtLedger };
    writeJournal(entry);
    let res: SubmitResult;
    try {
      res = await ledger.submitSigned(txBlob, entry.txHash);
    } catch {
      throw new SignerError("ledger_failure", "submission outcome unknown; retry with the same opId to look it up");
    }
    return finalize(entry, res);
  }

  async function createEscrow(raw: unknown): Promise<CreateEscrowResponse> {
    const req = parse(CreateEscrowRequestSchema, raw);
    const hash = requestHash("create", req);
    return locks.run(buyer.classicAddress, async () => {
      const prior = await replay<CreateEscrowResponse>("create", req.opId, hash);
      if (prior) return prior;

      if (!config.allowlist.includes(req.destination)) {
        throw new SignerError("destination_not_allowed", "destination is not on the allowlist");
      }
      if (BigInt(req.amountDrops) > config.maxJobDrops) {
        throw new SignerError("amount_over_cap", `amount exceeds the per-job cap of ${config.maxJobDrops} drops`);
      }
      if (req.cancelAfterSeconds < config.minCancelSeconds || req.cancelAfterSeconds > config.maxCancelSeconds) {
        throw new SignerError(
          "cancel_window_invalid",
          `cancelAfterSeconds must be between ${config.minCancelSeconds} and ${config.maxCancelSeconds}`,
        );
      }

      const cancelAfter = cancelAfterFrom(await ledger.validatedCloseTime(), req.cancelAfterSeconds);
      const { condition, fulfillment } = preimageCondition(newPreimage());
      const secretRef = randomUUID();
      secrets.update((s) => ({ ...s, [secretRef]: seal(config.preimageKey, fulfillment) }));

      const prepared = await prepare(
        buildEscrowCreate({
          account: buyer.classicAddress,
          destination: req.destination,
          amount: req.amountDrops as string,
          condition,
          cancelAfter,
        }),
      );
      const offerSequence = prepared.Sequence;
      if (typeof offerSequence !== "number") throw new SignerError("internal_error", "autofill did not assign a Sequence");
      const signed = buyer.sign(prepared);

      return submit(
        {
          opId: req.opId,
          type: "create",
          requestHash: hash,
          status: "submitted",
          txHash: signed.hash,
          lastLedgerSequence: prepared.LastLedgerSequence,
          escrowKey: escrowKey(buyer.classicAddress, offerSequence),
          pending: {
            jobRef: req.jobRef,
            offerSequence,
            secretRef,
            condition,
            amountDrops: req.amountDrops,
            destination: req.destination,
            cancelAfter,
          },
        },
        signed.tx_blob,
      ) as Promise<CreateEscrowResponse>;
    });
  }

  async function finishEscrow(raw: unknown): Promise<SettleResponse> {
    const req = parse(FinishEscrowRequestSchema, raw);
    const hash = requestHash("finish", req);
    const { owner, offerSequence } = req.authorization.payload;
    const key = escrowKey(owner, offerSequence);

    return locks.run(key, () =>
      locks.run(service.classicAddress, async () => {
        const prior = await replay<SettleResponse>("finish", req.opId, hash);
        if (prior) return prior;

        const verdict = verifyAuthorization(req.authorization, config.gateSecret, now());
        if (!verdict.ok) throw new SignerError("authorization_invalid", `authorization rejected: ${verdict.reason}`);
        const p = verdict.payload;
        // A nonce consumed by this same opId with no journal entry (replay found none) means the
        // earlier attempt failed before signing, so retrying it cannot double-submit.
        const used = consumed.get()[p.nonce];
        if (used && used.opId !== req.opId) {
          throw new SignerError("authorization_consumed", "authorization was already used");
        }

        const record = escrows.get()[key];
        if (!record || record.status !== "locked") {
          throw new SignerError("escrow_not_found", "no open escrow created by this signer matches");
        }
        const onLedger = await ledger.getEscrow(owner, offerSequence);
        if (!onLedger) throw new SignerError("escrow_not_found", "escrow is not on the validated ledger");
        // The validated ledger is settlement truth; the local record must agree with it.
        const matches =
          onLedger.Account === owner &&
          p.amountDrops === record.amountDrops &&
          p.amountDrops === onLedger.Amount &&
          p.destination === record.destination &&
          p.destination === onLedger.Destination &&
          onLedger.Condition === record.condition &&
          onLedger.CancelAfter === record.cancelAfter;
        if (!matches) throw new SignerError("escrow_mismatch", "authorization does not match the escrow on the ledger");

        const closeTime = await ledger.validatedCloseTime();
        if (closeTime >= record.cancelAfter - config.finishMarginSeconds) {
          throw new SignerError("finish_window_closed", "too close to CancelAfter by ledger time; let it refund");
        }

        consumed.update((c) => ({ ...c, [p.nonce]: { opId: req.opId, at: now().toISOString() } }));
        const sealed = secrets.get()[record.secretRef];
        if (!sealed) throw new SignerError("internal_error", "sealed fulfillment is missing");

        const prepared = await prepare(
          buildEscrowFinish({
            account: service.classicAddress,
            owner,
            offerSequence,
            condition: record.condition,
            fulfillment: open(config.preimageKey, sealed),
          }),
        );
        const signed = service.sign(prepared);
        return submit(
          {
            opId: req.opId,
            type: "finish",
            requestHash: hash,
            status: "submitted",
            txHash: signed.hash,
            lastLedgerSequence: prepared.LastLedgerSequence,
            escrowKey: key,
          },
          signed.tx_blob,
        ) as Promise<SettleResponse>;
      }),
    );
  }

  async function cancelEscrow(raw: unknown): Promise<SettleResponse> {
    const req = parse(CancelEscrowRequestSchema, raw);
    const hash = requestHash("cancel", req);
    const key = escrowKey(req.owner, req.offerSequence);

    return locks.run(key, () =>
      locks.run(service.classicAddress, async () => {
        const prior = await replay<SettleResponse>("cancel", req.opId, hash);
        if (prior) return prior;

        const record = escrows.get()[key];
        if (!record || record.status !== "locked") {
          throw new SignerError("escrow_not_found", "no open escrow created by this signer matches");
        }
        const onLedger = await ledger.getEscrow(req.owner, req.offerSequence);
        if (!onLedger) throw new SignerError("escrow_not_found", "escrow is not on the validated ledger");
        if (onLedger.Account !== req.owner || onLedger.CancelAfter !== record.cancelAfter) {
          throw new SignerError("escrow_mismatch", "escrow on the ledger does not match the signer's record");
        }

        const cancelAfter = record.cancelAfter;
        const closeTime = await ledger.validatedCloseTime();
        if (closeTime <= cancelAfter) {
          throw new SignerError(
            "cancel_not_yet_eligible",
            `ledger close time ${closeTime} has not passed CancelAfter ${cancelAfter}`,
          );
        }

        const prepared = await prepare(
          buildEscrowCancel({ account: service.classicAddress, owner: req.owner, offerSequence: req.offerSequence }),
        );
        const signed = service.sign(prepared);
        return submit(
          {
            opId: req.opId,
            type: "cancel",
            requestHash: hash,
            status: "submitted",
            txHash: signed.hash,
            lastLedgerSequence: prepared.LastLedgerSequence,
            escrowKey: key,
          },
          signed.tx_blob,
        ) as Promise<SettleResponse>;
      }),
    );
  }

  return {
    health: async () => ({ network: "testnet", buyer: buyer.classicAddress, service: service.classicAddress }),
    createEscrow,
    finishEscrow,
    cancelEscrow,
  };
}
