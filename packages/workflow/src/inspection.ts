import { AttestationFormSchema, type Inspection } from "@surety/contracts";
import type { Deal } from "./deal-repo";
import { type Attestation, INSPECTABLE_JOB_STATES } from "./inspection-repo";
import type { Job } from "./repo";
import type { SourcingDeps } from "./sourcing";

// The inspector's side of the second key. The inspector is a person, never an agent: it sees the order
// (PO, goods, quantity, terms, supplier) and never the B/L number the supplier submitted, so its
// reading of the shipment is independent. Its note is display text only and never reaches a model.

export class InspectionNotFound extends Error {
  constructor(readonly dealId: string) {
    super(`deal ${dealId} has no inspection`);
    this.name = "InspectionNotFound";
  }
}

export interface InspectorItem {
  dealId: string;
  poNumber: string;
  goods: string;
  quantity: number;
  incoterm: string;
  port: string;
  supplierName: string;
  jobState: Job["state"];
}

const requiresInspection = (job: Job) => (job.criteria as { inspection?: unknown } | null)?.inspection === "required";

const asInspection = (a: Attestation): Inspection => ({
  state: a.outcome,
  inspector: a.inspector,
  blNumber: a.blNumber,
  note: a.note,
  at: a.createdAt,
});

// A sourcing deal with its job, or InspectionNotFound: missing, no job yet, not from a sourcing, or a
// job that doesn't need the inspector.
async function inspectedDeal(deps: SourcingDeps, dealId: string): Promise<{ deal: Deal; job: Job }> {
  const deal = await deps.repo.getDeal(dealId);
  if (!deal?.jobId || !(await deps.repo.getInviteByDeal(deal.id))) throw new InspectionNotFound(dealId);
  const job = await deps.repo.getJob(deal.jobId);
  if (!job || !requiresInspection(job)) throw new InspectionNotFound(dealId);
  return { deal, job };
}

// Funded sourcing deals still waiting for the inspector's answer. No B/L number, no prices, no wallets.
export async function inspectorQueue(deps: SourcingDeps): Promise<InspectorItem[]> {
  const out: InspectorItem[] = [];
  for (const job of await deps.repo.listJobsInStates([...INSPECTABLE_JOB_STATES])) {
    if (!requiresInspection(job) || (await deps.repo.getAttestation(job.id))) continue;
    const deal = await deps.repo.getDealByJob(job.id);
    if (!deal || !(await deps.repo.getInviteByDeal(deal.id))) continue;
    const { intent } = deal;
    out.push({
      dealId: deal.id,
      poNumber: intent.poNumber,
      goods: intent.goods.description,
      quantity: intent.goods.quantity,
      incoterm: intent.incoterm,
      port: intent.port,
      supplierName: intent.supplier.name,
      jobState: job.state,
    });
  }
  return out;
}

// The inspector's one answer for a deal. A bad form is refused before anything is looked up or stored.
export async function attest(deps: SourcingDeps, dealId: string, raw: unknown, inspector: string): Promise<Inspection> {
  const form = AttestationFormSchema.parse(raw);
  const { deal, job } = await inspectedDeal(deps, dealId);
  return asInspection(await deps.repo.addAttestation({ dealId: deal.id, jobId: job.id, inspector, ...form }));
}

// The deal record's inspection, in the web app's shape: null when the deal needs no inspector.
export async function inspectionOf(deps: SourcingDeps, dealId: string): Promise<Inspection | null> {
  const deal = await deps.repo.getDeal(dealId);
  const job = deal?.jobId ? await deps.repo.getJob(deal.jobId) : null;
  if (!job || !requiresInspection(job)) return null;
  const a = await deps.repo.getAttestation(job.id);
  return a ? asInspection(a) : { state: "pending" };
}
