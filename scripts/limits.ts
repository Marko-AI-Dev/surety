import type { HealthResponse, UpdatePolicyRequest } from "@surety/contracts";

// Pure helpers for the operator limits command (scripts/set-limits.ts). Limits are given in whole
// dollars on the command line and sent to the signer as integer cents.

export interface LimitArgs {
  perDealCents: string;
  dailyCents: string;
  maxOpenDeals: number;
}

const WHOLE = /^[1-9][0-9]{0,8}$/;

function flag(argv: string[], name: string): string {
  const at = argv.indexOf(name);
  const value = at === -1 ? undefined : argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function dollars(argv: string[], name: string): bigint {
  const value = flag(argv, name);
  if (!WHOLE.test(value)) throw new Error(`${name} must be whole dollars, for example 100000`);
  return BigInt(value) * 100n;
}

export function parseLimitArgs(argv: string[]): LimitArgs {
  const perDeal = dollars(argv, "--per-deal");
  const daily = dollars(argv, "--daily");
  const open = flag(argv, "--open");
  if (!/^[0-9]{1,2}$/.test(open) || Number(open) < 1 || Number(open) > 50) {
    throw new Error("--open must be a whole number from 1 to 50");
  }
  if (perDeal > daily) throw new Error("the per-deal cap cannot exceed the 24-hour cap");
  return { perDealCents: perDeal.toString(), dailyCents: daily.toString(), maxOpenDeals: Number(open) };
}

// Changes the limits only: the approved suppliers are carried over from the live policy, and the
// update targets the version the signer reports, so a concurrent change is refused, never overwritten.
export function buildPolicyUpdate(health: HealthResponse, limits: LimitArgs, opId: string): UpdatePolicyRequest {
  if (!health.testUsd) throw new Error("TESTUSD is not enabled on this signer");
  return {
    opId,
    expectedVersion: health.testUsd.policyVersion,
    perDealCents: limits.perDealCents,
    dailyCents: limits.dailyCents,
    maxOpenDeals: limits.maxOpenDeals,
    approvedSuppliers: [...health.testUsd.approvedSuppliers],
  };
}
