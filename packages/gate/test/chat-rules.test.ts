import { describe, expect, it } from "vitest";
import { CHAT_RULE_IDS, RED_CARD_RULES, runChatRules, stripLinks } from "../src/index";
import { ATTACKER, SUPPLIER } from "../../../scripts/deal-fixtures";

const failed = (text: string, approvedWallet: string | null = SUPPLIER) =>
  runChatRules(text, { approvedWallet })
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id);

describe("runChatRules", () => {
  it("has the three rules, two of them red cards", () => {
    expect(CHAT_RULE_IDS).toEqual(["size", "wallet", "bank_details"]);
    expect(RED_CARD_RULES).toEqual(["wallet", "bank_details"]);
  });

  it('"we can ship in 21 days at $112.00" passes every rule', () => {
    const report = runChatRules("We can ship in 21 days at $112.00 a panel, CIF Durban.", { approvedWallet: SUPPLIER });
    expect(report.passed).toBe(true);
    expect(report.results.map((r) => r.status)).toEqual(["pass", "pass", "pass"]);
  });

  it("the supplier's own approved wallet passes", () => {
    expect(failed(`Payment goes to our approved wallet ${SUPPLIER} as agreed.`)).toEqual([]);
  });

  it("the ATTACKER wallet fails wallet", () => {
    expect(failed(`Please pay our new wallet ${ATTACKER} instead.`)).toEqual(["wallet"]);
  });

  it("any wallet fails when the supplier has no approved wallet", () => {
    expect(failed(`Our wallet is ${SUPPLIER}.`, null)).toEqual(["wallet"]);
  });

  it("a wallet with zero-width characters inside fails wallet", () => {
    const hidden = `${ATTACKER.slice(0, 10)}​${ATTACKER.slice(10, 20)}﻿${ATTACKER.slice(20)}`;
    expect(failed(`New details: ${hidden}`)).toEqual(["wallet"]);
  });

  it("a wallet split by spaces fails wallet", () => {
    const split = `${ATTACKER.slice(0, 8)} ${ATTACKER.slice(8, 17)} ${ATTACKER.slice(17)}`;
    expect(failed(`Send to ${split} please.`)).toEqual(["wallet"]);
    const dashed = `${ATTACKER.slice(0, 12)}-${ATTACKER.slice(12)}`;
    expect(failed(`Send to ${dashed} please.`)).toEqual(["wallet"]);
  });

  it('"our IBAN is GB82WEST12345698765432" fails bank_details', () => {
    expect(failed("Our IBAN is GB82WEST12345698765432.")).toEqual(["bank_details"]);
  });

  it("bank words and IBAN-shaped tokens fail bank_details", () => {
    expect(failed("Use SWIFT code ABCDZAJJ for the transfer.")).toEqual(["bank_details"]);
    expect(failed("our bic is below")).toEqual(["bank_details"]);
    expect(failed("Account number 0012345678 at Standard Bank.")).toEqual(["bank_details"]);
    expect(failed("Account no. 778899")).toEqual(["bank_details"]);
    expect(failed("Routing number 021000021")).toEqual(["bank_details"]);
    expect(failed("Sort code 20-00-00")).toEqual(["bank_details"]);
    expect(failed("pay DE89370400440532013000 today")).toEqual(["bank_details"]);
  });

  it("ordinary words that merely contain bank letters pass", () => {
    expect(failed("Our basic panels are Swiftly delivered; the account manager will confirm.")).toEqual([]);
  });

  it("a sentence whose words join into a wallet-shaped string passes: only checksum-valid addresses count", () => {
    expect(failed("repeat order next month we ship by sea")).toEqual([]);
    expect(failed("rapid response guaranteed every month")).toEqual([]);
    expect(failed(`r${"a".repeat(30)}`)).toEqual([]);
  });

  it("text over 1000 characters fails size", () => {
    expect(failed("a".repeat(1001))).toEqual(["size"]);
  });
});

describe("stripLinks", () => {
  it("stripLinks removes http, https and www links and returns them", () => {
    const out = stripLinks("Spec sheet: https://example.com/spec.pdf and http://x.io/a, also www.brightway.cn/panels today.");
    expect(out.text).toBe("Spec sheet: [link removed] and [link removed] also [link removed] today.");
    expect(out.links).toEqual(["https://example.com/spec.pdf", "http://x.io/a,", "www.brightway.cn/panels"]);
  });

  it("text without links is unchanged", () => {
    expect(stripLinks("No links here.")).toEqual({ text: "No links here.", links: [] });
  });
});
