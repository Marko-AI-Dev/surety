import type { SourcingBrief } from "@surety/contracts";

// Surety's ranking of committed quotes for the buyer's stated priority. It uses the maximum price, so
// it is shown to the lead only, never to the negotiator. The lead may choose otherwise; Surety then
// records the choice and the lead's reason (sourcing-deal.ts). It ranks, it never blocks.

export interface RankedQuote {
  supplier: string;
  unitCents: number;
  deliveryDays: number | null;
  eligible: boolean;
  why: string | null;
}

export interface RankableOffer {
  supplier: string;
  status: "in" | "out";
  unitCents: number;
  deliveryDays: number | null;
}

function whyNot(brief: SourcingBrief, o: RankableOffer): string | null {
  if (o.status === "out") return "out";
  if (o.unitCents > brief.goods.maxUnitCents) return "above the maximum";
  if (o.deliveryDays === null) return "no delivery days";
  if (brief.latestDeliveryDays !== undefined && o.deliveryDays > brief.latestDeliveryDays) return `slower than ${brief.latestDeliveryDays} days`;
  return null;
}

const cmp = (a: bigint | number, b: bigint | number) => (a < b ? -1 : a > b ? 1 : 0);
const byAddress = (a: RankedQuote, b: RankedQuote) => (a.supplier < b.supplier ? -1 : a.supplier > b.supplier ? 1 : 0);

export function rankQuotes(brief: SourcingBrief, offers: RankableOffer[]): RankedQuote[] {
  const ranked = offers.map((o): RankedQuote => {
    const why = whyNot(brief, o);
    return { supplier: o.supplier, unitCents: o.unitCents, deliveryDays: o.deliveryDays, eligible: why === null, why };
  });
  const eligible = ranked.filter((q) => q.eligible);
  const rest = ranked.filter((q) => !q.eligible).sort((a, b) => cmp(a.unitCents, b.unitCents) || byAddress(a, b));

  if (eligible.length === 0) return rest;
  const days = (q: RankedQuote) => q.deliveryDays ?? 0;
  const minCents = BigInt(Math.min(...eligible.map((q) => q.unitCents)));
  const minDays = BigInt(Math.min(...eligible.map(days)));
  // Balanced: price / minPrice + days / minDays, multiplied through by minPrice x minDays so it stays
  // exact in integers.
  const score = (q: RankedQuote) => BigInt(q.unitCents) * minDays + BigInt(days(q)) * minCents;
  const order: Record<SourcingBrief["priority"], (a: RankedQuote, b: RankedQuote) => number> = {
    price: (a, b) => cmp(a.unitCents, b.unitCents) || cmp(days(a), days(b)),
    speed: (a, b) => cmp(days(a), days(b)) || cmp(a.unitCents, b.unitCents),
    balanced: (a, b) => cmp(score(a), score(b)) || cmp(a.unitCents, b.unitCents),
  };
  eligible.sort((a, b) => order[brief.priority](a, b) || byAddress(a, b));
  return [...eligible, ...rest];
}
