import { join } from "node:path";
import { type PolicyView, type UpdatePolicyRequest, canonicalJson, sha256Hex } from "@surety/contracts";
import { SignerError } from "./errors";
import { JsonFile } from "./store";

// The operator's live TESTUSD policy: caps and approved suppliers. Only the operator-only route can
// change it. Every change is appended to a history file before the current policy is rewritten, so
// the audit trail is never behind what the signer enforces.

export interface PolicyGuard {
  // Addresses that may never be approved suppliers: the treasury, the service account, the issuer.
  forbidden: string[];
}

interface HistoryEntry {
  opId: string;
  requestHash: string;
  view: PolicyView;
}

export interface PolicyStore {
  current(): PolicyView;
  update(req: UpdatePolicyRequest, guard: PolicyGuard): PolicyView;
}

export function createPolicyStore(
  dataDir: string,
  initial: Omit<PolicyView, "version" | "updatedAt">,
  now: () => Date = () => new Date(),
): PolicyStore {
  const file = new JsonFile<PolicyView | null>(join(dataDir, "policy.json"), null);
  const history = new JsonFile<HistoryEntry[]>(join(dataDir, "policy-history.json"), []);

  const last = history.get().at(-1);
  if (last && (file.get()?.version ?? 0) < last.view.version) {
    // A crash between the two writes: the history is ahead, so it wins.
    file.update(() => last.view);
  }
  if (!file.get()) {
    // First boot: config seeds version 1. Later boots never let config overwrite an operator change.
    const view: PolicyView = { ...initial, approvedSuppliers: [...initial.approvedSuppliers], version: 1, updatedAt: now().toISOString() };
    history.update((h) => [...h, { opId: "initial-config", requestHash: "", view }]);
    file.update(() => view);
  }

  const current = (): PolicyView => file.get() as PolicyView;

  function update(req: UpdatePolicyRequest, guard: PolicyGuard): PolicyView {
    const requestHash = sha256Hex(canonicalJson(req));
    const prior = history.get().find((h) => h.opId === req.opId);
    if (prior) {
      if (prior.requestHash === requestHash) return prior.view;
      throw new SignerError("op_conflict", "opId was already used with a different policy");
    }
    const cur = current();
    if (req.expectedVersion !== cur.version) {
      throw new SignerError("policy_conflict", `the policy is at version ${cur.version}; reload it and try again`);
    }
    if (req.approvedSuppliers.some((a) => guard.forbidden.includes(a))) {
      throw new SignerError("bad_request", "the treasury, the service account and the issuer cannot be approved suppliers");
    }
    if (BigInt(req.perDealCents) > BigInt(req.dailyCents)) {
      throw new SignerError("bad_request", "the per-deal cap cannot exceed the 24-hour cap");
    }
    const view: PolicyView = {
      version: cur.version + 1,
      perDealCents: req.perDealCents,
      dailyCents: req.dailyCents,
      maxOpenDeals: req.maxOpenDeals,
      approvedSuppliers: [...req.approvedSuppliers],
      updatedAt: now().toISOString(),
    };
    history.update((h) => [...h, { opId: req.opId, requestHash, view }]);
    file.update(() => view);
    return view;
  }

  return { current, update };
}
