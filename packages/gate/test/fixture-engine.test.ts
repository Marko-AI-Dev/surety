import { describe, expect, it } from "vitest";
import { type EvaluationInput, createFixtureEngine, invoiceState } from "../src/index";

const GOOD = "1".repeat(64);
const INJECTED = "2".repeat(64);
const OFFLINE = "3".repeat(64);

function input(deliverableHash: string): EvaluationInput {
  return {
    requestId: "0b8f8f4e-3c55-4d0e-9a51-6f7f0e1c2d3a",
    questionSet: "invoice",
    state: invoiceState("criteria", "source", {
      invoice_id: "DEMO-001",
      vendor: "Demo Supplies",
      currency: "ZAR",
      total_minor: 0,
      line_items: [{ description: "x", quantity: 1, unit_minor: 0, amount_minor: 0 }],
      summary: "",
    }),
    deliverableHash,
    jobSnapshotHash: "b".repeat(64),
    policyVersion: "policy-v1",
    secondsRemaining: 60,
  };
}

const engine = createFixtureEngine({
  [GOOD]: { satisfaction: 0.95, injectionRisk: 0.02 },
  [INJECTED]: { satisfaction: 0.03, injectionRisk: 0.98 },
  [OFFLINE]: "unavailable",
});

describe("createFixtureEngine", () => {
  it("is labelled fixture, never live", () => {
    expect(engine.mode).toBe("fixture");
  });

  it("returns the scripted scores for a known deliverable hash, labelled fixture", async () => {
    const result = await engine.evaluate(input(INJECTED));
    expect(result).toMatchObject({
      status: "ok",
      mode: "fixture",
      satisfaction: 0.03,
      injectionRisk: 0.98,
      provider: "fixture",
      model: "fixture",
      costUsd: null,
      requestId: input(INJECTED).requestId,
    });
    expect(Number.isNaN(Date.parse(result.evaluatedAt))).toBe(false);
  });

  it("returns unavailable for a hash scripted as unavailable", async () => {
    expect(await engine.evaluate(input(OFFLINE))).toMatchObject({
      status: "unavailable",
      mode: "fixture",
      satisfaction: null,
      injectionRisk: null,
      reasonCodes: ["fixture_unavailable"],
    });
  });

  it("returns unavailable for an unknown hash, never a made-up score", async () => {
    expect(await engine.evaluate(input("9".repeat(64)))).toMatchObject({
      status: "unavailable",
      mode: "fixture",
      satisfaction: null,
      injectionRisk: null,
      reasonCodes: ["fixture_missing"],
    });
  });
});
