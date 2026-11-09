import { describe, expect, it } from "vitest";
import {
  type DecisionEngine,
  type EvaluationInput,
  type EvaluationResult,
  POLICIES,
  POLICY_V3_TRADE,
  TRADE_POLICY,
  isBorderline,
  withReask,
} from "../src/index";

const band = POLICY_V3_TRADE.reaskBand!;

const input: EvaluationInput = {
  requestId: "5b1e9a52-6c8e-4c0f-8d7b-1a2b3c4d5e6f",
  questionSet: "trade",
  state: {},
  deliverableHash: "a".repeat(64),
  jobSnapshotHash: "b".repeat(64),
  policyVersion: "policy-v3-trade",
  secondsRemaining: 120,
};

type Answer = [number, number] | "unavailable";

function ok(sat: number, inj: number, cost: number | null = 0.00003): EvaluationResult {
  return {
    status: "ok",
    mode: "live",
    satisfaction: sat,
    injectionRisk: inj,
    provider: "TypeSafe",
    model: "typesafe/jev-1.14",
    latencyMs: 100,
    reasonCodes: [],
    requestId: input.requestId,
    evaluatedAt: "2026-11-09T12:00:00.000Z",
    costUsd: cost,
  };
}

// Answers in order; counts the asks.
function scripted(...answers: Answer[]) {
  let asks = 0;
  const engine: DecisionEngine = {
    mode: "live",
    async evaluate() {
      const a = answers[asks++];
      if (a === undefined) throw new Error("no scripted answer left");
      if (a === "unavailable") {
        return { ...ok(0, 0), status: "unavailable", satisfaction: null, injectionRisk: null, reasonCodes: ["timeout"] };
      }
      return ok(a[0], a[1]);
    },
  };
  return { engine, asks: () => asks };
}

describe("withReask", () => {
  it("policy-v3-trade is the trade policy, is registered, and has a borderline band", () => {
    expect(TRADE_POLICY).toBe(POLICY_V3_TRADE);
    expect(POLICIES).toContain(POLICY_V3_TRADE);
    expect(band).toEqual({ satisfaction: [0.6, 0.8], injectionRisk: [0.05, 0.2] });
  });

  it("isBorderline is inclusive on both ends of either score", () => {
    expect(isBorderline(ok(0.6, 0.02), band)).toBe(true);
    expect(isBorderline(ok(0.8, 0.02), band)).toBe(true);
    expect(isBorderline(ok(0.95, 0.05), band)).toBe(true);
    expect(isBorderline(ok(0.95, 0.02), band)).toBe(false);
    expect(isBorderline(ok(0.81, 0.21), band)).toBe(false);
  });

  it("a clear answer (0.95, 0.02) is asked once", async () => {
    const s = scripted([0.95, 0.02]);
    const r = await withReask(s.engine, band).evaluate(input);
    expect(s.asks()).toBe(1);
    expect(r).toMatchObject({ status: "ok", satisfaction: 0.95, injectionRisk: 0.02 });
    expect(r.samples).toBeUndefined();
  });

  it("a borderline 0.72 asks twice more and uses the median: 0.72, 0.66, 0.69 gives 0.69", async () => {
    const s = scripted([0.72, 0.02], [0.66, 0.03], [0.69, 0.01]);
    const r = await withReask(s.engine, band).evaluate(input);
    expect(s.asks()).toBe(3);
    expect(r).toMatchObject({ status: "ok", satisfaction: 0.69, injectionRisk: 0.02, reasonCodes: ["reasked"] });
  });

  it("the median of 0.68, 0.74, 0.76 is 0.74", async () => {
    const s = scripted([0.68, 0.02], [0.74, 0.02], [0.76, 0.02]);
    expect((await withReask(s.engine, band).evaluate(input)).satisfaction).toBe(0.74);
  });

  it("a borderline injection of 0.12 is re-asked", async () => {
    const s = scripted([0.95, 0.12], [0.94, 0.08], [0.96, 0.15]);
    const r = await withReask(s.engine, band).evaluate(input);
    expect(s.asks()).toBe(3);
    expect(r.injectionRisk).toBe(0.12);
  });

  it("a failed second ask returns unavailable reask_unavailable", async () => {
    const s = scripted([0.72, 0.02], "unavailable", [0.75, 0.02]);
    const r = await withReask(s.engine, band).evaluate(input);
    expect(r).toMatchObject({ status: "unavailable", satisfaction: null, injectionRisk: null, reasonCodes: ["reask_unavailable"] });
  });

  it("no time left returns unavailable reask_no_time", async () => {
    const s = scripted([0.72, 0.02]);
    const r = await withReask(s.engine, band).evaluate({ ...input, secondsRemaining: 9 });
    expect(s.asks()).toBe(1);
    expect(r).toMatchObject({ status: "unavailable", reasonCodes: ["reask_no_time"] });
  });

  it("an unavailable first answer is returned unchanged", async () => {
    const s = scripted("unavailable");
    const r = await withReask(s.engine, band).evaluate(input);
    expect(s.asks()).toBe(1);
    expect(r).toMatchObject({ status: "unavailable", reasonCodes: ["timeout"] });
  });

  it("samples and summed cost and latency are recorded", async () => {
    const s = scripted([0.72, 0.02], [0.66, 0.03], [0.69, 0.01]);
    const r = await withReask(s.engine, band).evaluate(input);
    expect(r.samples).toEqual([
      { satisfaction: 0.72, injectionRisk: 0.02 },
      { satisfaction: 0.66, injectionRisk: 0.03 },
      { satisfaction: 0.69, injectionRisk: 0.01 },
    ]);
    expect(r.costUsd).toBeCloseTo(0.00009, 10);
    expect(r.latencyMs).toBe(300);
  });
});
