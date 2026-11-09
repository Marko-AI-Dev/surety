import type { DecisionEngine, EvaluationInput, EvaluationResult, ScoreSample } from "./engine";

// The decision model's scores move a few hundredths between identical calls. A first answer close to
// a threshold is asked twice more and each score becomes the median of three, so one wobble cannot
// decide a borderline case. Anything short of three good answers is unavailable: fail closed.

export interface ReaskBand {
  satisfaction: readonly [number, number];
  injectionRisk: readonly [number, number];
}

const within = (v: number | null, [lo, hi]: readonly [number, number]) => v !== null && v >= lo && v <= hi;

export function isBorderline(r: EvaluationResult, band: ReaskBand): boolean {
  return within(r.satisfaction, band.satisfaction) || within(r.injectionRisk, band.injectionRisk);
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[1] ?? Number.NaN;
};

function unavailable(first: EvaluationResult, reason: string, latencyMs: number, costUsd: number | null): EvaluationResult {
  return { ...first, status: "unavailable", satisfaction: null, injectionRisk: null, reasonCodes: [reason], latencyMs, costUsd };
}

const sumCost = (rs: EvaluationResult[]): number | null =>
  rs.every((r) => r.costUsd === null) ? null : rs.reduce((acc, r) => acc + (r.costUsd ?? 0), 0);

export function withReask(engine: DecisionEngine, band: ReaskBand, minSecondsForReask = 10): DecisionEngine {
  return {
    mode: engine.mode,
    async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
      const started = Date.now();
      const first = await engine.evaluate(input);
      if (first.status !== "ok" || !isBorderline(first, band)) return first;

      const left = input.secondsRemaining - (Date.now() - started) / 1000;
      if (left < minSecondsForReask) return unavailable(first, "reask_no_time", first.latencyMs, first.costUsd);

      const rest = [
        await engine.evaluate({ ...input, secondsRemaining: left }),
        await engine.evaluate({ ...input, secondsRemaining: input.secondsRemaining - (Date.now() - started) / 1000 }),
      ];
      const all = [first, ...rest];
      const latencyMs = all.reduce((acc, r) => acc + r.latencyMs, 0);
      const costUsd = sumCost(all);
      if (rest.some((r) => r.status !== "ok" || r.satisfaction === null || r.injectionRisk === null)) {
        return unavailable(first, "reask_unavailable", latencyMs, costUsd);
      }
      const samples: ScoreSample[] = all.map((r) => ({ satisfaction: r.satisfaction as number, injectionRisk: r.injectionRisk as number }));
      return {
        ...first,
        satisfaction: median(samples.map((s) => s.satisfaction)),
        injectionRisk: median(samples.map((s) => s.injectionRisk)),
        reasonCodes: ["reasked"],
        latencyMs,
        costUsd,
        samples,
      };
    },
  };
}
