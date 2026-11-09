import { createHash } from "node:crypto";
import { MESSAGE_MAX_CHARS } from "@surety/contracts";

// The bouncer's code rules for a supplier chat message. Payment details never travel in chat: the
// supplier's wallet is fixed at approval, so any other wallet or any bank detail is a red card.
// These checks need no AI and run before the decision model is asked anything.

export const CHAT_RULE_IDS = ["size", "wallet", "bank_details"] as const;
export type ChatRuleId = (typeof CHAT_RULE_IDS)[number];
export const RED_CARD_RULES: readonly ChatRuleId[] = ["wallet", "bank_details"];

export interface ChatRuleResult {
  id: ChatRuleId;
  status: "pass" | "fail";
  detail?: string;
}

export interface ChatRulesReport {
  passed: boolean;
  results: ChatRuleResult[];
}

const ZERO_WIDTH = /[​-‍﻿]/g;
const RIPPLE_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
const BASE58_TOKEN = /^[1-9A-HJ-NP-Za-km-z]+$/;
const CANDIDATE = /(?<![A-Za-z0-9])r[1-9A-HJ-NP-Za-km-z]{24,34}(?![A-Za-z0-9])/g;

// A real XRPL classic address: Ripple base58, version byte 0, 20-byte account, 4-byte checksum.
// Random words almost never pass the checksum, so joining text fragments cannot red-card a sentence.
function isClassicAddress(candidate: string): boolean {
  let value = 0n;
  for (const ch of candidate) {
    const digit = RIPPLE_ALPHABET.indexOf(ch);
    if (digit < 0) return false;
    value = value * 58n + BigInt(digit);
  }
  const hex = value.toString(16).padStart(50, "0");
  if (hex.length !== 50) return false;
  const bytes = Buffer.from(hex, "hex");
  if (bytes[0] !== 0) return false;
  const body = bytes.subarray(0, 21);
  const checksum = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  return checksum.equals(bytes.subarray(21));
}

// Every valid address in the text: whole tokens first, then fragments split by spaces or dashes.
function walletsIn(text: string): string[] {
  const clean = text.replace(ZERO_WIDTH, "");
  const found = new Set<string>();
  for (const m of clean.matchAll(CANDIDATE)) if (isClassicAddress(m[0])) found.add(m[0]);
  const tokens = clean.split(/[\s-]+/).map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""));
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]?.startsWith("r")) continue;
    let joined = "";
    for (let j = i; j < tokens.length; j++) {
      const t = tokens[j] ?? "";
      if (!BASE58_TOKEN.test(t)) break;
      joined += t;
      if (joined.length > 35) break;
      if (joined.length >= 25 && isClassicAddress(joined)) found.add(joined);
    }
  }
  return [...found];
}

const BANK_PATTERNS: RegExp[] = [
  /\bIBAN\b/i,
  /\bSWIFT\b/i,
  /\bBIC\b/i,
  /\baccount\s+(?:number|no\b\.?)/i,
  /\brouting\s+number\b/i,
  /\bsort\s+code\b/i,
  /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/,
];

export function runChatRules(text: string, ctx: { approvedWallet: string | null }): ChatRulesReport {
  const results: ChatRuleResult[] = [];
  results.push(
    text.length > MESSAGE_MAX_CHARS
      ? { id: "size", status: "fail", detail: `the message is ${text.length} characters, above ${MESSAGE_MAX_CHARS}` }
      : { id: "size", status: "pass" },
  );
  const foreign = walletsIn(text).filter((w) => w !== ctx.approvedWallet);
  results.push(
    foreign.length > 0
      ? { id: "wallet", status: "fail", detail: "the message names a wallet other than the supplier's approved one" }
      : { id: "wallet", status: "pass" },
  );
  results.push(
    BANK_PATTERNS.some((p) => p.test(text.replace(ZERO_WIDTH, "")))
      ? { id: "bank_details", status: "fail", detail: "the message carries bank payment details" }
      : { id: "bank_details", status: "pass" },
  );
  return { passed: results.every((r) => r.status === "pass"), results };
}

const LINK = /(?:https?:\/\/|www\.)\S+/gi;

// Links never reach the agents: each one is replaced, and returned for the record.
export function stripLinks(text: string): { text: string; links: string[] } {
  const links = text.match(LINK) ?? [];
  return { text: text.replace(LINK, "[link removed]"), links };
}
