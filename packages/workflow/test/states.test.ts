import { describe, expect, it } from "vitest";
import {
  CANCELLABLE_STATES,
  JOB_STATES,
  type JobState,
  TERMINAL_STATES,
  TransitionError,
  assertTransition,
  canTransition,
} from "../src/index";

// The allowed transitions, written out independently of the implementation.
const ALLOWED: [JobState, JobState[]][] = [
  ["DRAFT", ["CREATE_PENDING"]],
  ["CREATE_PENDING", ["LOCKED", "CREATE_FAILED", "RECONCILIATION_REQUIRED"]],
  ["LOCKED", ["IN_PROGRESS", "EXPIRED_AWAITING_CANCEL"]],
  ["IN_PROGRESS", ["DELIVERED", "EXPIRED_AWAITING_CANCEL"]],
  ["DELIVERED", ["EVALUATING", "EXPIRED_AWAITING_CANCEL"]],
  ["EVALUATING", ["APPROVED", "REJECTED_AWAITING_EXPIRY", "REVIEW_REQUIRED", "EXPIRED_AWAITING_CANCEL"]],
  ["APPROVED", ["FINISH_PENDING", "EXPIRED_AWAITING_CANCEL"]],
  ["FINISH_PENDING", ["PAID", "RECONCILIATION_REQUIRED", "EXPIRED_AWAITING_CANCEL"]],
  ["REJECTED_AWAITING_EXPIRY", ["EXPIRED_AWAITING_CANCEL"]],
  ["REVIEW_REQUIRED", ["EXPIRED_AWAITING_CANCEL"]],
  ["EXPIRED_AWAITING_CANCEL", ["CANCEL_PENDING"]],
  ["CANCEL_PENDING", ["REFUNDED", "RECONCILIATION_REQUIRED"]],
];
const allowed = new Set(ALLOWED.flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`)));

describe("job states", () => {
  it("are the 16 states in lifecycle order", () => {
    expect(JOB_STATES).toEqual([
      "DRAFT",
      "CREATE_PENDING",
      "LOCKED",
      "IN_PROGRESS",
      "DELIVERED",
      "EVALUATING",
      "APPROVED",
      "FINISH_PENDING",
      "PAID",
      "REJECTED_AWAITING_EXPIRY",
      "REVIEW_REQUIRED",
      "EXPIRED_AWAITING_CANCEL",
      "CANCEL_PENDING",
      "REFUNDED",
      "CREATE_FAILED",
      "RECONCILIATION_REQUIRED",
    ]);
  });

  it("treats PAID, REFUNDED and CREATE_FAILED as terminal", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["CREATE_FAILED", "PAID", "REFUNDED"]);
  });

  it("can cancel every funded, unsettled state except one frozen for reconciliation", () => {
    expect([...CANCELLABLE_STATES].sort()).toEqual(
      [
        "LOCKED",
        "IN_PROGRESS",
        "DELIVERED",
        "EVALUATING",
        "APPROVED",
        "FINISH_PENDING",
        "REJECTED_AWAITING_EXPIRY",
        "REVIEW_REQUIRED",
        "EXPIRED_AWAITING_CANCEL",
        "CANCEL_PENDING",
      ].sort(),
    );
  });
});

describe("canTransition", () => {
  it.each([...allowed])("allows %s", (pair) => {
    const [from, to] = pair.split("->") as [JobState, JobState];
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["PAID", "REFUNDED"],
    ["REFUNDED", "LOCKED"],
    ["DRAFT", "LOCKED"],
    ["LOCKED", "PAID"],
  ] as [JobState, JobState][])("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("allows exactly the listed transitions and nothing else", () => {
    for (const from of JOB_STATES) {
      for (const to of JOB_STATES) {
        expect(canTransition(from, to), `${from}->${to}`).toBe(allowed.has(`${from}->${to}`));
      }
    }
  });

  it.each([...TERMINAL_STATES, "RECONCILIATION_REQUIRED"] as JobState[])("lets nothing leave %s", (from) => {
    expect(JOB_STATES.filter((to) => canTransition(from, to))).toEqual([]);
  });
});

describe("assertTransition", () => {
  it("passes an allowed transition", () => {
    expect(() => assertTransition("DRAFT", "CREATE_PENDING")).not.toThrow();
  });

  it("throws TransitionError naming both states for a disallowed one", () => {
    let caught: unknown;
    try {
      assertTransition("PAID", "REFUNDED");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TransitionError);
    expect(caught).toMatchObject({ from: "PAID", to: "REFUNDED" });
  });
});
