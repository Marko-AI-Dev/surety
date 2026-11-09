import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordedRun } from "./data/evidence";
import { ApiError, createLiveSource } from "./data/live";
import { type RunView, type Step, buildTimeline, timelineBounds, viewAt } from "./data/timeline";
import type { SourcingRecord } from "./data/types";

export type Mode = "replay" | "live";
export const SPEEDS = [1, 4, 16] as const;

export interface ReplayControls {
  t: number;
  start: number;
  end: number;
  playing: boolean;
  speed: number;
  steps: Step[];
  play(): void;
  pause(): void;
  seek(t: number): void;
  step(direction: 1 | -1): void;
  setSpeed(s: number): void;
  restart(): void;
}

export interface Run {
  mode: Mode;
  record: SourcingRecord | null;
  view: RunView | null;
  steps: Step[];
  replay: ReplayControls | null;
  live: { status: "connecting" | "ok" | "error"; message: string | null; updatedAt: number | null } | null;
}

const TICK_MS = 100;

function useReplay(active: boolean): { record: SourcingRecord; steps: Step[]; controls: ReplayControls } {
  const steps = useMemo(() => buildTimeline(recordedRun), []);
  const { start, end } = useMemo(() => timelineBounds(steps), [steps]);
  const [t, setT] = useState(start);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(4);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !playing) {
      last.current = null;
      return;
    }
    const id = setInterval(() => {
      const now = performance.now();
      const dt = last.current === null ? TICK_MS : now - last.current;
      last.current = now;
      setT((cur) => {
        const next = Math.min(end, cur + dt * speed);
        if (next >= end) setPlaying(false);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [active, playing, speed, end]);

  const seek = useCallback((to: number) => setT(Math.max(start, Math.min(end, to))), [start, end]);
  const step = useCallback(
    (direction: 1 | -1) => {
      setPlaying(false);
      setT((cur) => {
        if (direction === 1) return steps.find((s) => s.at > cur)?.at ?? end;
        const before = steps.filter((s) => s.at < cur);
        return before[before.length - 1]?.at ?? start;
      });
    },
    [steps, start, end],
  );
  const play = useCallback(() => {
    setT((cur) => (cur >= end ? start : cur));
    setPlaying(true);
  }, [start, end]);

  return {
    record: recordedRun,
    steps,
    controls: {
      t,
      start,
      end,
      playing,
      speed,
      steps,
      play,
      pause: () => setPlaying(false),
      seek,
      step,
      setSpeed,
      restart: () => {
        setT(start);
        setPlaying(true);
      },
    },
  };
}

function useLive(active: boolean) {
  const [record, setRecord] = useState<SourcingRecord | null>(null);
  const [state, setState] = useState<NonNullable<Run["live"]>>({ status: "connecting", message: null, updatedAt: null });
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const source = createLiveSource((url, init) => fetch(url, init));
    const poll = async () => {
      try {
        const next = await source.latest();
        if (stopped) return;
        setRecord(next);
        setState({ status: "ok", message: next ? null : "No sourcing has been opened yet.", updatedAt: Date.now() });
      } catch (e) {
        if (stopped) return;
        const message = e instanceof ApiError ? `${e.message} (${e.code})` : "The Surety API is not reachable.";
        setState((s) => ({ status: "error", message, updatedAt: s.updatedAt }));
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active]);
  return { record, state };
}

export function useRun(mode: Mode): Run {
  const replay = useReplay(mode === "replay");
  const live = useLive(mode === "live");
  const liveSteps = useMemo(() => (live.record ? buildTimeline(live.record) : []), [live.record]);

  if (mode === "replay") {
    return {
      mode,
      record: replay.record,
      steps: replay.steps,
      view: viewAt(replay.record, replay.steps, replay.controls.t),
      replay: replay.controls,
      live: null,
    };
  }
  return {
    mode,
    record: live.record,
    steps: liveSteps,
    view: live.record ? viewAt(live.record, liveSteps, Number.POSITIVE_INFINITY) : null,
    replay: null,
    live: live.state,
  };
}

// A number that eases to its new value, so a balance visibly moves when money does.
export function useTween(target: number, ms = 700): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const began = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const p = Math.min(1, (now - began) / ms);
      const eased = 1 - (1 - p) ** 3;
      const value = Math.round(start + (target - start) * eased);
      from.current = value;
      setShown(value);
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}
