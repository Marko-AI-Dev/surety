import { describe, expect, it } from "vitest";
import { bootLine } from "../src/boot-line";

const base = { network: "testnet" as const, buyer: "rBuyer", service: "rService" };

describe("bootLine", () => {
  it("reports the live policy, not the starting settings", () => {
    const line = bootLine(4100, {
      ...base,
      testUsd: {
        issuer: "rIssuer",
        currencyHex: "5445535455534400000000000000000000000000",
        approvedSuppliers: ["rA"],
        policyVersion: 4,
        limits: { perDealCents: "10000000", dailyCents: "50000050", openDeals: 3 },
      },
    });
    expect(line).toBe(
      "Surety signer on 127.0.0.1:4100 | XRPL Testnet | buyer rBuyer | service rService | TESTUSD issuer rIssuer | policy v4: $100,000 per deal, $500,000.50 per 24h, 3 open",
    );
  });

  it("omits TESTUSD when it is off", () => {
    expect(bootLine(4100, base)).toBe("Surety signer on 127.0.0.1:4100 | XRPL Testnet | buyer rBuyer | service rService");
  });
});
