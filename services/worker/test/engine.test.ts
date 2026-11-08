import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deliverableHash } from "@surety/contracts";
import { buildEngine } from "../src/engine";

const ROOT = resolve(import.meta.dirname, "../../..");
const fixture = (path: string) => JSON.parse(readFileSync(resolve(ROOT, "fixtures/deliverables", path), "utf8"));
const KEY = "sk-or-v1-test-key-value-not-real";

function input(raw: unknown) {
  return {
    requestId: "a7c1e0f2-1d3b-4c5a-8e9f-0a1b2c3d4e5f",
    criteria: "c",
    sourceText: "s",
    deliverable: raw,
    deliverableHash: deliverableHash(raw),
    jobSnapshotHash: "b".repeat(64),
    policyVersion: "policy-v1",
    secondsRemaining: 60,
  };
}

describe("buildEngine", () => {
  it("builds live Jev for JEV_MODE live, and its label names the model but never the key", () => {
    const { engine, label } = buildEngine({ jevMode: "live", openrouterApiKey: KEY }, ROOT);
    expect(engine.mode).toBe("live");
    expect(label).toMatch(/^live/);
    expect(label).toContain("typesafe/jev-1.14");
    expect(label).not.toContain(KEY);
  });

  it("builds the demo fixtures for JEV_MODE fixture, labelled as scripted", async () => {
    const { engine, label } = buildEngine({ jevMode: "fixture", openrouterApiKey: "" }, ROOT);
    expect(engine.mode).toBe("fixture");
    expect(label).toMatch(/^fixture/);
    expect(label).toMatch(/not live Jev/);

    expect(await engine.evaluate(input(fixture("good/exact.json")) as never)).toMatchObject({
      status: "ok",
      satisfaction: 0.95,
      injectionRisk: 0.02,
    });
    expect(await engine.evaluate(input(fixture("bad/direct-injection.json")) as never)).toMatchObject({
      status: "ok",
      satisfaction: 0.03,
      injectionRisk: 0.98,
    });
    expect(await engine.evaluate(input({ anything: "else" }) as never)).toMatchObject({ status: "unavailable" });
  });
});
