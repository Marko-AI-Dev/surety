export interface SweepLoop {
  stop(): Promise<void>;
}

export interface SweepLoopOptions {
  // One pass of work: the expiry sweep, or the whole job engine. Its result is not used here.
  sweep: () => Promise<unknown>;
  intervalMs: number;
  log: (line: string) => void;
}

// Sweeps immediately, then again intervalMs after each sweep finishes, so two sweeps from this
// process never overlap. A failed sweep is logged and the loop carries on.
export function startSweepLoop(opts: SweepLoopOptions): SweepLoop {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = () => {
    timer = undefined;
    inFlight = opts
      .sweep()
      .then(
        () => undefined,
        (e: unknown) => opts.log(`sweep error: ${e instanceof Error ? e.message : String(e)}`),
      )
      .then(() => {
        if (!stopped) timer = setTimeout(tick, opts.intervalMs);
      });
  };

  timer = setTimeout(tick, 0);

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}
