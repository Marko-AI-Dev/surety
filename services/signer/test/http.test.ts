import { type AddressInfo, connect } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SIG_HEADER, TS_HEADER, signRequest } from "@surety/contracts";
import { createOperatorClient, createSignerClient } from "@surety/signer-client";
import { createHttpServer } from "../src/http";
import { SignerError } from "../src/errors";
import type { Signer } from "../src/signer";

const SECRET = "h".repeat(40);
const BUYER = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const SELLER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

let server: Server;
let url: string;
let behaviour: Partial<Signer>;

const stub: Signer = {
  health: async () => behaviour.health?.() ?? { network: "testnet", buyer: BUYER, service: SELLER },
  createEscrow: async (req) => {
    if (!behaviour.createEscrow) throw new Error("not stubbed");
    return behaviour.createEscrow(req);
  },
  finishEscrow: async () => {
    throw new Error("not stubbed");
  },
  cancelEscrow: async () => {
    throw new Error("not stubbed");
  },
  updatePolicy: async (req) => {
    if (!behaviour.updatePolicy) throw new Error("not stubbed");
    return behaviour.updatePolicy(req);
  },
};

async function signedFetch(method: string, path: string, body: string, opts: { ts?: string; secret?: string } = {}) {
  const ts = opts.ts ?? String(Date.now());
  return fetch(url + path, {
    method,
    headers: {
      "content-type": "application/json",
      [TS_HEADER]: ts,
      [SIG_HEADER]: signRequest(opts.secret ?? SECRET, ts, method, path, body),
    },
    body: method === "GET" ? undefined : body,
  });
}

function createBody() {
  return { opId: randomUUID(), jobRef: "job-A", destination: SELLER, amountDrops: "1000000", cancelAfterSeconds: 180 };
}

beforeEach(async () => {
  behaviour = {};
  server = createHttpServer(stub, { hmacSecret: SECRET });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("signer http boundary", () => {
  it("serves an authenticated health check through the signer client", async () => {
    const client = createSignerClient({ url, hmacSecret: SECRET });
    expect(await client.health()).toEqual({ network: "testnet", buyer: BUYER, service: SELLER });
  });

  it("rejects requests without a signature, with a wrong one, or with a stale timestamp", async () => {
    const body = JSON.stringify(createBody());
    const unsigned = await fetch(`${url}/escrows/create`, { method: "POST", body });
    expect(unsigned.status).toBe(401);
    expect((await signedFetch("POST", "/escrows/create", body, { secret: "w".repeat(40) })).status).toBe(401);
    const stale = String(Date.now() - 31_000);
    expect((await signedFetch("POST", "/escrows/create", body, { ts: stale })).status).toBe(401);
  });

  it.each(["/sign", "/submit", "/escrows/sign", "/wallet"])("has no %s endpoint", async (path) => {
    const res = await signedFetch("POST", path, JSON.stringify({ tx_json: { TransactionType: "Payment" } }));
    expect(res.status).toBe(404);
  });

  it("refuses bodies over 16 KB", async () => {
    const res = await signedFetch("POST", "/escrows/create", JSON.stringify({ pad: "x".repeat(17_000) }));
    expect(res.status).toBe(400);
  });

  it("answers invalid JSON with 400 and keeps serving", async () => {
    expect((await signedFetch("POST", "/escrows/create", "{not json")).status).toBe(400);
    expect((await signedFetch("GET", "/health", "")).status).toBe(200);
  });

  it.each(["//[", "//%", "http://["])(
    "survives the unparseable request target %s and keeps serving",
    async (target) => {
      const port = (server.address() as AddressInfo).port;
      const reply = await new Promise<string>((resolve) => {
        let data = "";
        const socket = connect(port, "127.0.0.1", () =>
          socket.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
        );
        socket.on("data", (d) => (data += d));
        socket.on("close", () => resolve(data));
        socket.on("error", () => resolve(data));
      });
      expect(reply).toMatch(/^HTTP\/1\.1 400/);
      expect((await signedFetch("GET", "/health", "")).status).toBe(200);
    },
  );

  it("maps a SignerError to its status and code through the client", async () => {
    behaviour.createEscrow = async () => {
      throw new SignerError("amount_over_cap", "amount exceeds the per-job cap of 2000000 drops");
    };
    const client = createSignerClient({ url, hmacSecret: SECRET });
    await expect(client.createEscrow(createBody())).rejects.toMatchObject({ status: 403, code: "amount_over_cap" });
  });

  it("hides the detail of unexpected errors", async () => {
    behaviour.createEscrow = async () => {
      throw new Error("boom near Fulfillment A0228020FF and seed sEdSECRET and PREIMAGE_KEY");
    };
    const res = await signedFetch("POST", "/escrows/create", JSON.stringify(createBody()));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/fulfil|seed|preimage/i);
    expect(JSON.parse(text)).toEqual({ error: "internal_error", message: "internal error" });
  });
});

describe("operator policy route", () => {
  const OPERATOR = "o".repeat(40);
  const view = {
    version: 2,
    perDealCents: "100000",
    dailyCents: "2500000",
    maxOpenDeals: 5,
    approvedSuppliers: [SELLER],
    updatedAt: "2026-11-09T12:00:00.000Z",
  };
  const policyBody = () => ({
    opId: randomUUID(),
    expectedVersion: 1,
    perDealCents: "100000",
    dailyCents: "2500000",
    maxOpenDeals: 5,
    approvedSuppliers: [SELLER],
  });

  let operatorServer: Server;
  let operatorUrl: string;

  beforeEach(async () => {
    const testUsd = {
      issuer: BUYER,
      approvedSuppliers: [SELLER],
      maxDealCents: 250_000n,
      dailyCents: 2_500_000n,
      maxOpenDeals: 5,
      operatorSecret: OPERATOR,
    };
    operatorServer = createHttpServer(stub, { hmacSecret: SECRET, testUsd });
    await new Promise<void>((resolve) => operatorServer.listen(0, "127.0.0.1", resolve));
    operatorUrl = `http://127.0.0.1:${(operatorServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => operatorServer.close(() => resolve()));
  });

  async function post(base: string, path: string, body: unknown, secret: string) {
    const text = JSON.stringify(body);
    const ts = String(Date.now());
    return fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", [TS_HEADER]: ts, [SIG_HEADER]: signRequest(secret, ts, "POST", path, text) },
      body: text,
    });
  }

  it("a policy update signed with SIGNER_HMAC_SECRET gets 401", async () => {
    behaviour.updatePolicy = async () => view;
    const res = await post(operatorUrl, "/operator/policy", policyBody(), SECRET);
    expect(res.status).toBe(401);
  });

  it("a create signed with OPERATOR_HMAC_SECRET gets 401", async () => {
    behaviour.createEscrow = async () => {
      throw new Error("must not be reached");
    };
    const res = await post(operatorUrl, "/escrows/create", createBody(), OPERATOR);
    expect(res.status).toBe(401);
  });

  it("a policy update signed with OPERATOR_HMAC_SECRET reaches the signer", async () => {
    let seen: unknown;
    behaviour.updatePolicy = async (req) => {
      seen = req;
      return view;
    };
    const body = policyBody();
    const client = createOperatorClient({ url: operatorUrl, operatorSecret: OPERATOR });
    expect(await client.updatePolicy(body)).toEqual(view);
    expect(seen).toEqual(body);
  });

  it("the operator client surfaces a refusal code", async () => {
    behaviour.updatePolicy = async () => {
      throw new SignerError("policy_conflict", "the policy is at version 3");
    };
    const client = createOperatorClient({ url: operatorUrl, operatorSecret: OPERATOR });
    await expect(client.updatePolicy(policyBody())).rejects.toMatchObject({ status: 409, code: "policy_conflict" });
  });

  it("without TESTUSD the policy route does not exist", async () => {
    const res = await post(url, "/operator/policy", policyBody(), SECRET);
    expect(res.status).toBe(404);
  });
});
