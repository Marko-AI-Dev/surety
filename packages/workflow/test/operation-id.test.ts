import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { operationId } from "../src/index";

const JOB = "6f1c2a7e-0b8e-4c55-9d2a-3e4f5a6b7c8d";

describe("operationId", () => {
  it("is stable across calls for the same job, operation and attempt", () => {
    expect(operationId(JOB, "cancel")).toBe(operationId(JOB, "cancel"));
    expect(operationId(JOB, "cancel", 0)).toBe(operationId(JOB, "cancel"));
  });

  it("differs by job, operation and attempt", () => {
    const ids = new Set([
      operationId(JOB, "create"),
      operationId(JOB, "finish"),
      operationId(JOB, "cancel"),
      operationId(JOB, "cancel", 1),
      operationId("0d9b7c1e-2f3a-4b5c-8d6e-7f8091a2b3c4", "cancel"),
    ]);
    expect(ids.size).toBe(5);
  });

  it("is a lowercase version 5 UUID that the signer's schema accepts", () => {
    const id = operationId(JOB, "create");
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is derived from sha256 of surety:<job>:<op>:<attempt>", () => {
    const digest = createHash("sha256").update(`surety:${JOB}:finish:2`).digest("hex");
    const id = operationId(JOB, "finish", 2).replaceAll("-", "");
    // Everything but the version nibble (index 12) and the top two variant bits (index 16) is the digest.
    expect(id.slice(0, 12)).toBe(digest.slice(0, 12));
    expect(id.slice(13, 16)).toBe(digest.slice(13, 16));
    expect(id.slice(17, 32)).toBe(digest.slice(17, 32));
    expect(Number.parseInt(id[16] ?? "", 16) & 0x3).toBe(Number.parseInt(digest[16] ?? "", 16) & 0x3);
  });
});
