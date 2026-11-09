import { type DealIntent, type LeadDecision, LeadDecisionSchema, SettlementFormSchema } from "@surety/contracts";
import { type SettlementDraft, buildSettlementDocuments, settlementDraft } from "@surety/gate";
import { type Deal, DealTransitionConflict } from "./deal-repo";
import { type DealDeps, type QuoteDecider, decideQuote, openDeal, ruleFollowingDecider, submitDocuments, submitQuote } from "./deals";
import type { Job } from "./repo";
import { InviteConflict, SourcingConflict } from "./sourcing-repo";
import { NotInvited, SourcingClosed, type SourcingDeps, SourcingNotFound, SourcingRefused, SupplierOut, supplierStatus } from "./sourcing";

// From a committed quote to a locked deal: the lead selects a supplier, Surety opens a deal from the
// brief (the Policy step) with that supplier's committed quote, and the lead's accept or decline runs
// through the 4b deal loop, whose checks overrule an accept that breaks the brief or the live policy.

// openDeal and submitQuote take DealDeps, whose decider they never use.
const dealDeps = (deps: SourcingDeps): DealDeps => ({
  repo: deps.repo,
  signer: deps.signer,
  supplierLine: deps.supplierLine,
  decider: ruleFollowingDecider,
});

// The lead's answer, carried into decideQuote as an agent decision.
export function answerDecider(answer: LeadDecision, model: string): QuoteDecider {
  return {
    kind: "agent",
    model,
    async decide() {
      return { outcome: answer.outcome, reason: answer.reason };
    },
  };
}

export async function selectSupplier(deps: SourcingDeps, sourcingId: string, address: string): Promise<Deal> {
  const s = await deps.repo.getSourcing(sourcingId);
  if (!s) throw new SourcingNotFound(sourcingId);
  if (s.state !== "OPEN") throw new SourcingClosed(s.id, "not_open");
  const invites = await deps.repo.listInvites(s.id);
  const index = invites.findIndex((i) => i.address === address);
  const invite = invites[index];
  if (!invite) throw new NotInvited(s.id, address);
  if (supplierStatus(await deps.repo.listMessages(s.id, { supplier: address })) === "out") throw new SupplierOut(s.id, address);
  if (!invite.quote) throw new SourcingRefused(`supplier ${address} has not committed a quote`);
  if (invite.dealId) throw new InviteConflict(s.id, address);

  const intent: DealIntent = {
    poNumber: `PO-${s.ref.slice(3)}-S${index + 1}`,
    buyer: s.brief.buyer,
    supplier: { name: invite.name, address },
    goods: { description: s.brief.goods.description, quantity: s.brief.goods.quantity, maxUnitCents: s.brief.goods.maxUnitCents },
    incoterm: s.brief.incoterm,
    port: s.brief.port,
    deadlineSeconds: s.brief.deadlineSeconds,
  };
  const opened = await openDeal(dealDeps(deps), intent);
  const deal = opened.state === "POLICY_REFUSED" ? opened : await submitQuote(dealDeps(deps), opened.id, invite.quote);
  await deps.repo.attachDeal(s.id, address, deal.id);
  return deal;
}

// The lead's accept or decline on a selected supplier's deal. An accepted deal marks the sourcing
// SELECTED; a decline (or an overruled accept) leaves it OPEN for another supplier.
export async function leadDecision(
  deps: SourcingDeps,
  dealId: string,
  raw: unknown,
  agentName: string,
): Promise<{ deal: Deal; job: Job | null }> {
  const answer = LeadDecisionSchema.parse(raw);
  const invite = await deps.repo.getInviteByDeal(dealId);
  if (!invite) throw new SourcingRefused(`deal ${dealId} did not come from a sourcing`);
  const s = await deps.repo.getSourcing(invite.sourcingId);
  if (!s) throw new SourcingNotFound(invite.sourcingId);
  // Only a deal the lead can still decide (or an accepted one whose lock is resuming) may claim it.
  const current = await deps.repo.getDeal(dealId);
  if (!current || !(current.state === "QUOTE_RECEIVED" || (current.state === "ACCEPTED" && current.jobId))) {
    throw new DealTransitionConflict(dealId, current?.state ?? "missing", "ACCEPTED");
  }
  // Claim the sourcing for this deal before anything can lock: one atomic OPEN to SELECTED, so a
  // second decision on another supplier's deal is refused instead of locking a second payment. A retry
  // of this deal finds the sourcing already naming it and goes on.
  if (s.state === "OPEN") {
    try {
      await deps.repo.markSelected(s.id, invite.address, dealId);
    } catch (e) {
      const now = await deps.repo.getSourcing(s.id);
      if (!(e instanceof SourcingConflict)) throw e;
      if (now?.dealId !== dealId) throw new SourcingClosed(s.id, "not_open");
    }
  } else if (s.dealId !== dealId) {
    throw new SourcingClosed(s.id, "not_open");
  }

  const result = await decideQuote({ ...dealDeps(deps), decider: answerDecider(answer, `paperclip:${agentName}`) }, dealId);
  // Only a final decline (or an overruled accept) releases the claim: nothing was locked, so the
  // sourcing opens again for another supplier. A decision that throws keeps the claim, so its retry
  // resumes it and no concurrent decision can slip a second lock in; the lead may also decline it.
  if (result.deal.state === "DECLINED") {
    try {
      await deps.repo.releaseSelection(s.id, dealId);
    } catch (e) {
      if (!(e instanceof SourcingConflict)) throw e;
    }
  }
  return result;
}

async function ownDeal(deps: SourcingDeps, dealId: string, address: string): Promise<Deal> {
  const invite = await deps.repo.getInviteByDeal(dealId);
  if (!invite || invite.address !== address) throw new NotInvited(invite?.sourcingId ?? "", address);
  const deal = await deps.repo.getDeal(dealId);
  if (!deal?.quote) throw new NotInvited(invite.sourcingId, address);
  return deal;
}

// The pre-filled settlement form for the deal's own supplier only.
export async function settlementDraftFor(deps: SourcingDeps, dealId: string, address: string): Promise<SettlementDraft> {
  const deal = await ownDeal(deps, dealId, address);
  return settlementDraft(deal.intent, deal.quote as NonNullable<Deal["quote"]>);
}

export async function submitSettlement(deps: SourcingDeps, dealId: string, address: string, raw: unknown): Promise<Job> {
  const form = SettlementFormSchema.parse(raw);
  const deal = await ownDeal(deps, dealId, address);
  // Documents are accepted only once the deal is accepted and its payment is being locked.
  if (deal.state !== "ACCEPTED" || !deal.jobId) throw new DealTransitionConflict(deal.id, deal.state, "ACCEPTED");
  const docs = buildSettlementDocuments(deal.intent, deal.quote as NonNullable<Deal["quote"]>, form);
  return submitDocuments(dealDeps(deps), dealId, docs);
}
