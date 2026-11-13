import {
  BUYER_APPROVED,
  BUYER_DECLINED,
  type Deal,
  LEAD_RECOMMENDS,
  type SourcingDeps,
  SourcingNotFound,
  controlsOf,
  inspectionOf,
  leadView,
  supplierOnHold,
  supplierStatus,
} from "@surety/workflow";
import { explorerTxUrl } from "@surety/xrpl-settlement";

// The operator's record of one sourcing, in the same shape as evidence/sourcing-*.json, so the web app
// renders a live run and a recorded run with the same code. Read-only: it reads the database mirror and
// the signer's health (which never holds a secret) and touches neither the ledger nor the decision
// model. It carries held messages in full and the buyer's maximum, so only the view role may read it.
// What the evidence script adds from the ledger (the treasury balance before and after, and the run
// checks) is null here.

export async function sourcingRecord(deps: SourcingDeps, sourcingId: string) {
  const { repo } = deps;
  const s = await repo.getSourcing(sourcingId);
  if (!s) throw new SourcingNotFound(sourcingId);
  const [messages, invites, suggestions, health] = await Promise.all([
    repo.listMessages(s.id),
    repo.listInvites(s.id),
    repo.listSuggestions(s.id),
    deps.signer.health(),
  ]);

  const deals = (await Promise.all(invites.filter((i) => i.dealId).map((i) => repo.getDeal(i.dealId as string)))).filter(
    (d): d is Deal => d !== null,
  );
  const deal = s.dealId ? await repo.getDeal(s.dealId) : null;
  const job = deal?.jobId ? await repo.getJob(deal.jobId) : null;
  const txs = job ? await repo.listTransactions(job.id) : [];
  const decision = job ? await repo.latestDecision(job.id) : null;
  // Phase 4d. The inspector's second key in the web app's Inspection shape: null for a deal that needs
  // no inspector, { state: "pending" } until the inspector answers. Then Surety's ranking of the
  // committed quotes for the buyer's priority, the job's events with their real times, and the deal's
  // notes (an event that changes no state, such as a choice that went against the priority).
  const inspection = deal ? await inspectionOf(deps, deal.id) : null;
  const jobEvents = job ? await repo.listEvents(job.id) : [];
  const notes = deal ? (await repo.listDealEvents(deal.id)).filter((ev) => ev.fromState === ev.toState) : [];
  // The buyer's final yes. The lead recommends a deal; nothing locks until the buyer approves it.
  // The newest recommended deal, whatever happened to it since.
  let approval: { state: "waiting" | "approved" | "declined"; dealId: string; supplier: string; leadReason: string; at: string; answeredAt: string | null } | null = null;
  for (const d of deals) {
    const events = await repo.listDealEvents(d.id);
    const asked = events.find((ev) => ev.reasonCodes.includes(LEAD_RECOMMENDS));
    if (!asked || (approval && approval.at > asked.createdAt)) continue;
    const answered = events.find((ev) => ev.reasonCodes.includes(BUYER_APPROVED) || ev.reasonCodes.includes(BUYER_DECLINED));
    approval = {
      state: !answered ? "waiting" : answered.reasonCodes.includes(BUYER_APPROVED) ? "approved" : "declined",
      dealId: d.id,
      supplier: d.intent.supplier.address,
      leadReason: String((asked.detail as { reason?: unknown } | null)?.reason ?? ""),
      at: asked.createdAt,
      answeredAt: answered?.createdAt ?? null,
    };
  }
  const buyerNotes = (await repo.listBuyerNotes(s.id)).map((n) => ({ text: n.text, at: n.createdAt }));
  // The buyer's side: its settings, the messages waiting for it, who wrote each message that went out,
  // and its chat with its own agent.
  const view = await leadView(deps, s.id);
  const controls = await controlsOf(deps, s);
  const drafts = await repo.listDrafts(s.id);
  const sentBy = new Map(drafts.filter((d) => d.state === "sent" && d.messageId).map((d) => [d.messageId as string, d]));
  const chat = (await repo.listChat(s.id)).map((l) => ({ role: l.role, text: l.body, at: l.createdAt }));
  // Only a validated transaction is shown as one; the mirror's result is the ledger's.
  const tx = (type: string) => {
    const t = txs.find((x) => x.type === type && x.status === "validated" && x.txHash);
    return t?.txHash
      ? { txHash: t.txHash, validated: true, result: t.result, ledgerIndex: t.ledgerIndex, feeDrops: t.feeDrops, explorer: explorerTxUrl(t.txHash) }
      : null;
  };
  const screenCost = messages.reduce((acc, m) => acc + ((m.screen as { costUsd?: number | null } | null)?.costUsd ?? 0), 0);

  return {
    network: "XRPL Testnet",
    recordedAt: new Date().toISOString(),
    sourcing: { id: s.id, ref: s.ref, state: s.state, brief: s.brief, negotiationEndsAt: s.negotiationEndsAt, createdAt: s.createdAt },
    invites: invites.map((i) => {
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
    }),
    suggestions,
    messages: messages.map((m) => ({
      at: m.createdAt,
      kind: m.kind,
      supplier: m.supplier,
      // Who wrote a message to a supplier: the negotiator, or the buyer (written or reworded by them).
      ...(m.kind === "to_supplier" ? { by: sentBy.get(m.id)?.author === "buyer" ? "buyer" : "negotiator", buyerApproved: sentBy.has(m.id), buyerEdited: sentBy.get(m.id)?.sentBody != null } : {}),
      body: m.body,
      delivered: m.verdict === "deliver",
      card: m.card,
      offer: m.offer,
      screen: m.screen,
    })),
    deals: await Promise.all(
      deals.map(async (d) => ({
        id: d.id,
        ref: d.ref,
        state: d.state,
        supplier: d.intent.supplier,
        quote: d.quote,
        decision: d.decision,
        events: await repo.listDealEvents(d.id),
      })),
    ),
    job: job && {
      id: job.id,
      ref: job.ref,
      state: job.state,
      amount: job.amount,
      seller: job.sellerAddress,
      policyVersion: job.policyVersion,
    },
    verify: decision && {
      outcome: decision.outcome,
      satisfaction: decision.satisfaction,
      injectionRisk: decision.injectionRisk,
      reasonCodes: decision.reasonCodes,
      policyVersion: decision.policyVersion,
      rules: decision.rules,
    },
    inspection,
    approval,
    buyerNotes,
    controls: { autonomy: controls.autonomy, push: controls.push, wrapUpAt: controls.wrapUpAt },
    decideNow: view.decideNow,
    drafts: drafts.filter((d) => d.state === "pending").map((d) => ({ id: d.id, supplier: d.supplier, text: d.body, at: d.createdAt })),
    chat,
    ranking: view.ranking,
    notes: notes.map((n) => ({ at: n.createdAt, actor: n.actor, reasonCodes: n.reasonCodes, detail: n.detail })),
    events: jobEvents.map((ev) => ({ at: ev.createdAt, actor: ev.actor, from: ev.fromState, to: ev.toState, reasonCodes: ev.reasonCodes })),
    create: tx("create"),
    finish: tx("finish"),
    cancel: tx("cancel"),
    treasuryCents: null,
    costUsd: { bouncer: screenCost, verify: decision?.costUsd ?? 0 },
    checks: null,
    policy: health.testUsd
      ? {
          policyVersion: health.testUsd.policyVersion,
          limits: health.testUsd.limits,
          approvedSuppliers: await Promise.all(
            health.testUsd.approvedSuppliers.map(async (address) => ({
              address,
              name: deps.directory(address) ?? address,
              onHold: await supplierOnHold(deps, address),
            })),
          ),
        }
      : null,
  };
}

// The sourcings, newest first, for the lead and the operator's view. No maximum price: the full brief
// stays on GET /sourcing/:id for the roles that may see it.
export async function sourcingList(deps: SourcingDeps, limit: number) {
  return (await deps.repo.listSourcings(limit)).map((s) => ({
    id: s.id,
    ref: s.ref,
    state: s.state,
    goods: s.brief.goods.description,
    quantity: s.brief.goods.quantity,
    incoterm: s.brief.incoterm,
    port: s.brief.port,
    negotiationEndsAt: s.negotiationEndsAt,
    dealId: s.dealId,
    createdAt: s.createdAt,
  }));
}
