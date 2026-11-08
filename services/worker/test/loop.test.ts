import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SweepReport } from "@surety/workflow";
import { startSweepLoop } from "../src/loop";

const EMPTY: SweepReport = { closeTime: 1, refunded: [], pending: [], reconciliation: [] };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startSweepLoop", () => {
  it("sweeps once immediately on start, then every interval", async () => {
    const sweep = vi.fn(async () => EMPTY);
    const loop = startSweepLoop({ sweep, intervalMs: 5_000, log: () => {} });

    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweep).toHaveBeenCalledTimes(4);
    await loop.stop();
  });

  it("never overlaps sweeps: the next starts an interval after the previous one finished", async () => {
    let running = 0;
    let maxRunning = 0;
    const sweep = vi.fn(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 12_000)); // slower than the interval
      running -= 1;
      return EMPTY;
    });
    const loop = startSweepLoop({ sweep, intervalMs: 5_000, log: () => {} });

    await vi.advanceTimersByTimeAsync(16_999);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
    await vi.advanceTimersByTimeAsync(12_000);
    await loop.stop();
  });

  it("logs a failed sweep and keeps sweeping", async () => {
    const lines: string[] = [];
    const sweep = vi.fn().mockRejectedValueOnce(new Error("ledger unreachable")).mockResolvedValue(EMPTY);
    const loop = startSweepLoop({ sweep, intervalMs: 1_000, log: (l) => lines.push(l) });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(lines).toEqual(["sweep error: ledger unreachable"]);
    expect(sweep).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it("stop waits for the sweep in flight and prevents any further sweep", async () => {
    let finished = false;
    const sweep = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 3_000));
      finished = true;
      return EMPTY;
    });
    const loop = startSweepLoop({ sweep, intervalMs: 1_000, log: () => {} });
    await vi.advanceTimersByTimeAsync(0);

    const stopped = loop.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    await stopped;

    expect(finished).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
