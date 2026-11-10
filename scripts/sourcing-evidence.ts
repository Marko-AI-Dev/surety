// Testnet evidence for the agent team (Phase 4c Task 12, Phase 4d Task 8). Two steps around one live run:
//   pnpm evidence:sourcing before                          prints the treasury's TESTUSD balance in cents
//   pnpm evidence:sourcing <sourcingId> --before <cents> [--expect paid|refunded]
//                                                          gathers the run and writes evidence/sourcing-<UTC>.json
// It reads the database, the negotiator's view and inbox through the API with the negotiator's own token
// (never printed), and the ledger (read-only). Exits 1 unless every check in scripts/sourcing-checks.ts passes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";
import { type OfferReport, TradeDocumentsSchema } from "@surety/contracts";
import { parseTradeDocuments } from "@surety/gate";
import { createSignerClient } from "@surety/signer-client";
import { type Deal, createPgRepo, supplierStatus } from "@surety/workflow";
import { TESTUSD_CURRENCY_HEX, explorerTxUrl, getTrustLine, getTxResult, tokenValueToCents } from "@surety/xrpl-settlement";
import { sourcingChecks } from "./sourcing-checks";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (run with pnpm evidence:sourcing)`);
  return v;
};
const ROOT = resolve(import.meta.dirname, "..");
const signer = createSignerClient({ url: need("SIGNER_URL"), hmacSecret: need("SIGNER_HMAC_SECRET") });
const xrpl = new Client(need("XRPL_WS_URL"), { connectionTimeout: 20_000 });
const lineCents = (v: string): bigint | null => (v === "0" ? 0n : ((c) => (c === null ? null : BigInt(c)))(tokenValueToCents(v)));

async function treasuryCents(): Promise<bigint | null> {
  const health = await signer.health();
  if (!health.testUsd) throw new Error("the signer has TESTUSD off");
  if (!xrpl.isConnected()) await xrpl.connect();
  const line = await getTrustLine(xrpl, health.buyer, health.testUsd.issuer, TESTUSD_CURRENCY_HEX);
  return line ? lineCents(line.balance) : null;
}

try {
  const [arg] = process.argv.slice(2);
  if (arg === "before") {
    console.log(String(await treasuryCents()));
  } else {
    const sourcingId = arg ?? "";
    const beforeFlag = process.argv.indexOf("--before");
    const before = beforeFlag === -1 ? null : BigInt(process.argv[beforeFlag + 1] ?? "");
    const expectFlag = process.argv.indexOf("--expect");
    const expectArg = expectFlag === -1 ? "paid" : process.argv[expectFlag + 1];
    if (expectArg !== "paid" && expectArg !== "refunded") throw new Error("--expect must be paid or refunded");
    const expect: "paid" | "refunded" = expectArg;
    const repo = createPgRepo(need("DATABASE_URL"));
    try {
      const s = await repo.getSourcing(sourcingId);
      if (!s) throw new Error(`sourcing ${sourcingId} not found`);
      const directory = JSON.parse(readFileSync(resolve(ROOT, "fixtures/sourcing/directory.json"), "utf8")) as { address: string; name: string; persona: string }[];
      const crook = directory.find((e) => e.persona === "coastline")?.address ?? "";
      const stranger = directory.find((e) => e.persona === "lowtide")?.address ?? "";
      const messages = await repo.listMessages(s.id);
      // Was the crook on hold when this sourcing opened: cards after its last review and before the start?
      const review = await repo.lastReview(crook);
      const reviewedAt = review && Date.parse(review.clearedAt) < Date.parse(s.createdAt) ? Date.parse(review.clearedAt) : Number.NEGATIVE_INFINITY;
      const crookHeldAtStart = (await repo.listCards(crook, null)).some((c) => Date.parse(c.createdAt) > reviewedAt && Date.parse(c.createdAt) < Date.parse(s.createdAt));
      const invites = await repo.listInvites(s.id);
      const suggestions = await repo.listSuggestions(s.id);

      const api = process.env.EVIDENCE_API_URL ?? "http://127.0.0.1:4200";
      const asNegotiator = async (path: string) =>
        (await fetch(api + path, { headers: { authorization: `Bearer ${need("API_TOKEN_NEGOTIATOR")}` } })).text();
      const negotiatorView = await asNegotiator(`/sourcing/${s.id}`);
      const negotiatorInbox = await asNegotiator(`/sourcing/${s.id}/inbox`);

      const deals = (await Promise.all(invites.filter((i) => i.dealId).map((i) => repo.getDeal(i.dealId as string)))).filter((d): d is Deal => d !== null);
      const deal = s.dealId ? await repo.getDeal(s.dealId) : null;
      const job = deal?.jobId ? await repo.getJob(deal.jobId) : null;
      const txs = job ? await repo.listTransactions(job.id) : [];
      if (!xrpl.isConnected()) await xrpl.connect();
      const confirm = async (hash: string | null | undefined) => {
        if (!hash) return null;
        const r = await getTxResult(xrpl, hash);
        return { txHash: hash, validated: r.validated, result: r.result, ledgerIndex: r.ledgerIndex, feeDrops: r.feeDrops, explorer: explorerTxUrl(hash) };
      };
      const tx = (type: string) => txs.find((t) => t.type === type && t.status === "validated")?.txHash;
      const create = await confirm(tx("create"));
      const finish = await confirm(tx("finish"));
      const cancel = await confirm(tx("cancel"));
      const attestation = job ? await repo.getAttestation(job.id) : null;
      const jobEvents = job ? await repo.listEvents(job.id) : [];
      const paidAt = jobEvents.find((ev) => ev.toState === "PAID")?.createdAt ?? null;
      const docs = job ? TradeDocumentsSchema.safeParse(job.deliverable) : null;
      const deliveredBl = docs?.success ? (parseTradeDocuments(docs.data)?.billOfLading.blNumber ?? null) : null;
      const notes = deal ? (await repo.listDealEvents(deal.id)).filter((ev) => ev.fromState === ev.toState) : [];
      const reports = messages
        .filter((m) => m.kind === "report" && m.offer)
        .map((m) => ({ supplier: m.supplier, unitCents: (m.offer as OfferReport).unitCents, deliveryDays: (m.offer as OfferReport).deliveryDays, at: m.createdAt }));
      const negotiatorMessages = messages.filter((m) => m.kind === "to_supplier").map((m) => ({ supplier: m.supplier, text: m.body }));
      const after = await treasuryCents();
      const decision = job ? await repo.latestDecision(job.id) : null;

      const evidenceInvites = invites.map((i) => {
        const mine = messages.filter((m) => m.supplier === i.address);
        return {
          address: i.address,
          name: i.name,
          status: supplierStatus(mine),
          cards: mine.filter((m) => m.kind === "from_supplier" && m.card).map((m) => m.card as string),
          quote: i.quote && { unitCents: i.quote.unitCents, quantity: i.quote.quantity, totalCents: i.quote.totalCents },
          deliveryDays: i.deliveryDays,
          dealId: i.dealId,
        };
      });
      const totalCents = job && job.amount.asset === "TESTUSD" ? BigInt(job.amount.cents) : 0n;
      const checks = sourcingChecks(
        {
        brief: s.brief,
        crook,
        crookHeldAtStart,
        stranger,
        invites: evidenceInvites,
        quarantinedBodies: messages.filter((m) => m.kind === "from_supplier" && m.verdict === "quarantine").map((m) => m.body),
        negotiatorView,
        negotiatorInbox,
        reports,
        negotiatorMessages,
        suggestions: suggestions.map((g) => g.address),
        selectedSupplier: s.selectedSupplier,
        notes: notes.map((n) => ({ reasonCodes: n.reasonCodes, detail: n.detail })),
        jobState: job?.state ?? null,
        finishResult: finish?.result ?? null,
        cancelResult: cancel?.result ?? null,
        decisionReasonCodes: decision?.reasonCodes ?? [],
        attestation: attestation && { outcome: attestation.outcome, blNumber: attestation.blNumber, at: attestation.createdAt },
        deliveredBl,
        paidAt,
        treasury: { before, after },
        totalCents,
        leadReasons: deals.map((d) => d.decision?.agent.reason ?? ""),
        },
        expect,
      );
      const screenCost = messages.reduce((acc, m) => acc + (((m.screen as { costUsd?: number } | null)?.costUsd ?? 0) || 0), 0);
      const evidence = {
        network: "XRPL Testnet",
        recordedAt: new Date().toISOString(),
        sourcing: { id: s.id, ref: s.ref, state: s.state, brief: s.brief, negotiationEndsAt: s.negotiationEndsAt },
        invites: evidenceInvites,
        suggestions,
        messages: messages.map((m) => ({
          at: m.createdAt,
          kind: m.kind,
          supplier: m.supplier,
          body: m.body,
          delivered: m.verdict === "deliver",
          card: m.card,
          offer: m.offer,
          screen: m.screen,
        })),
        deals: deals.map((d) => ({ id: d.id, ref: d.ref, state: d.state, supplier: d.intent.supplier, quote: d.quote, decision: d.decision })),
        job: job && { id: job.id, ref: job.ref, state: job.state, amount: job.amount, seller: job.sellerAddress, policyVersion: job.policyVersion },
        verify: decision && { outcome: decision.outcome, satisfaction: decision.satisfaction, injectionRisk: decision.injectionRisk, reasonCodes: decision.reasonCodes, policyVersion: decision.policyVersion },
        // The web app's shape (apps/web/src/data/types.ts, Inspection).
        inspection: job
          ? attestation
            ? { state: attestation.outcome, inspector: attestation.inspector, blNumber: attestation.blNumber, note: attestation.note, at: attestation.createdAt }
            : { state: "pending" }
          : null,
        notes: notes.map((n) => ({ at: n.createdAt, actor: n.actor, reasonCodes: n.reasonCodes, detail: n.detail })),
        events: jobEvents.map((ev) => ({ at: ev.createdAt, actor: ev.actor, from: ev.fromState, to: ev.toState, reasonCodes: ev.reasonCodes })),
        expect,
        create,
        finish,
        cancel,
        treasuryCents: { before: before?.toString() ?? null, after: after?.toString() ?? null },
        costUsd: { bouncer: screenCost, verify: decision?.costUsd ?? 0 },
        checks,
      };
      mkdirSync(resolve(ROOT, "evidence"), { recursive: true });
      const file = resolve(ROOT, "evidence", `sourcing-${evidence.recordedAt.replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, `${JSON.stringify(evidence, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
      console.log(`evidence written: ${file}`);
      console.log(`checks: ${JSON.stringify(checks)}`);
      if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
    } finally {
      await repo.close();
    }
  }
} finally {
  if (xrpl.isConnected()) await xrpl.disconnect();
}
