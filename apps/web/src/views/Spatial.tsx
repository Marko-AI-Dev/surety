import { createPortal } from "react-dom";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

// The spatial shell: large glass panes on a gentle arc. One pane faces you; its neighbours sit to
// the sides, angled away and further back. Bring one forward by clicking it, with the arrow keys, the
// tabs above, or by dragging or swiping across the stage. The pane in front tilts a little toward the
// pointer. Motion is slow and never overshoots.
//
// Flat mode turns all of that off: no perspective, no tilt, no drag, every pane laid out in the page
// and usable at once. It is on when the visitor prefers reduced motion, on a narrow screen, or when
// the operator presses "Flat" in the bar.

export type FlatReason = "user" | "motion" | "narrow" | null;

const NARROW = "(max-width: 900px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

export function flatReason(input: { user: boolean; reducedMotion: boolean; narrow: boolean }): FlatReason {
  return input.user ? "user" : input.reducedMotion ? "motion" : input.narrow ? "narrow" : null;
}

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const read = () => setOn(m.matches);
    read();
    m.addEventListener("change", read);
    return () => m.removeEventListener("change", read);
  }, [query]);
  return on;
}

export function useFlat(user: boolean): FlatReason {
  return flatReason({ user, reducedMotion: useMedia(REDUCED), narrow: useMedia(NARROW) });
}

// Which pane a drag ends on: a drag of a fifth of the stage, or a quick flick, moves one pane.
export function dragTarget(focus: number, count: number, dx: number, width: number, ms: number): number {
  const far = Math.abs(dx) > width * 0.2;
  const flick = Math.abs(dx) > 40 && ms < 350;
  if (!far && !flick) return focus;
  return Math.min(count - 1, Math.max(0, focus + (dx < 0 ? 1 : -1)));
}

export interface PaneSpec {
  id: string;
  title: string;
  note?: ReactNode;
  tools?: ReactNode;
  body: ReactNode;
}

const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='button'], [contenteditable='true']";
const TYPING = "input, select, textarea, [contenteditable='true']";
const DRAG_START_PX = 10;

export function Arc({ panes, initial = 0, flat, label }: { panes: PaneSpec[]; initial?: number; flat: boolean; label: string }) {
  const [focus, setFocus] = useState(Math.min(initial, panes.length - 1));
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; t: number; live: boolean } | null>(null);
  const frame = useRef(0);
  const go = useCallback((i: number) => setFocus(Math.min(panes.length - 1, Math.max(0, i))), [panes.length]);

  // Arrow keys move along the arc from anywhere on the page, except while typing or on a slider.
  useEffect(() => {
    if (flat) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(TYPING)) return;
      if (document.querySelector(".detail")) return;
      if (e.key === "ArrowLeft") setFocus((f) => Math.max(0, f - 1));
      else if (e.key === "ArrowRight") setFocus((f) => Math.min(panes.length - 1, f + 1));
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [flat, panes.length]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const setVar = (name: string, value: string) => stage.current?.style.setProperty(name, value);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (flat || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    drag.current = { id: e.pointerId, x: e.clientX, t: performance.now(), live: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (flat || !el) return;
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.x;
      if (!d.live && Math.abs(dx) > DRAG_START_PX) {
        d.live = true;
        setDragging(true);
        el.setPointerCapture(e.pointerId);
        getSelection()?.removeAllRanges();
      }
      if (d.live) {
        // The panes follow the finger: a full stage width is one pane. The ends resist.
        let shift = -dx / (el.clientWidth * 0.8);
        const target = focus + shift;
        if (target < 0) shift = -focus + target * 0.25;
        if (target > panes.length - 1) shift = panes.length - 1 - focus + (target - (panes.length - 1)) * 0.25;
        setVar("--shift", shift.toFixed(4));
      }
      return;
    }
    if (e.pointerType !== "mouse") return;
    // Tilt: the front pane leans a degree or two toward the pointer.
    const x = e.clientX;
    const y = e.clientY;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, ((x - r.left) / r.width) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((y - r.top) / Math.min(r.height, innerHeight)) * 2 - 1));
      setVar("--ty", `${(nx * 1.6).toFixed(2)}deg`);
      setVar("--tx", `${(-ny * 1.1).toFixed(2)}deg`);
    });
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.live) return;
    const el = stage.current;
    setVar("--shift", "0");
    setDragging(false);
    if (el) setFocus((f) => dragTarget(f, panes.length, e.clientX - d.x, el.clientWidth, performance.now() - d.t));
  };
  const resetTilt = () => {
    cancelAnimationFrame(frame.current);
    setVar("--tx", "0deg");
    setVar("--ty", "0deg");
  };

  return (
    <div className="arc" data-flat={flat}>
      {flat ? null : (
        <div className="arc-tabs" role="tablist" aria-label={label}>
          {panes.map((p, i) => (
            <button key={p.id} type="button" role="tab" id={`tab-${p.id}`} aria-selected={i === focus} aria-controls={`pane-${p.id}`} tabIndex={i === focus ? 0 : -1} onClick={() => go(i)}>
              {p.title}
            </button>
          ))}
        </div>
      )}
      <div
        className="arc-stage"
        ref={stage}
        data-dragging={dragging}
        style={{ "--f": focus } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={resetTilt}
      >
        {panes.map((p, i) => {
          const front = flat || i === focus;
          const pos = flat ? "flat" : i === focus ? "0" : Math.abs(i - focus) === 1 ? "near" : "far";
          return (
            <section
              key={p.id}
              id={`pane-${p.id}`}
              className="pane glass"
              role={flat ? undefined : "tabpanel"}
              aria-labelledby={flat ? undefined : `tab-${p.id}`}
              aria-label={flat ? p.title : undefined}
              data-pos={pos}
              data-pane={p.id}
              data-side={flat || i === focus ? undefined : i < focus ? "left" : "right"}
              style={{ "--i": i } as CSSProperties}
              onClick={front || dragging ? undefined : () => go(i)}
            >
              {/* A pane that is not in front is a picture of itself: nothing in it takes focus or clicks. */}
              <div className="pane-inner" inert={!front}>
                <header className="pane-head">
                  <div>
                    <h2>{p.title}</h2>
                    {p.note ? <p className="panel-note">{p.note}</p> : null}
                  </div>
                  {p.tools}
                </header>
                {p.body}
              </div>
              {front ? null : <span className="pane-fwd">Bring forward</span>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// The detail layer: what you picked comes forward over the stage. Escape, the close button or a click
// outside sends it back, and focus returns to where it was.
export function Detail({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  // The page re-renders many times a second while a run plays; the layer must open and take focus once.
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current();
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);
  // On the body, not inside the page: the page behind settles back, and this must not move with it.
  return createPortal(
    <div className="detail" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <section className="detail-card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="detail-head">
          <h2>{title}</h2>
          <button type="button" className="btn" ref={close} onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
