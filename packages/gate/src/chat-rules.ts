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

// A look-alike letter planted in an address is a hidden wallet whatever the map above misses.
const ASCII_BASE58 = /^[1-9A-HJ-NP-Za-km-z]$/;
// Scripts with no Latin look-alikes: a supplier writing in them is never mistaken for a hidden wallet.
const SAFE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u;
const NON_ASCII_LETTER = /[^\x00-\x7F]/;
const isLetterOrDigit = (c: string) => /[\p{L}\p{N}]/u.test(c);
// For the scan across word gaps: scripts no Latin-alphabet language mixes into its words (Greek,
// Coptic, every Cyrillic block, Armenian, Cherokee, phonetic small capitals, letterlike symbols, Lisu).
// Letters that real languages do use inside Latin words (Vietnamese, Twi, Lingala, Turkish: Latin
// Extended-A and B, IPA) are left to the word-by-word check, so those suppliers' names pass.
const LOOKALIKE =
  /[Ͱ-ϿЀ-ԯ԰-֏Ꭰ-᏿ᲀ-᲏ᴀ-ᶿ℀-⅏Ⲁ-⳿ⷠ-ⷿꙀ-ꚟꓐ-꓿ꭰ-ꮿ]/u;

function mixedScriptAddressLike(text: string): boolean {
  const clean = unicodeClean(text);
  // Word by word: a non-ASCII letter (outside the safe scripts) in a word with 15 or more address
  // characters, wherever it sits. Names are short; a disguised address is not.
  for (const word of clean.split(/\s+/)) {
    const ascii = [...word].filter((c) => ASCII_BASE58.test(c)).length;
    if (ascii >= 15 && [...word].some((c) => NON_ASCII_LETTER.test(c) && isLetterOrDigit(c) && !SAFE_SCRIPT.test(c))) return true;
  }
  // Across spaces and punctuation. A planted letter is a run of one or two look-alikes stuck to an
  // address character inside a word; a short foreign word standing on its own ("за") is not one, and
  // longer foreign words are skipped, never counted and never a veto. From any "r" or planted letter,
  // the next 35 counted characters (address characters and planted letters, within 120 letters and
  // digits) must hold at least 25 of them, with planted letters at most half.
  const all = [...clean];
  const plantedAt = new Array<boolean>(all.length).fill(false);
  for (let i = 0; i < all.length; ) {
    if (!LOOKALIKE.test(all[i] ?? "")) {
      i++;
      continue;
    }
    let j = i;
    while (j < all.length && LOOKALIKE.test(all[j] ?? "")) j++;
    const stuck = ASCII_BASE58.test(all[i - 1] ?? "") || ASCII_BASE58.test(all[j] ?? "");
    if (j - i <= 2 && stuck) for (let k = i; k < j; k++) plantedAt[k] = true;
    i = j;
  }
  const stream = all.flatMap((c, i) => (isLetterOrDigit(c) ? [{ c, planted: plantedAt[i] === true }] : []));
  for (let i = 0; i < stream.length; i++) {
    const head = stream[i];
    if (!head || (head.c !== "r" && !head.planted)) continue;
    let planted = 0;
    let address = 0;
    for (let k = i; k < Math.min(stream.length, i + 120) && address < 35; k++) {
      const s = stream[k];
      if (!s) break;
      if (s.planted) {
        planted++;
        address++;
      } else if (ASCII_BASE58.test(s.c)) {
        address++;
      }
    }
    if (planted >= 1 && planted * 2 <= address && address >= 25) return true;
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
