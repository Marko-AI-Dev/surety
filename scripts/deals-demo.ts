// Testnet evidence for the deal loop (Phase 4b). Six deals for the 400-panel order, $48,000 in TESTUSD,
// 180-second deadlines, run through openDeal, submitQuote, decideQuote and submitDocuments:
//   paid        honest documents: the rules pass, live Surety Verify approves, the signer pays the supplier
//   redirected  "our wallet has changed" invoice: rule pay_to fails, the model is never asked, refund
//   edited      bill of lading ships 380, not 400: rule shipment fails, refund
//   injected    instruction in the B/L remarks: the rules pass, live Surety Verify declines, refund
//   over-max    quote at $135.00 a panel: the deal agent declines it, nothing is locked
//   unapproved  supplier wallet not approved: the Policy step refuses, nothing is locked
// Then the job engine (runEngineOnce, in-process, live Jev) runs every 5 s until every locked deal is
// final or 420 s pass. Needs the signer (pnpm signer), Supabase (pnpm db:start) and the OpenRouter key.
// Paid: about 3 to 7 Jev calls (well under $0.001). Run: pnpm demo:deals
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";
import type { DealIntent, SupplierQuote, TradeDocuments } from "@surety/contracts";
import { type SupplierLine, TRADE_POLICY, createJevEngine } from "@surety/gate";
import { createSignerClient } from "@surety/signer-client";
import {
  type Deal,
  createPgRepo,
  decideQuote,
  openDeal,
  ruleFollowingDecider,
  runEngineOnce,
  submitDocuments,
  submitQuote,
} from "@surety/workflow";
import {
  TESTUSD_CURRENCY_HEX,
  explorerTxUrl,
  getEscrow,
  getTrustLine,
  getTxResult,
  getValidatedCloseTime,
  rippleToIso,
  tokenValueToCents,
} from "@surety/xrpl-settlement";
import { ATTACKER, intent as baseIntent, presets, quote } from "./deal-fixtures";

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run with pnpm demo:deals)`);
  return value;
}

const ROOT = resolve(import.meta.dirname, "..");
const DEADLINE_SECONDS = 180;
const PASS_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 420_000;
const FINAL = new Set(["PAID", "REFUNDED", "CREATE_FAILED", "RECONCILIATION_REQUIRED"]);

const repo = createPgRepo(need("DATABASE_URL"));
const signer = createSignerClient({ url: need("SIGNER_URL"), hmacSecret: need("SIGNER_HMAC_SECRET") });
const gateSecret = need("GATE_AUTH_SECRET");
const liveJev = createJevEngine({ apiKey: need("OPENROUTER_API_KEY") });
const xrpl = new Client(need("XRPL_WS_URL"), { connectionTimeout: 20_000 });
const ledgerCloseTime = async () => {
  if (!xrpl.isConnected()) await xrpl.connect();
  return getValidatedCloseTime(xrpl);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);

// A trust-line value in cents. The ledger writes a zero balance as "0", which the strict cents parser refuses.
const lineCents = (value: string): bigint | null => {
  if (value === "0") return 0n;
  const cents = tokenValueToCents(value);
  return cents === null ? null : BigInt(cents);
};

interface Case {
  name: string;
  expect: string;
  supplier?: string;
  quote?: SupplierQuote;
  docs?: string;
}

const CASES: Case[] = [
  { name: "paid", expect: "PAID", docs: "docs-honest" },
  { name: "redirected", expect: "REFUNDED", docs: "docs-wallet-changed" },
  { name: "edited", expect: "REFUNDED", docs: "docs-quantity-edited" },
  { name: "injected", expect: "REFUNDED", docs: "docs-hidden-instruction" },
  { name: "over-max", expect: "DECLINED", quote: { ...quote, unitCents: 13_500, totalCents: 5_400_000 } },
  { name: "unapproved", expect: "POLICY_REFUSED", supplier: ATTACKER },
];

try {
  await xrpl.connect();
  const health = await signer.health();
  if (!health.testUsd) throw new Error("the signer has TESTUSD off; start it with .env.testusd");
  const issuer = health.testUsd.issuer;
  const supplierLine = async (address: string): Promise<SupplierLine | null> => {
    const line = await getTrustLine(xrpl, address, issuer, TESTUSD_CURRENCY_HEX);
    if (!line) return null;
    const balanceCents = lineCents(line.balance);
    const limitCents = lineCents(line.limit);
    if (balanceCents === null || limitCents === null) return null;
    return { balanceCents, limitCents, frozenByIssuer: line.frozenByIssuer };
  };
  const deps = { repo, signer, supplierLine, decider: ruleFollowingDecider };
  const treasuryCents = async () => {
    const line = await getTrustLine(xrpl, health.buyer, issuer, TESTUSD_CURRENCY_HEX);
    return line ? lineCents(line.balance) : null;
  };
  const before = await treasuryCents();
  log(`signer up: treasury ${health.buyer}, policy v${health.testUsd.policyVersion}; treasury holds ${before} cents; Surety Verify ${TRADE_POLICY.version}`);

  const stamp = Date.now().toString(36).toUpperCase();
  const deals: Deal[] = [];
  for (const c of CASES) {
    const po = `PO-${stamp}-${c.name.toUpperCase()}`;
    const intent: DealIntent = {
      ...baseIntent,
      poNumber: po,
      buyer: { ...baseIntent.buyer, address: health.buyer },
      supplier: { ...baseIntent.supplier, address: c.supplier ?? baseIntent.supplier.address },
      deadlineSeconds: DEADLINE_SECONDS,
    };
    let deal = await openDeal(deps, intent);
    log(`${c.name}: ${po} ${deal.state}`);
    if (deal.state === "AWAITING_QUOTE") {
      deal = await submitQuote(deps, deal.id, c.quote ?? quote);
      const decided = await decideQuote(deps, deal.id);
      deal = decided.deal;
      log(`${c.name}: deal agent ${deal.decision?.agent.outcome}, ${deal.state}${decided.job ? `, job ${decided.job.state}` : ""}`);
      if (decided.job && c.docs) {
        const docs = presets[c.docs] as TradeDocuments;
        const stamped = { ...docs, commercialInvoice: docs.commercialInvoice.replace("PO number: PO-2026-0412", `PO number: ${po}`) };
        const delivered = await submitDocuments(deps, deal.id, stamped);
        log(`${c.name}: documents ${c.docs} -> ${delivered.state}`);
      }
    }
    deals.push(deal);
  }

  const jobIds = deals.map((d) => d.jobId).filter((id): id is string => id !== null);
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      await runEngineOnce({ repo, signer, engine: liveJev, gateSecret, ledgerCloseTime, log });
    } catch (e) {
      log(`pass error: ${e instanceof Error ? e.message : String(e)}`);
    }
    const states = await Promise.all(jobIds.map(async (id) => (await repo.getJob(id))?.state ?? "missing"));
    log(`states: ${states.join(" ")}`);
    if (states.every((s) => FINAL.has(s)) || Date.now() > deadline) break;
    await sleep(PASS_INTERVAL_MS);
  }

  const confirm = async (hash: string | null | undefined) => {
    if (!hash) return null;
    const r = await getTxResult(xrpl, hash);
    return { txHash: hash, validated: r.validated, result: r.result, ledgerIndex: r.ledgerIndex, feeDrops: r.feeDrops, explorer: explorerTxUrl(hash) };
  };

  const collect = async (c: Case, dealId: string) => {
    const deal = (await repo.getDeal(dealId)) as Deal;
    const job = deal.jobId ? await repo.getJob(deal.jobId) : null;
    const escrow = job ? await repo.getEscrow(job.id) : null;
    const txs = job ? await repo.listTransactions(job.id) : [];
    const decision = job ? await repo.latestDecision(job.id) : null;
    const tx = (type: string) => txs.find((t) => t.type === type && t.status === "validated");
    return {
      case: c.name,
      expected: c.expect,
      final: job?.state ?? deal.state,
      deal: { id: deal.id, ref: deal.ref, state: deal.state, decision: deal.decision, quoteChecks: deal.quoteChecks },
      dealEvents: await repo.listDealEvents(deal.id),
      job: job && { id: job.id, state: job.state, amount: job.amount, seller: job.sellerAddress, policyVersion: job.policyVersion, deliverableHash: job.deliverableHash },
      decision,
      escrow: escrow && {
        owner: escrow.owner,
        offerSequence: escrow.offerSequence,
        issuer: escrow.issuer,
        cancelAfterIso: rippleToIso(escrow.cancelAfter),
        onLedgerNow: (await getEscrow(xrpl, escrow.owner, escrow.offerSequence)) !== null,
      },
      create: await confirm(tx("create")?.txHash),
      finish: await confirm(tx("finish")?.txHash),
      cancel: await confirm(tx("cancel")?.txHash),
      jobEvents: job ? await repo.listEvents(job.id) : [],
    };
  };
  const results: Awaited<ReturnType<typeof collect>>[] = [];
  for (const [i, c] of CASES.entries()) results.push(await collect(c, (deals[i] as Deal).id));

  const after = await treasuryCents();
  const byName = (name: string) => results.find((r) => r.case === name);
  const checks = {
    everyCaseAsExpected: results.every((r) => r.final === r.expected),
    paidFinishValidated: byName("paid")?.finish?.result === "tesSUCCESS",
    refundsValidated: ["redirected", "edited", "injected"].every((n) => byName(n)?.cancel?.result === "tesSUCCESS"),
    redirectedByRule: byName("redirected")?.decision?.reasonCodes.includes("rule:pay_to") === true,
    editedByRule: byName("edited")?.decision?.reasonCodes.includes("rule:shipment") === true,
    injectedByModel: byName("injected")?.decision?.reasonCodes.includes("injection_risk") === true,
    nothingLockedForRefusals: ["over-max", "unapproved"].every((n) => byName(n)?.job === null),
    treasuryDownByExactly48000: before !== null && after !== null && before - after === 4_800_000n,
  };
  const verifyCostUsd = results.reduce((sum, r) => sum + (r.decision?.costUsd ?? 0), 0);
  const evidence = {
    network: "XRPL Testnet",
    recordedAt: new Date().toISOString(),
    policy: TRADE_POLICY,
    treasuryCents: { before: before?.toString() ?? null, after: after?.toString() ?? null },
    verifyCostUsd,
    checks,
    results,
  };
  mkdirSync(resolve(ROOT, "evidence"), { recursive: true });
  const file = resolve(ROOT, "evidence", `deals-${evidence.recordedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
  log(`evidence written: ${file}`);
  for (const r of results) log(`${r.case}: ${r.final} (expected ${r.expected}) ${r.decision?.reasonCodes.join(",") ?? ""}`);
  log(`checks: ${JSON.stringify(checks)}`);
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
} finally {
  await repo.close();
  if (xrpl.isConnected()) await xrpl.disconnect();
}
