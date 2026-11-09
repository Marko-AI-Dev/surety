import { describe, expect, it } from "vitest";
import { CreateEscrowRequestSchema } from "../src/signer-api";

const base = {
  opId: "7d3c5c0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  jobRef: "deal-1",
  destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  cancelAfterSeconds: 300,
};

describe("CreateEscrowRequestSchema amounts", () => {
  it("accepts an XRP-only body", () => {
    expect(CreateEscrowRequestSchema.safeParse({ ...base, amountDrops: "1000000" }).success).toBe(true);
  });

  it("accepts a TESTUSD-only body", () => {
    expect(CreateEscrowRequestSchema.safeParse({ ...base, amountTestUsdCents: "4800000" }).success).toBe(true);
  });

  it("rejects a body with both amount fields", () => {
    const r = CreateEscrowRequestSchema.safeParse({ ...base, amountDrops: "1", amountTestUsdCents: "1" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("exactly one of amountDrops or amountTestUsdCents is required");
  });

  it("rejects a body with neither amount field", () => {
    expect(CreateEscrowRequestSchema.safeParse(base).success).toBe(false);
  });

  it("rejects a decimal TESTUSD amount", () => {
    expect(CreateEscrowRequestSchema.safeParse({ ...base, amountTestUsdCents: "48000.00" }).success).toBe(false);
  });

  it("still rejects unknown keys", () => {
    expect(CreateEscrowRequestSchema.safeParse({ ...base, amountDrops: "1", extra: 1 }).success).toBe(false);
  });
});
