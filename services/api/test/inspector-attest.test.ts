import { describe, expect, it } from "vitest";
import { apiBase, attestationArgs } from "../scripts/inspector-attest";

const DEAL = "3f1c2a9e-4b7d-4c1a-9e2f-0a1b2c3d4e5f";

describe("the inspector's command line", () => {
  it("reads a deal id, a B/L number, an outcome and an optional note", () => {
    expect(attestationArgs([DEAL, "SZXDUR-55120", "attested", "400 cartons counted,", "seal intact"])).toEqual({
      dealId: DEAL,
      body: { blNumber: "SZXDUR-55120", outcome: "attested", note: "400 cartons counted, seal intact" },
    });
    expect(attestationArgs([DEAL, "SZXDUR-55120", "refused"])).toEqual({ dealId: DEAL, body: { blNumber: "SZXDUR-55120", outcome: "refused", note: "" } });
  });

  it("no arguments means list the queue; anything else malformed is a usage error", () => {
    expect(attestationArgs([])).toBeNull();
    expect(() => attestationArgs([DEAL])).toThrow(/usage/);
    expect(() => attestationArgs(["not-a-uuid", "B", "attested"])).toThrow(/usage/);
    expect(() => attestationArgs([DEAL, "B", "approve"])).toThrow(/usage/);
  });

  it("talks to SURETY_API_URL, else API_HOST and API_PORT, else the local default", () => {
    expect(apiBase({ SURETY_API_URL: "http://10.0.0.5:4200/" })).toBe("http://10.0.0.5:4200");
    expect(apiBase({ API_HOST: "172.19.160.1", API_PORT: "4300" })).toBe("http://172.19.160.1:4300");
    expect(apiBase({})).toBe("http://127.0.0.1:4200");
  });
});
