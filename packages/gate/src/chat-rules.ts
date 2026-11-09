import { createHash } from "node:crypto";
import { MESSAGE_MAX_CHARS } from "@surety/contracts";

// The bouncer's code rules for a supplier chat message. Payment details never travel in chat: the
// supplier's wallet is fixed at approval, so any other wallet or any bank detail is a red card.
// These checks need no AI and run before the decision model is asked anything. They normalise the
// text first (Unicode NFKC, every format character removed, common look-alike letters mapped), and
// only checksum-valid addresses and IBANs count, so joining fragments aggressively stays safe.

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

// Cyrillic and Greek letters that look like the Latin ones an address or a bank word uses.
const CONFUSABLES: Record<string, string> = {
  "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "К": "K", "М": "M",
  "О": "O", "Р": "P", "Т": "T", "Х": "X", "а": "a", "е": "e", "к": "k",
  "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j",
  "ѕ": "s", "ԁ": "d", "ɡ": "g", "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z",
  "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P",
  "Τ": "T", "Υ": "Y", "Χ": "X", "ο": "o", "ν": "v",
};

const FORMAT_CHARS = /\p{Cf}/gu;
const unicodeClean = (text: string) => text.normalize("NFKC").replace(FORMAT_CHARS, "");
const normalize = (text: string) => [...unicodeClean(text)].map((c) => CONFUSABLES[c] ?? c).join("");

const RIPPLE_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
const NOT_BASE58 = /[^1-9A-HJ-NP-Za-km-z]/g;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

function decodeBase58(s: string, nBytes: number): Buffer | null {
  let value = 0n;
  for (const ch of s) {
    const digit = RIPPLE_ALPHABET.indexOf(ch);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const hex = value.toString(16).padStart(nBytes * 2, "0");
  return hex.length === nBytes * 2 ? Buffer.from(hex, "hex") : null;
}

const checksumOk = (bytes: Buffer, bodyLength: number) =>
  sha256(sha256(bytes.subarray(0, bodyLength))).subarray(0, 4).equals(bytes.subarray(bodyLength));

// A classic address's 20-byte account as hex, or null. Comparing accounts, not strings, means extra
// leading "r" characters in the text cannot make the approved wallet look like a different one.
function classicAccount(s: string): string | null {
  const b = decodeBase58(s, 25);
  return b && b[0] === 0 && checksumOk(b, 21) ? b.subarray(1, 21).toString("hex") : null;
}

// An X-address (mainnet 0x05 0x44 or testnet 0x04 0x93 prefix): an address plus a tag.
function isXAddress(s: string): boolean {
  const b = decodeBase58(s, 35);
  if (!b) return false;
  const prefixOk = (b[0] === 0x05 && b[1] === 0x44) || (b[0] === 0x04 && b[1] === 0x93);
  return prefixOk && checksumOk(b, 31);
}

// Every account the text names, read from the text with all non-address characters removed, so no
// separator, invisible character or look-alike letter can hide one. X-addresses always count.
function walletsIn(text: string): { accounts: Set<string>; xAddress: boolean } {
  const stream = normalize(text).replace(NOT_BASE58, "");
  const accounts = new Set<string>();
  let xAddress = false;
  for (let i = 0; i < stream.length; i++) {
    const c = stream[i];
    if (c === "r") {
      for (let len = 25; len <= 35 && i + len <= stream.length; len++) {
        const account = classicAccount(stream.slice(i, i + len));
        if (account) accounts.add(account);
      }
    } else if (c === "X" || c === "T") {
      for (let len = 45; len <= 49 && i + len <= stream.length; len++) {
        if (isXAddress(stream.slice(i, i + len))) xAddress = true;
      }
    }
  }
  return { accounts, xAddress };
}

const BANK_KEYWORDS: RegExp[] = [
  /\bIBAN\b/i,
  /\bSWIFT\b/i,
  /\bBIC\b/i,
  /\b(?:account|acct|a\/c)\.?\s*(?:number|no\b\.?|num\b|#)/i,
  /\brouting\s+(?:number|no\b)/i,
  /\bsort\s+code\b/i,
  /\bbeneficiary\s+(?:account|bank)\b/i,
];

function ibanChecksumOk(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  let rem = 0;
  for (const ch of iban.slice(4) + iban.slice(0, 4)) {
    const v = ch >= "A" && ch <= "Z" ? ch.charCodeAt(0) - 55 : Number(ch);
    rem = (rem * (v >= 10 ? 100 : 10) + v) % 97;
  }
  return rem === 1;
}

// IBANs as printed (in groups split by spaces, dots or dashes) or run together. Only mod-97 valid
// ones count; candidates are tested at group boundaries and at the end of the run.
function hasIban(text: string): boolean {
  const up = text.toUpperCase();
  for (const m of up.matchAll(/(?<![A-Z0-9])[A-Z]{2}\d{2}/g)) {
    let i = m.index ?? 0;
    let compact = "";
    while (i < up.length && compact.length < 34) {
      const ch = up[i] ?? "";
      if (/[A-Z0-9]/.test(ch)) {
        compact += ch;
        i++;
      } else {
        // A separator is any run of up to three non-alphanumeric characters between groups.
        let j = i;
        while (j < up.length && j - i < 3 && !/[A-Z0-9]/.test(up[j] ?? "")) j++;
        if (!/[A-Z0-9]/.test(up[j] ?? "")) break;
        if (compact.length >= 15 && ibanChecksumOk(compact)) return true;
        i = j;
      }
    }
    if (compact.length >= 15 && ibanChecksumOk(compact)) return true;
  }
  return false;
}

function hasBankDetails(text: string): boolean {
  const n = normalize(text);
  // "I.B.A.N" and "S-W-I-F-T": separators between letters are dropped for the keyword check.
  const joined = n.replace(/(?<=[A-Za-z])[.\-_*](?=[A-Za-z])/g, "");
  return BANK_KEYWORDS.some((p) => p.test(n) || p.test(joined)) || hasIban(n);
}

// A look-alike letter planted inside an address-like run is a hidden wallet whatever the map above
// misses. Scripts with Latin look-alikes: Greek, Coptic, Cyrillic (all blocks), Armenian, Latin
// Extended-B and D, IPA and phonetic letters, spacing modifiers, Cherokee, letterlike symbols and Lisu.
// CJK, accented Latin-1 and Extended-A names pass. The scan crosses spaces and punctuation, like the
// wallet scan; a planted letter must sit between two address characters, which words of another
// script (in runs) do not.
const LOOKALIKE =
  /[ƀ-˿Ͱ-ϿЀ-ԯ԰-֏Ꭰ-᏿ᲀ-᲏ᴀ-ᶿ℀-⅏Ⲁ-⳿ⷠ-ⷿꙀ-ꚟꓐ-꓿꜠-ꟿꭰ-ꮿ]/u;
const ASCII_BASE58 = /^[1-9A-HJ-NP-Za-km-z]$/;
function mixedScriptAddressLike(text: string): boolean {
  const chars = [...unicodeClean(text)].filter((c) => /[\p{L}\p{N}]/u.test(c));
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "r") continue;
    const win = chars.slice(i, i + 35);
    if (win.filter((c) => ASCII_BASE58.test(c)).length < 24) continue;
    for (let k = 1; k < win.length - 1; k++) {
      const c = win[k] ?? "";
      if (LOOKALIKE.test(c) && ASCII_BASE58.test(win[k - 1] ?? "") && ASCII_BASE58.test(win[k + 1] ?? "")) return true;
    }
  }
  return false;
}

// The rules judge every form of the message: as sent, as the agent would read it (normalised and
// de-disguised), and that again with its links removed, so nothing removed or rewritten on delivery
// can join the halves of a wallet or an IBAN after the check.
export function runChatRules(text: string, ctx: { approvedWallet: string | null }): ChatRulesReport {
  const delivered = deliveredForm(text);
  const sent = stripLinks(text).text;
  const forms = [text, delivered, sent, delivered.replace(LINK, "")];
  const length = Math.max(text.length, delivered.length, sent.length);
  const results: ChatRuleResult[] = [];
  results.push(
    length > MESSAGE_MAX_CHARS
      ? { id: "size", status: "fail", detail: `the message is ${length} characters, above ${MESSAGE_MAX_CHARS}` }
      : { id: "size", status: "pass" },
  );
  const approved = ctx.approvedWallet ? classicAccount(ctx.approvedWallet) : null;
  const found = forms.map(walletsIn);
  const foreign =
    found.some((f) => f.xAddress || [...f.accounts].some((a) => a !== approved)) || forms.some(mixedScriptAddressLike);
  results.push(
    foreign
      ? { id: "wallet", status: "fail", detail: "the message names a wallet other than the supplier's approved one" }
      : { id: "wallet", status: "pass" },
  );
  results.push(
    forms.some(hasBankDetails)
      ? { id: "bank_details", status: "fail", detail: "the message carries bank payment details" }
      : { id: "bank_details", status: "pass" },
  );
  return { passed: results.every((r) => r.status === "pass"), results };
}

// Disguises undone before links are found: "[.]", "(dot)" and "hxxp".
const deobfuscate = (text: string) =>
  text.replace(/\[\.\]|\(\.\)|\[dot\]|\(dot\)|\{\.\}/gi, ".").replace(/\bhxxp(s?):\/\//gi, "http$1://");

const LINK =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/\S+|(?:mailto|javascript|data|file|tel):\S+|www\.\S+|(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/\S*)?)/gi;

// The text an agent receives before links are replaced: Unicode-normalised and de-disguised. The
// rules check this form too, so the check and the delivery can never read different text.
export function deliveredForm(text: string): string {
  return deobfuscate(unicodeClean(text));
}

// Links never reach the agents: every URL, bare domain or disguised link is replaced, and returned
// for the record.
export function stripLinks(text: string): { text: string; links: string[] } {
  const clean = deliveredForm(text);
  const links = clean.match(LINK) ?? [];
  return { text: clean.replace(LINK, "[link removed]"), links };
}
