import { describe, expect, it } from "vitest";
import { AttestationFormSchema, INSPECTION_STATES } from "../src/index";

const form = { blNumber: "SZXDUR-55120", outcome: "attested", note: "400 cartons counted, seal intact" };

describe("the inspector's attestation form", () => {
  it("an attestation needs a B/L number, an outcome of attested or refused, and a note of at most 280 characters", () => {
    expect(AttestationFormSchema.parse(form)).toEqual(form);
    expect(AttestationFormSchema.parse({ ...form, blNumber: "  SZXDUR-55120 " }).blNumber).toBe("SZXDUR-55120");
    expect(AttestationFormSchema.parse({ ...form, outcome: "refused", note: "" })).toMatchObject({ outcome: "refused", note: "" });
    expect(AttestationFormSchema.safeParse({ ...form, note: "x".repeat(280) }).success).toBe(true);

    expect(AttestationFormSchema.safeParse({ ...form, blNumber: "" }).success).toBe(false);
    expect(AttestationFormSchema.safeParse({ ...form, blNumber: "   " }).success).toBe(false);
    expect(AttestationFormSchema.safeParse({ ...form, blNumber: "B".repeat(121) }).success).toBe(false);
    expect(AttestationFormSchema.safeParse({ ...form, outcome: "approved" }).success).toBe(false);
    expect(AttestationFormSchema.safeParse({ ...form, note: "x".repeat(281) }).success).toBe(false);
    expect(AttestationFormSchema.safeParse({ blNumber: "SZXDUR-55120", outcome: "attested" }).success).toBe(false);
  });

  it("unknown keys are refused", () => {
    expect(AttestationFormSchema.safeParse({ ...form, inspector: "Someone else" }).success).toBe(false);
    expect(AttestationFormSchema.safeParse({ ...form, dealId: "x" }).success).toBe(false);
  });

  it("an inspection is pending, attested or refused, the states the web app reads", () => {
    expect([...INSPECTION_STATES]).toEqual(["pending", "attested", "refused"]);
  });
});
