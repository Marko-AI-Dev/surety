import { describe, expect, it } from "vitest";
import { proxyDecision } from "../src/data/proxy-policy";

const ID = "fb7d0b49-1432-40a9-9ee9-dc81d1e7c9a1";
const from = (remoteAddress: string | undefined, path: string, method = "GET", headers: Record<string, unknown> = {}) =>
  proxyDecision({ method, path, remoteAddress, headers: { host: "localhost:5173", ...headers } });

describe("the dev proxy's view token", () => {
  it("serves the operator's read routes to this machine's own browser", () => {
    for (const path of ["/api/sourcing", `/api/sourcing/${ID}`, `/api/sourcing/${ID}/record`, `/api/deals/${ID}`, "/api/operator/quarantine"]) {
      expect(from("127.0.0.1", path)).toBe("inject");
      expect(from("::1", path)).toBe("inject");
      expect(from("::ffff:127.0.0.1", `${path}?x=1`)).toBe("inject");
    }
  });

  it("never serves a phone on the network: the record holds the maximum and every held message", () => {
    for (const address of ["192.168.1.23", "10.0.0.7", "::ffff:192.168.1.23", "fe80::1", undefined]) {
      expect(from(address, `/api/sourcing/${ID}/record`)).toBe("refuse");
      expect(from(address, "/api/operator/quarantine")).toBe("refuse");
      expect(from(address, "/api/sourcing")).toBe("refuse");
    }
  });

  it("is not fooled by a caller that brings its own Authorization header to an operator route", () => {
    expect(from("192.168.1.23", `/api/sourcing/${ID}/record`, "GET", { authorization: "Bearer anything" })).toBe("refuse");
  });

  it("refuses a request that arrived through a tunnel or another proxy, even from loopback", () => {
    for (const h of ["x-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip"]) {
      expect(from("127.0.0.1", `/api/sourcing/${ID}/record`, "GET", { [h]: "203.0.113.9" })).toBe("refuse");
    }
  });

  it("gives no token to a request aimed here under another host name (DNS rebinding)", () => {
    for (const host of ["evil.example:5173", "192.168.1.23:5173", "localhost.evil.example", ""]) {
      expect(from("127.0.0.1", `/api/sourcing/${ID}/record`, "GET", { host })).toBe("refuse");
    }
    expect(from("127.0.0.1", `/api/sourcing/${ID}/record`, "GET", { host: "127.0.0.1:5173" })).toBe("inject");
    expect(from("::1", `/api/sourcing/${ID}/record`, "GET", { host: "[::1]:5173" })).toBe("inject");
  });

  it("is read-only and limited to the listed routes", () => {
    expect(from("127.0.0.1", "/api/sourcing", "POST")).toBe("refuse");
    expect(from("127.0.0.1", `/api/deals/${ID}/decision`, "POST")).toBe("refuse");
    expect(from("127.0.0.1", `/api/sourcing/${ID}/inbox`)).toBe("refuse");
    expect(from("127.0.0.1", "/api/suppliers")).toBe("refuse");
    expect(from("127.0.0.1", "/api/sourcing/../operator/quarantine")).toBe("refuse");
  });

  it("passes supplier routes through with the supplier's own token, from anywhere, and never adds the view token", () => {
    expect(from("192.168.1.23", "/api/supplier/sourcing")).toBe("pass");
    expect(from("192.168.1.23", `/api/supplier/sourcing/${ID}/messages`, "POST")).toBe("pass");
    expect(from("127.0.0.1", `/api/supplier/deals/${ID}/settlement`)).toBe("pass");
    expect(from("192.168.1.23", "/api/supplierx/sourcing")).toBe("refuse");
    expect(from("192.168.1.23", "/api/health")).toBe("pass");
  });
});
