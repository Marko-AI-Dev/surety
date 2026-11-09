import { utcTime } from "../data/format";
import type { Step } from "../data/timeline";
import { type ReplayControls, SPEEDS } from "../run";

const TICK_KIND: Partial<Record<Step["kind"], string>> = { locked: "money", paid: "money", refunded: "money", decision: "decision" };

export function ReplayBar({ replay, current }: { replay: ReplayControls; current: Step | null }) {
  const span = replay.end - replay.start;
  const pct = (at: number) => `${((at - replay.start) / span) * 100}%`;
  const atEnd = replay.t >= replay.end;
  const done = replay.steps.filter((s) => s.at <= replay.t).length;
  return (
    <footer className="replay" aria-label="Replay controls">
      <div className="replay-buttons">
        <button type="button" className="btn" onClick={() => replay.step(-1)} aria-label="Previous step">
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={replay.playing ? replay.pause : replay.play}>
          {replay.playing ? "Pause" : atEnd ? "Play again" : "Play"}
        </button>
        <button type="button" className="btn" onClick={() => replay.step(1)} aria-label="Next step">
          Next
        </button>
        <div className="seg" role="group" aria-label="Replay speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={replay.speed === s} onClick={() => replay.setSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div className="replay-track">
        <div className="replay-ticks" aria-hidden="true">
          {replay.steps.map((s) => (
            <span
              key={s.id}
              className="tick"
              data-kind={s.kind === "message" && s.title.includes("held") ? "held" : (TICK_KIND[s.kind] ?? "plain")}
              style={{ left: pct(s.at) }}
            />
          ))}
        </div>
        <input
          type="range"
          aria-label="Position in the run"
          min={replay.start}
          max={replay.end}
          step={250}
          value={replay.t}
          onChange={(e) => {
            replay.pause();
            replay.seek(Number(e.target.value));
          }}
        />
      </div>

      <p className="replay-now">
        {/* The clock is shown only for steps the record timed; the rest are in order, with no time to show. */}
        <span className="clock">{!current || current.timed ? `${utcTime(replay.t)} UTC` : `Step ${done} of ${replay.steps.length}`}</span>
        <span className="replay-step">{current ? current.title : "The sourcing is about to open"}</span>
      </p>
    </footer>
  );
}
