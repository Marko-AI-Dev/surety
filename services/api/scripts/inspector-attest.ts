// The inspector's stand-in for the phone page: a person reads the bill of lading number off the
// shipment and attests it, or refuses. With no arguments it lists the deals waiting for an answer.
// Reads API_TOKEN_INSPECTOR from the environment and never prints it.
// Run: pnpm inspector:attest [<dealId> <blNumber> <attested|refused> [note...]]
import { resolve } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE = "usage: pnpm inspector:attest [<dealId> <blNumber> <attested|refused> [note...]]";

export function attestationArgs(argv: string[]): { dealId: string; body: { blNumber: string; outcome: "attested" | "refused"; note: string } } | null {
  if (argv.length === 0) return null;
  const [dealId, blNumber, outcome, ...note] = argv;
  if (!dealId || !UUID.test(dealId) || !blNumber || (outcome !== "attested" && outcome !== "refused")) throw new Error(USAGE);
  return { dealId, body: { blNumber, outcome, note: note.join(" ") } };
}

export function apiBase(env: Record<string, string | undefined>): string {
  if (env.SURETY_API_URL) return env.SURETY_API_URL.replace(/\/+$/, "");
  return `http://${env.API_HOST || "127.0.0.1"}:${env.API_PORT || "4200"}`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const token = process.env.API_TOKEN_INSPECTOR;
  if (!token) {
    console.error("API_TOKEN_INSPECTOR is not set: run pnpm api:tokens --add-missing, then use pnpm inspector:attest");
    process.exit(1);
  }
  let args: ReturnType<typeof attestationArgs>;
  try {
    args = attestationArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const base = apiBase(process.env);
  const res = args
    ? await fetch(`${base}/inspector/deals/${args.dealId}/attestation`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(args.body),
      })
    : await fetch(`${base}/inspector/deals`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  console.log(res.ok ? JSON.stringify(JSON.parse(text), null, 2) : `HTTP ${res.status}: ${text}`);
  process.exit(res.ok ? 0 : 1);
}
