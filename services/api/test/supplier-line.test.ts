import { describe, expect, it } from "vitest";
import { createSupplierLine } from "../src/supplier-line";

describe("createSupplierLine", () => {
  it("reads a trust line into cents, including the ledger's bare zero", async () => {
    const line = createSupplierLine(async () => ({ balance: "0", limit: "1000000000", frozenByIssuer: false }));
    expect(await line("rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U")).toEqual({ balanceCents: 0n, limitCents: 100_000_000_000n, frozenByIssuer: false });
  });

  it("passes a balance and the issuer freeze through", async () => {
    const line = createSupplierLine(async () => ({ balance: "48000", limit: "1000000", frozenByIssuer: true }));
    expect(await line("r")).toEqual({ balanceCents: 4_800_000n, limitCents: 100_000_000n, frozenByIssuer: true });
  });

  it("no trust line, or a value it can't read, is null", async () => {
    expect(await createSupplierLine(async () => null)("r")).toBeNull();
    expect(await createSupplierLine(async () => ({ balance: "1e5", limit: "10", frozenByIssuer: false }))("r")).toBeNull();
  });
});
