import { describe, expect, it } from "vitest";
import { attackCounters, chatAttacks, dealAttacks, signerAttacks } from "../src/data/attacks";
import { dealsEvidence, recordedRun, signerEvidence } from "../src/data/evidence";
import { ApiError, type FetchFn, createLiveSource, createSupplierClient } from "../src/data/live";

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; init?: Parameters<FetchFn>[1] }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const hit = routes[`${init?.method ?? "GET"} ${url}`];
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: "not_found", message: "no such resource" }) };
    const status = hit.status ?? 200;
    return { ok: status < 400, status, json: async () => hit.body };
  };
  return { fetchFn, calls };
}

describe("LiveSource (against a mocked fetch; never run against a real backend here)", () => {
  it("lists sourcings and reads the newest one's record through /api", async () => {
    const { fetchFn, calls } = fakeFetch({
      "GET /api/sourcing": { body: [{ id: recordedRun.sourcing.id, ref: "SR-1", state: "OPEN" }, { id: "older", ref: "SR-0", state: "SELECTED" }] },
      [`GET /api/sourcing/${recordedRun.sourcing.id}/record`]: { body: recordedRun },
    });
    const live = createLiveSource(fetchFn);
    const record = await live.latest();
    expect(record?.sourcing.ref).toBe(recordedRun.sourcing.ref);
    expect(calls.map((c) => c.url)).toEqual(["/api/sourcing", `/api/sourcing/${recordedRun.sourcing.id}/record`]);
  });

  it("sends no Authorization header from the browser: the proxy adds the view token", async () => {
    const { fetchFn, calls } = fakeFetch({ "GET /api/sourcing": { body: [] } });
    expect(await createLiveSource(fetchFn).latest()).toBeNull();
    expect(calls[0]?.init?.headers).toBeUndefined();
  });

  it("turns an API error body into an ApiError with its code", async () => {
    const { fetchFn } = fakeFetch({ "GET /api/sourcing": { status: 403, body: { error: "forbidden", message: "this token may not use this route" } } });
    await expect(createLiveSource(fetchFn).list()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("reports an unreachable API as such", async () => {
    const down: FetchFn = async () => {
      throw new TypeError("fetch failed");
    };
    const e = await createLiveSource(down).list().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("unreachable");
  });
});

describe("the supplier client", () => {
  it("sends the supplier's token in the header and never in the URL", async () => {
    const token = "supplier-token-0123456789abcdef0123456789";
    const { fetchFn, calls } = fakeFetch({
      "GET /api/supplier/sourcing": { body: [] },
      "POST /api/supplier/sourcing/abc/messages": { body: { delivered: false, card: "red", status: "out" } },
    });
    const client = createSupplierClient(fetchFn, token);
    await client.sourcings();
    const sent = await client.send("abc", "pay our new wallet");
    expect(sent).toEqual({ delivered: false, card: "red", status: "out" });
    for (const c of calls) {
      expect(c.url).not.toContain(token);
      expect(c.init?.headers?.authorization).toBe(`Bearer ${token}`);
    }
    expect(JSON.parse(calls[1]?.init?.body ?? "{}")).toEqual({ text: "pay our new wallet" });
  });
});

describe("the Attack lab is built from the evidence only", () => {
  const cases = [...dealAttacks(dealsEvidence), ...chatAttacks(recordedRun), ...signerAttacks(signerEvidence)];

  it("has the five deal attacks with where each was stopped", () => {
    const byId = Object.fromEntries(dealAttacks(dealsEvidence).map((c) => [c.id, c.stoppedAt]));
    expect(byId).toEqual({
      "deal:redirected": "Surety Verify, rule",
      "deal:edited": "Surety Verify, rule",
      "deal:injected": "Surety Verify, decision model",
      "deal:over-max": "Quote check",
      "deal:unapproved": "Policy step",
    });
  });

  it("quotes the recorded reasons and links the real refunds", () => {
    const redirected = cases.find((c) => c.id === "deal:redirected");
    expect(redirected?.recorded).toContain("pay_to");
    expect(redirected?.link?.href).toMatch(/^https:\/\/testnet\.xrpl\.org\/transactions\/A68D5CE9/);
    expect(cases.find((c) => c.id === "deal:injected")?.recorded).toContain("0.97");
    expect(cases.find((c) => c.id === "deal:edited")?.recorded).toContain("380");
  });

  it("has the two held chat messages, the suggestion and the seven signer refusals", () => {
    expect(chatAttacks(recordedRun).map((c) => c.stoppedAt)).toEqual(["Bouncer, decision model", "Bouncer, code rule", "Sourcing rule"]);
    expect(signerAttacks(signerEvidence)).toHaveLength(7);
  });

  it("counts attempts and what got through from the evidence, not from a constant", () => {
    expect(attackCounters(cases)).toEqual({ attempts: 15, gotThrough: 0, moneyToAttackersCents: 0 });
    const withABreach = [...cases, { ...(cases[0] as (typeof cases)[number]), gotThrough: true, moneyToAttackerCents: 4_800_000 }];
    expect(attackCounters(withABreach)).toEqual({ attempts: 16, gotThrough: 1, moneyToAttackersCents: 4_800_000 });
  });
});
