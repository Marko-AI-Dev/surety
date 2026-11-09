import { describe, expect, it } from "vitest";
import type { HealthResponse } from "@surety/contracts";
import { buildPolicyUpdate, parseLimitArgs } from "../scripts/limits";

const args = (perDeal: string, daily: string, open: string) => ["--per-deal", perDeal, "--daily", daily, "--open", open];

const health: HealthResponse = {
  network: "testnet",
  buyer: "rHVVH877c6yuRMFuqVarsh8v3PkvxdCgk5",
  service: "rKzZaoLNcBE1qRmpMVxwP1zXLNBnRde6Lm",
  testUsd: {
    issuer: "rfgYBpTCK6Z3xouk7essk9feNbwGCrdxn3",
    currencyHex: "5445535455534400000000000000000000000000",
    approvedSuppliers: ["rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U", "rsFJVsZ2u3c57X53pPfdJq1XApXzJ3BPUx"],
    policyVersion: 4,
    limits: { perDealCents: "250000", dailyCents: "2500000", openDeals: 5 },
  },
};

describe("parseLimitArgs", () => {
  it("reads whole dollars into cents", () => {
    expect(parseLimitArgs(args("100000", "500000", "10"))).toEqual({
      perDealCents: "10000000",
      dailyCents: "50000000",
      maxOpenDeals: 10,
    });
  });

  it.each([
    ["a fractional dollar amount", args("100000.50", "500000", "10")],
    ["a missing flag", ["--per-deal", "100000", "--open", "10"]],
    ["zero open deals", args("100000", "500000", "0")],
    ["51 open deals", args("100000", "500000", "51")],
  ])("refuses %s", (_name, argv) => {
    expect(() => parseLimitArgs(argv)).toThrow();
  });

  it("refuses a per-deal cap above the 24-hour cap", () => {
    expect(() => parseLimitArgs(args("600000", "500000", "10"))).toThrow(/the per-deal cap cannot exceed the 24-hour cap/);
  });
});

describe("buildPolicyUpdate", () => {
  it("keeps the approved suppliers and targets the current policy version", () => {
    const limits = parseLimitArgs(args("100000", "500000", "10"));
    expect(buildPolicyUpdate(health, limits, "11111111-1111-4111-8111-111111111111")).toEqual({
      opId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 4,
      perDealCents: "10000000",
      dailyCents: "50000000",
      maxOpenDeals: 10,
      approvedSuppliers: ["rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U", "rsFJVsZ2u3c57X53pPfdJq1XApXzJ3BPUx"],
    });
  });

  it("refuses a signer without TESTUSD", () => {
    const limits = parseLimitArgs(args("100000", "500000", "10"));
    expect(() => buildPolicyUpdate({ ...health, testUsd: undefined }, limits, "x")).toThrow(
      "TESTUSD is not enabled on this signer",
    );
  });
});
