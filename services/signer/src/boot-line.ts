import type { HealthResponse } from "@surety/contracts";
import { formatUsd } from "./usd";

// The signer's start-up line. Built from health, so it shows the live operator policy (which can
// differ from the starting settings after a change) and never anything secret.
export function bootLine(port: number, health: HealthResponse): string {
  const base = `Surety signer on 127.0.0.1:${port} | XRPL Testnet | buyer ${health.buyer} | service ${health.service}`;
  const usd = health.testUsd;
  if (!usd) return base;
  const { perDealCents, dailyCents, openDeals } = usd.limits;
  return (
    `${base} | TESTUSD issuer ${usd.issuer} | policy v${usd.policyVersion}: ` +
    `${formatUsd(BigInt(perDealCents))} per deal, ${formatUsd(BigInt(dailyCents))} per 24h, ${openDeals} open`
  );
}
