import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type Wallet, isValidClassicAddress } from "xrpl";
import type { ZodType } from "zod";
import {
  CancelEscrowRequestSchema,
  type CreateEscrowResponse,
  type CreateEscrowRequest,
  CreateEscrowRequestSchema,
  FinishEscrowRequestSchema,
  UpdatePolicyRequestSchema,
  type HealthResponse,
  type PolicyView,
  type SettleResponse,
  assetAmountOf,
  canonicalJson,
  sha256Hex,
  verifyAuthorization,
} from "@surety/contracts";
import {
  type EscrowEntry,
  buildEscrowCancel,
  buildEscrowCreate,
  buildEscrowFinish,
  cancelAfterFrom,
  newPreimage,
  preimageCondition,
  TESTUSD_CURRENCY_HEX,
  type TrustLine,
  testUsdAmount,
  tokenValueToCents,
} from "@surety/xrpl-settlement";
import type { SignerConfig } from "./config";
import { SignerError } from "./errors";
import type { LedgerPort, SubmitResult } from "./ledger";
import { KeyedLock } from "./lock";
import { createPolicyStore } from "./policy";
import { formatUsd } from "./usd";
import { type Sealed, open, seal } from "./secretbox";
import { JsonFile } from "./store";

interface EscrowRecord {
  jobRef: string;
  owner: string;
  offerSequence: number;
  secretRef: string;
  condition: string;
  // Absent asset means XRP: records written before TESTUSD existed have no asset field.
  asset?: "XRP" | "TESTUSD";
  amountDrops?: string;
  amountTestUsdCents?: string;
  issuer?: string;
  // Validated ledger close time read for this create; the rolling 24-hour cap counts from it.
  lockedAtCloseTime?: number;
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
  // Operator only: the HTTP layer authenticates this route with its own secret.
  updatePolicy(req: unknown): Promise<PolicyView>;
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
  const usdConfig = config.testUsd;
  if (usdConfig) {
    const forbidden = [buyer.classicAddress, service.classicAddress, usdConfig.issuer];
    if (usdConfig.approvedSuppliers.some((a) => forbidden.includes(a))) {
      throw new Error(
        "Invalid signer configuration: APPROVED_SUPPLIERS cannot include the treasury, the service account or the issuer",
      );
    }
  }
  const policy = usdConfig
    ? createPolicyStore(
        config.dataDir,
        {
          perDealCents: usdConfig.maxDealCents.toString(),
          dailyCents: usdConfig.dailyCents.toString(),
          maxOpenDeals: usdConfig.maxOpenDeals,
          approvedSuppliers: usdConfig.approvedSuppliers,
        },
        now,
      )
    : null;

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
        ...(p.issuer ? { issuer: p.issuer } : {}),
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

  // Ledger token values in cents. "0" is a real balance; anything unparseable is null (fail closed).
  const lineCents = (value: string): bigint | null => {
    if (value === "0") return 0n;
    const cents = tokenValueToCents(value);
    return cents === null ? null : BigInt(cents);
  };

  async function readLine(account: string, issuer: string): Promise<TrustLine | null> {
    try {
      return await ledger.trustLine(account, issuer, TESTUSD_CURRENCY_HEX);
    } catch {
      throw new SignerError("ledger_failure", "could not read trust lines; retry with the same opId");
    }
  }

  function checkCancelWindow(seconds: number): void {
    if (seconds < config.minCancelSeconds || seconds > config.maxCancelSeconds) {
      throw new SignerError(
        "cancel_window_invalid",
        `cancelAfterSeconds must be between ${config.minCancelSeconds} and ${config.maxCancelSeconds}`,
      );
    }
  }

  async function createEscrow(raw: unknown): Promise<CreateEscrowResponse> {
    const req = parse(CreateEscrowRequestSchema, raw);
    const hash = requestHash("create", req);
    const amount = assetAmountOf(req);
    if (amount.asset === "TESTUSD") return createTestUsdEscrow(req, hash, amount.cents);
    return locks.run(buyer.classicAddress, async () => {
      const prior = await replay<CreateEscrowResponse>("create", req.opId, hash);
      if (prior) return prior;

      if (!config.allowlist.includes(req.destination)) {
        throw new SignerError("destination_not_allowed", "destination is not on the allowlist");
      }
      if (BigInt(req.amountDrops as string) > config.maxJobDrops) {
        throw new SignerError("amount_over_cap", `amount exceeds the per-job cap of ${config.maxJobDrops} drops`);
      }
      checkCancelWindow(req.cancelAfterSeconds);

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

  // A TESTUSD create whose outcome was never learned stays "submitted" until its opId is replayed, and
  // until then it holds an open slot and daily capacity. Once the ledger is past its LastLedgerSequence
  // the outcome is final, so resolve it here exactly as a retry of that opId would: a validated create
  // becomes a record, one proven absent becomes failed. Anything still unprovable keeps counting.
  // Runs under the buyer lock.
  async function resolveStaleCreates(): Promise<void> {
    const stale = Object.values(journal.get()).filter(
      (e) => e.type === "create" && e.status === "submitted" && e.pending?.asset === "TESTUSD" && e.lastLedgerSequence !== undefined,
    );
    if (stale.length === 0) return;
    let height: number;
    try {
      height = await ledger.validatedLedgerIndex();
    } catch {
      throw new SignerError("ledger_failure", "could not read the ledger to resolve earlier locks; retry with the same opId");
    }
    for (const entry of stale) {
      if (height <= (entry.lastLedgerSequence as number)) continue;
      try {
        await replay<CreateEscrowResponse>("create", entry.opId, entry.requestHash);
      } catch (e) {
        if (e instanceof SignerError && (e.code === "op_failed" || e.code === "op_pending")) continue;
        if (e instanceof SignerError) throw e;
        throw new SignerError("ledger_failure", "could not resolve an earlier lock; retry with the same opId");
      }
    }
  }

  // TESTUSD: cheap local checks first, then ledger reads, then sign. Nothing is sealed or signed
  // until every check has passed, so a refusal or a failed read leaves no trace and the same opId can retry.
  async function createTestUsdEscrow(req: CreateEscrowRequest, hash: string, cents: string): Promise<CreateEscrowResponse> {
    return locks.run(buyer.classicAddress, async () => {
      const prior = await replay<CreateEscrowResponse>("create", req.opId, hash);
      if (prior) return prior;

      const usd = config.testUsd;
      if (!usd || !policy) throw new SignerError("asset_not_enabled", "this signer is not configured for TESTUSD");
      // Read once under the buyer lock: a policy update queues behind this lock, so a create is
      // judged entirely by one policy version.
      const live = policy.current();
      if (!live.approvedSuppliers.includes(req.destination)) {
        throw new SignerError("destination_not_allowed", "destination is not an approved supplier");
      }
      const amount = BigInt(cents);
      const perDealCents = BigInt(live.perDealCents);
      const dailyCents = BigInt(live.dailyCents);
      if (amount > perDealCents) {
        throw new SignerError("amount_over_cap", `amount exceeds the per-deal cap of ${formatUsd(perDealCents)}`);
      }
      checkCancelWindow(req.cancelAfterSeconds);

      // One close time decides the cap window and CancelAfter. Under the buyer lock, so two
      // concurrent creates cannot both see room that only one of them fits in.
      const closeTime = await ledger.validatedCloseTime();
      await resolveStaleCreates();
      // A pending entry whose escrow is already recorded is the same deal (a crash landed between
      // writing the record and closing the journal entry), so it is not counted twice.
      const recorded = escrows.get();
      const pending = Object.values(journal.get())
        .filter((e) => e.type === "create" && e.status === "submitted" && e.pending && !recorded[e.escrowKey])
        .map((e) => e.pending as PendingCreate);
      const exposure = testUsdExposure(Object.values(escrows.get()), pending, closeTime);
      if (exposure.usedDailyCents + amount > dailyCents) {
        throw new SignerError(
          "daily_cap_reached",
          `this lock would take the last 24 hours past the cap of ${formatUsd(dailyCents)}`,
        );
      }
      if (exposure.openDeals >= live.maxOpenDeals) {
        throw new SignerError("open_deal_limit_reached", `${exposure.openDeals} deals are already open; the limit is ${live.maxOpenDeals}`);
      }

      const destination = await readLine(req.destination, usd.issuer);
      const destBalance = destination ? lineCents(destination.balance) : null;
      const destLimit = destination ? lineCents(destination.limit) : null;
      if (
        !destination ||
        destination.frozenByIssuer ||
        destBalance === null ||
        destLimit === null ||
        destLimit - destBalance < amount
      ) {
        throw new SignerError("destination_not_ready", "destination cannot receive this much TESTUSD yet");
      }
      const treasury = await readLine(buyer.classicAddress, usd.issuer);
      const treasuryBalance = treasury && !treasury.frozenByIssuer ? lineCents(treasury.balance) : null;
      if (treasuryBalance === null || treasuryBalance < amount) {
        throw new SignerError("insufficient_funds", "the treasury does not hold enough spendable TESTUSD");
      }

      const cancelAfter = cancelAfterFrom(closeTime, req.cancelAfterSeconds);
      const { condition, fulfillment } = preimageCondition(newPreimage());
      const secretRef = randomUUID();
      secrets.update((s) => ({ ...s, [secretRef]: seal(config.preimageKey, fulfillment) }));

      const prepared = await prepare(
        buildEscrowCreate({
          account: buyer.classicAddress,
          destination: req.destination,
          amount: testUsdAmount(usd.issuer, cents),
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
            asset: "TESTUSD",
            amountTestUsdCents: cents,
            issuer: usd.issuer,
            lockedAtCloseTime: closeTime,
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
          amountMatches(record, p, onLedger.Amount) &&
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

  // No ledger read, and never the operator secret.
  async function health(): Promise<HealthResponse> {
    const base: HealthResponse = { network: "testnet", buyer: buyer.classicAddress, service: service.classicAddress };
    const usd = config.testUsd;
    if (!usd || !policy) return base;
    const live = policy.current();
    return {
      ...base,
      testUsd: {
        issuer: usd.issuer,
        currencyHex: TESTUSD_CURRENCY_HEX,
        approvedSuppliers: [...live.approvedSuppliers],
        policyVersion: live.version,
        limits: { perDealCents: live.perDealCents, dailyCents: live.dailyCents, openDeals: live.maxOpenDeals },
      },
    };
  }

  // Applies to the next lock. Locks already on the ledger settle on their own terms.
  async function updatePolicy(raw: unknown): Promise<PolicyView> {
    const req = parse(UpdatePolicyRequestSchema, raw);
    const usd = config.testUsd;
    if (!usd || !policy) throw new SignerError("asset_not_enabled", "this signer is not configured for TESTUSD");
    // The schema checks the address shape; a typo with a bad checksum would otherwise reach the ledger
    // as an unreadable account and leave every lock to it retrying.
    if (req.approvedSuppliers.some((a) => !isValidClassicAddress(a))) {
      throw new SignerError("bad_request", "approved suppliers must be valid XRPL classic addresses");
    }
    return locks.run(buyer.classicAddress, async () =>
      policy.update(req, { forbidden: [buyer.classicAddress, service.classicAddress, usd.issuer] }),
    );
  }

  return {
    health,
    createEscrow,
    finishEscrow,
    cancelEscrow,
    updatePolicy,
  };
}


const DAY_SECONDS = 86_400;

// TESTUSD exposure by ledger time. The rolling 24-hour total counts every TESTUSD lock (open, paid
// or refunded) plus creates submitted but not yet validated, so lock-and-refund loops still hit the
// cap. Open deals are locked records plus unvalidated creates. Failed creates and XRP never count.
function testUsdExposure(
  records: EscrowRecord[],
  pending: PendingCreate[],
  closeTime: number,
): { usedDailyCents: bigint; openDeals: number } {
  const since = closeTime - DAY_SECONDS;
  const inWindow = (r: { lockedAtCloseTime?: number }) => r.lockedAtCloseTime !== undefined && r.lockedAtCloseTime > since;
  const cents = (r: { amountTestUsdCents?: string }) => BigInt(r.amountTestUsdCents ?? "0");
  const usdRecords = records.filter((r) => r.asset === "TESTUSD");
  const usdPending = pending.filter((r) => r.asset === "TESTUSD");
  let usedDailyCents = 0n;
  for (const r of [...usdRecords, ...usdPending]) if (inWindow(r)) usedDailyCents += cents(r);
  const openDeals = usdRecords.filter((r) => r.status === "locked").length + usdPending.length;
  return { usedDailyCents, openDeals };
}

// The authorization, the signer's record and the validated ledger must all name the same amount.
// A record without an asset field is XRP (written before TESTUSD existed) and keeps the original match.
function amountMatches(
  record: EscrowRecord,
  p: { amountDrops?: string; amountTestUsdCents?: string },
  onLedger: EscrowEntry["Amount"],
): boolean {
  if (record.asset === "TESTUSD") {
    return (
      p.amountDrops === undefined &&
      p.amountTestUsdCents !== undefined &&
      p.amountTestUsdCents === record.amountTestUsdCents &&
      typeof onLedger === "object" &&
      onLedger.currency === TESTUSD_CURRENCY_HEX &&
      onLedger.issuer === record.issuer &&
      tokenValueToCents(onLedger.value) === record.amountTestUsdCents
    );
  }
  return (
    p.amountTestUsdCents === undefined &&
    p.amountDrops !== undefined &&
    p.amountDrops === record.amountDrops &&
    p.amountDrops === onLedger
  );
}
