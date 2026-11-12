import { describe, expect, it } from "vitest";
import { dragTarget, flatReason } from "../src/views/Spatial";

describe("flat mode", () => {
  it("is off on a wide screen with motion allowed", () => {
    expect(flatReason({ user: false, reducedMotion: false, narrow: false })).toBeNull();
  });

  it("is on for reduced motion, a narrow screen or the Flat button, and says which", () => {
    expect(flatReason({ user: false, reducedMotion: true, narrow: false })).toBe("motion");
    expect(flatReason({ user: false, reducedMotion: false, narrow: true })).toBe("narrow");
    expect(flatReason({ user: true, reducedMotion: false, narrow: false })).toBe("user");
  });

  it("reduced motion outranks a narrow screen, so a phone that asks for it also gets solid panels", () => {
    expect(flatReason({ user: false, reducedMotion: true, narrow: true })).toBe("motion");
  });
});

describe("dragging along the arc", () => {
  const W = 1000;
  it("a short, slow drag stays on the same pane", () => {
    expect(dragTarget(1, 3, -120, W, 900)).toBe(1);
    expect(dragTarget(1, 3, 30, W, 100)).toBe(1);
  });

  it("a drag of a fifth of the stage moves one pane, in the direction of the hand", () => {
    expect(dragTarget(1, 3, -210, W, 900)).toBe(2);
    expect(dragTarget(1, 3, 210, W, 900)).toBe(0);
  });

  it("a quick flick moves one pane even when it is short", () => {
    expect(dragTarget(1, 3, -60, W, 200)).toBe(2);
    expect(dragTarget(1, 3, 60, W, 200)).toBe(0);
  });

  it("never moves more than one pane and never past either end", () => {
    expect(dragTarget(0, 3, -900, W, 900)).toBe(1);
    expect(dragTarget(0, 3, 900, W, 900)).toBe(0);
    expect(dragTarget(2, 3, -900, W, 900)).toBe(2);
  });
});
