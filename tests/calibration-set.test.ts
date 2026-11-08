import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runRules } from "@surety/gate";

// The labelled Jev calibration set (Task 6). No network: this only checks the set itself.
const ROOT = resolve(import.meta.dirname, "..");
const DIR = resolve(ROOT, "fixtures/deliverables");
const SOURCE = readFileSync(resolve(ROOT, "fixtures/invoice-demo-001.txt"), "utf8");

interface Label {
  label: "good" | "bad";
  split: "train" | "holdout";
}
const LABELS = JSON.parse(readFileSync(resolve(DIR, "labels.json"), "utf8")) as Record<string, Label>;
const entries = Object.entries(LABELS);

describe("Jev calibration set", () => {
  it("labels exactly the 10 good and 10 bad files on disk", () => {
    const onDisk = ["good", "bad"].flatMap((dir) => readdirSync(resolve(DIR, dir)).map((f) => `${dir}/${f}`));
    expect(Object.keys(LABELS).sort()).toEqual(onDisk.sort());
    expect(entries.filter(([, l]) => l.label === "good")).toHaveLength(10);
    expect(entries.filter(([, l]) => l.label === "bad")).toHaveLength(10);
    for (const [file, l] of entries) expect(file.startsWith(`${l.label}/`)).toBe(true);
  });

  it("splits 14 train and 6 holdout, stratified 7 and 3 per label", () => {
    const count = (label: string, split: string) => entries.filter(([, l]) => l.label === label && l.split === split).length;
    expect([count("good", "train"), count("good", "holdout"), count("bad", "train"), count("bad", "holdout")]).toEqual([
      7, 3, 7, 3,
    ]);
  });

  it.each(entries.map(([file]) => file))("%s passes every deterministic rule, so only Jev can judge it", (file) => {
    const deliverable = JSON.parse(readFileSync(resolve(DIR, file), "utf8"));
    const report = runRules({ sourceText: SOURCE, allowedCurrencies: ["ZAR"], deliverable });
    expect(report.results.filter((r) => r.status !== "pass")).toEqual([]);
  });
});
