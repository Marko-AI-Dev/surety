import { describe, expect, it } from "vitest";
import { Wallet } from "xrpl";
import { renderIssuerEnv, renderOperatorEnv, renderTestUsdEnv } from "../scripts/testusd-env";

const issuer = Wallet.generate().classicAddress;
const suppliers = [1, 2, 3, 4].map(() => Wallet.generate().classicAddress);
const operatorSecret = "ab".repeat(32);

describe("TESTUSD env files", () => {
  it("renders the TESTUSD settings with no key material other than the operator secret", () => {
    const text = renderTestUsdEnv({ issuer, approvedSuppliers: suppliers, operatorSecret });
    expect(text).toMatch(new RegExp(`^TESTUSD_ISSUER=${issuer}$`, "m"));
    expect(text).toMatch(new RegExp(`^APPROVED_SUPPLIERS=${suppliers.join(",")}$`, "m"));
    expect(text).toMatch(/^MAX_DEAL_TESTUSD_CENTS=10000000$/m);
    expect(text).toMatch(/^DAILY_TESTUSD_CENTS=50000000$/m);
    expect(text).toMatch(/^MAX_OPEN_TESTUSD_DEALS=10$/m);
    expect(text).toMatch(new RegExp(`^OPERATOR_HMAC_SECRET=${operatorSecret}$`, "m"));
    expect(text).not.toMatch(/SEED|^s[1-9A-HJ-NP-Za-km-z]{20,}/m);
    expect(text).toContain("# initial policy; change it live through the operator policy update");
  });

  it("renders the issuer key file with its warning header", () => {
    const seed = Wallet.generate().seed as string;
    const text = renderIssuerEnv(seed);
    expect(text.split("\n")[0]).toMatch(/never commit/i);
    expect(text).toMatch(new RegExp(`^TESTUSD_ISSUER_SEED=${seed}$`, "m"));
  });

  it("renders the operator file with the operator secret only", () => {
    const text = renderOperatorEnv(operatorSecret);
    const settings = text.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(settings).toEqual([`OPERATOR_HMAC_SECRET=${operatorSecret}`]);
    expect(text).toMatch(/never give this to the worker or the agents/i);
  });
});
