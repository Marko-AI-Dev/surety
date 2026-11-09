import { describe, expect, it } from "vitest";
import { type EvaluationResult, runChatRules } from "@surety/gate";
import { chatLabelled } from "../scripts/chat-fixtures";
import { type ChatRow, chatOutcome, chatVerdict } from "../scripts/calibration-verdict";
import { SUPPLIER } from "../scripts/deal-fixtures";

const ok = (sat: number, inj: number): EvaluationResult => ({
  status: "ok",
  mode: "live",
  satisfaction: sat,
  injectionRisk: inj,
  provider: "TypeSafe",
  model: "typesafe/jev-1.14",
  latencyMs: 100,
  reasonCodes: [],
  requestId: "r",
  evaluatedAt: "2026-11-09T18:00:00.000Z",
  costUsd: 0.00005,
});

const row = (file: string, label: "good" | "bad", result: EvaluationResult): ChatRow => ({ file, label, split: "train", result });

describe("the labelled chat set", () => {
  it("labels are 12 good and 12 bad with a 6/6 train split each", () => {
    const entries = Object.entries(chatLabelled);
    const count = (label: string, split: string) => entries.filter(([, v]) => v.label === label && v.split === split).length;
    expect(count("good", "train")).toBe(6);
    expect(count("good", "holdout")).toBe(6);
    expect(count("bad", "train")).toBe(6);
    expect(count("bad", "holdout")).toBe(6);
  });

  it("every labelled message passes the chat code rules", () => {
    for (const [file, v] of Object.entries(chatLabelled)) {
      const report = runChatRules(v.text, { approvedWallet: SUPPLIER });
      expect(report.passed, file).toBe(true);
    }
  });
});

describe("chat calibration outcomes under chat-v1", () => {
  it("maps one answer to deliver, yellow or quarantine", () => {
    expect(chatOutcome(ok(0.9, 0.05))).toBe("deliver");
    expect(chatOutcome(ok(0.8, 0.9))).toBe("yellow");
    expect(chatOutcome(ok(0.9, 0.3))).toBe("quarantine");
    expect(chatOutcome(ok(0, 0.05))).toBe("quarantine");
    expect(chatOutcome({ ...ok(0, 0), status: "unavailable", satisfaction: null, injectionRisk: null })).toBe("quarantine");
  });

  it("passes when no bad message is delivered and at most one good message is held", () => {
    const rows = [row("good/a", "good", ok(0.9, 0.05)), row("good/b", "good", ok(0.9, 0.3)), row("bad/a", "bad", ok(0.8, 0.9))];
    expect(chatVerdict(rows)).toEqual({ badDelivered: [], goodHeld: ["good/b"], pass: true });
  });

  it("fails on one delivered bad message or two held good ones", () => {
    expect(chatVerdict([row("bad/a", "bad", ok(0.9, 0.05))]).pass).toBe(false);
    expect(chatVerdict([row("good/a", "good", ok(0.9, 0.3)), row("good/b", "good", ok(0.9, 0.6))]).pass).toBe(false);
  });
});
