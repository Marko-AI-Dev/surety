import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RECORDINGS, recordingOf } from "./data/evidence";
import { ApiError, createLiveSource, createSimSource } from "./data/live";
import { type RunView, type Step, buildTimeline, timelineBounds, viewAt } from "./data/timeline";
import type { SourcingListItem, SourcingRecord } from "./data/types";

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
  live: { status: "connecting" | "ok" | "error"; message: string | null; updatedAt: number | null; simulated: boolean; everConnected: boolean } | null;
  // Every purchase the backend knows, newest first. Empty on a recording.
  purchases: SourcingListItem[];
}

const TICK_MS = 100;

function useReplay(active: boolean, recorded: SourcingRecord): { record: SourcingRecord; steps: Step[]; controls: ReplayControls } {
  const steps = useMemo(() => buildTimeline(recorded), [recorded]);
  const { start, end } = useMemo(() => timelineBounds(steps), [steps]);
  const [t, setT] = useState(start);
  const [playing, setPlaying] = useState(true);
  // Another recording starts from its own beginning.
  useEffect(() => {
    setT(start);
    setPlaying(true);
  }, [start]);
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
    record: recorded,
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

// `sim` is a speed for the simulated feed (a recorded run through the live path), or null for the
// real API. The simulated feed is for testing and is always badged.
// `picked` is the id of an earlier purchase to show; null shows the newest.
function useLive(active: boolean, sim: number | null, picked: string | null) {
  const [record, setRecord] = useState<SourcingRecord | null>(null);
  const [purchases, setPurchases] = useState<SourcingListItem[]>([]);
  const [asOf, setAsOf] = useState<number>(() => Date.now());
  const [state, setState] = useState<NonNullable<Run["live"]>>({ status: "connecting", message: null, updatedAt: null, simulated: sim !== null, everConnected: false });
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const source = sim !== null ? createSimSource((RECORDINGS[0] as (typeof RECORDINGS)[number]).record, { speed: sim }) : createLiveSource((url, init) => fetch(url, init));
    const poll = async () => {
      try {
        const listed = await source.list();
        // A picked purchase that is not in the list (a stale link) falls back to the newest.
        const id = picked && listed.some((p) => p.id === picked) ? picked : listed[0]?.id;
        const next = id ? await source.record(id) : null;
        if (stopped) return;
        setPurchases(listed);
        setRecord(next);
        setAsOf(source.now());
        setState({ status: "ok", message: next ? null : "No purchase has been started yet.", updatedAt: Date.now(), simulated: source.simulated, everConnected: true });
      } catch (e) {
        if (stopped) return;
        const message = e instanceof ApiError ? `${e.message} (${e.code})` : "The Surety API is not reachable.";
        setState((s) => ({ ...s, status: "error", message }));
      }
    };
    void poll();
    const id = setInterval(() => void poll(), sim !== null ? 1000 : 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, sim, picked]);
  return { record, state, asOf, purchases };
}

export function useRun(mode: Mode, sim: number | null = null, recording = "paid", picked: string | null = null): Run {
  const replay = useReplay(mode === "replay", recordingOf(recording).record);
  const live = useLive(mode === "live", sim, picked);
  const liveSteps = useMemo(() => (live.record ? buildTimeline(live.record, { now: live.asOf }) : []), [live.record, live.asOf]);

  if (mode === "replay") {
    return {
      mode,
      record: replay.record,
      steps: replay.steps,
      view: viewAt(replay.record, replay.steps, replay.controls.t),
      replay: replay.controls,
      live: null,
      purchases: [],
    };
  }
  return {
    mode,
    record: live.record,
    steps: liveSteps,
    view: live.record ? viewAt(live.record, liveSteps, Number.POSITIVE_INFINITY) : null,
    replay: null,
    live: live.state,
    purchases: live.purchases,
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
