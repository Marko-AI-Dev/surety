// Operator command: change the live TESTUSD limits on the signer. The approved suppliers stay as they are.
// Run: pnpm limits:set --per-deal 100000 --daily 500000 --open 10   (whole dollars)
// Needs the signer running. Reads SIGNER_URL and SIGNER_HMAC_SECRET from .env (for health) and
// OPERATOR_HMAC_SECRET from .env.operator (for the update). No secret is printed.
import { randomUUID } from "node:crypto";
import { SignerClientError, createOperatorClient, createSignerClient } from "@surety/signer-client";
import { buildPolicyUpdate, parseLimitArgs } from "./limits";

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run with pnpm limits:set)`);
  return value;
}

const dollars = (cents: string) => `$${(BigInt(cents) / 100n).toLocaleString("en-US")}`;

try {
  const limits = parseLimitArgs(process.argv.slice(2));
  const url = need("SIGNER_URL");
  const health = await createSignerClient({ url, hmacSecret: need("SIGNER_HMAC_SECRET") }).health();
  const operator = createOperatorClient({ url, operatorSecret: need("OPERATOR_HMAC_SECRET") });
  const view = await operator.updatePolicy(buildPolicyUpdate(health, limits, randomUUID()));
  console.log(
    `policy v${view.version}: ${dollars(view.perDealCents)} per deal, ${dollars(view.dailyCents)} per 24h, ${view.maxOpenDeals} open`,
  );
} catch (e) {
  const reason = e instanceof SignerClientError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
  console.error(`limits not changed: ${reason}`);
  process.exitCode = 1;
}
