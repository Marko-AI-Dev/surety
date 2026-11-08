import type { Client } from "xrpl";
import { describe, expect, it, vi } from "vitest";
import { ledgerClock } from "../src/ledger-clock";

function stubClient(opts: { connected: boolean; connectFails?: boolean; closeTime?: number }) {
  let connected = opts.connected;
  const client = {
    isConnected: () => connected,
    connect: vi.fn(async () => {
      if (opts.connectFails) throw new Error("connect() timed out");
      connected = true;
    }),
    request: vi.fn(async () => ({ result: { ledger: { close_time: opts.closeTime ?? 0 } } })),
  };
  return client as typeof client & Client;
}

describe("ledgerClock", () => {
  it("connects on first use and reads the validated ledger close time", async () => {
    const client = stubClient({ connected: false, closeTime: 847_000_000 });

    expect(await ledgerClock(client)()).toBe(847_000_000);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith({ command: "ledger", ledger_index: "validated" });
  });

  it("does not reconnect while connected", async () => {
    const client = stubClient({ connected: true, closeTime: 5 });
    const clock = ledgerClock(client);
    await clock();
    await clock();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("rejects when the ledger is unreachable, so the sweep fails and the next one retries", async () => {
    const client = stubClient({ connected: false, connectFails: true });
    const clock = ledgerClock(client);
    await expect(clock()).rejects.toThrow("connect() timed out");
    await expect(clock()).rejects.toThrow("connect() timed out");
    expect(client.connect).toHaveBeenCalledTimes(2);
  });
});
