import { isValidClassicAddress } from "xrpl";
import { isCents, isDrops } from "@surety/contracts";

export interface SignerConfig {
  preimageKey: Buffer;
  hmacSecret: string;
  gateSecret: string;
  wsUrl: string;
  allowlist: string[];
  maxJobDrops: bigint;
  minCancelSeconds: number;
  maxCancelSeconds: number;
  finishMarginSeconds: number;
  port: number;
  dataDir: string;
  // TESTUSD settlement. null unless TESTUSD_ISSUER is set. The caps and suppliers here are the
  // initial operator policy only: once the signer has a policy file, that file wins.
  testUsd: null | {
    issuer: string;
    approvedSuppliers: string[];
    maxDealCents: bigint;
    dailyCents: bigint;
    maxOpenDeals: number;
    // Authenticates the operator-only policy route. Never given to the worker or the agents.
    operatorSecret: string;
  };
}

// Seeds are kept apart from the general config so they are only ever handed to Wallet.fromSeed.
export interface SignerSeeds {
  buyer: string;
  service: string;
}

const TESTNET_WS = "wss://s.altnet.rippletest.net:51233/";

// Error messages name variables, never their values.
export function loadConfig(env: NodeJS.ProcessEnv): { config: SignerConfig; seeds: SignerSeeds } {
  const problems: string[] = [];
  const required = (name: string): string => {
    const value = env[name];
    if (!value) problems.push(`${name} is required`);
    return value ?? "";
  };
  const integer = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) problems.push(`${name} must be a whole number`);
    return Number(raw);
  };

  const buyer = required("BUYER_SEED");
  const service = required("SERVICE_SEED");

  const preimageKey = required("PREIMAGE_KEY");
  if (preimageKey && !/^[0-9a-fA-F]{64}$/.test(preimageKey)) problems.push("PREIMAGE_KEY must be 64 hex characters");

  const hmacSecret = required("SIGNER_HMAC_SECRET");
  if (hmacSecret && hmacSecret.length < 32) problems.push("SIGNER_HMAC_SECRET must be at least 32 characters");

  const gateSecret = required("GATE_AUTH_SECRET");
  if (gateSecret && gateSecret.length < 32) problems.push("GATE_AUTH_SECRET must be at least 32 characters");

  const allowlist = required("DESTINATION_ALLOWLIST")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.some((a) => !isValidClassicAddress(a))) {
    problems.push("DESTINATION_ALLOWLIST must contain only valid XRPL classic addresses");
  }

  const maxJobDrops = env.MAX_JOB_DROPS ?? "2000000";
  if (!isDrops(maxJobDrops)) problems.push("MAX_JOB_DROPS must be a positive integer drop string");

  let testUsd: SignerConfig["testUsd"] = null;
  const issuer = env.TESTUSD_ISSUER;
  if (issuer) {
    if (!isValidClassicAddress(issuer)) problems.push("TESTUSD_ISSUER must be a valid XRPL classic address");
    const suppliersRaw = env.APPROVED_SUPPLIERS;
    if (!suppliersRaw) problems.push("APPROVED_SUPPLIERS is required when TESTUSD_ISSUER is set");
    const approvedSuppliers = (suppliersRaw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (approvedSuppliers.some((a) => !isValidClassicAddress(a))) {
      problems.push("APPROVED_SUPPLIERS must contain only valid XRPL classic addresses");
    }
    const cents = (name: string, fallback: string): bigint => {
      const raw = env[name] || fallback;
      if (!isCents(raw)) {
        problems.push(`${name} must be a positive integer cent string`);
        return 0n;
      }
      return BigInt(raw);
    };
    const maxDealCents = cents("MAX_DEAL_TESTUSD_CENTS", "10000000");
    const dailyCents = cents("DAILY_TESTUSD_CENTS", "50000000");
    if (maxDealCents > dailyCents) problems.push("MAX_DEAL_TESTUSD_CENTS cannot exceed DAILY_TESTUSD_CENTS");
    const maxOpenDeals = integer("MAX_OPEN_TESTUSD_DEALS", 10);
    if (maxOpenDeals < 1) problems.push("MAX_OPEN_TESTUSD_DEALS must be at least 1");
    const operatorSecret = env.OPERATOR_HMAC_SECRET ?? "";
    if (!operatorSecret) problems.push("OPERATOR_HMAC_SECRET is required when TESTUSD_ISSUER is set");
    else if (operatorSecret.length < 32) problems.push("OPERATOR_HMAC_SECRET must be at least 32 characters");
    else if (operatorSecret === hmacSecret || operatorSecret === gateSecret) {
      problems.push("OPERATOR_HMAC_SECRET must differ from SIGNER_HMAC_SECRET and GATE_AUTH_SECRET");
    }
    testUsd = { issuer, approvedSuppliers, maxDealCents, dailyCents, maxOpenDeals, operatorSecret };
  }

  const config: SignerConfig = {
    preimageKey: Buffer.from(/^[0-9a-fA-F]{64}$/.test(preimageKey) ? preimageKey : "00".repeat(32), "hex"),
    hmacSecret,
    gateSecret,
    wsUrl: env.XRPL_WS_URL || TESTNET_WS,
    allowlist,
    maxJobDrops: isDrops(maxJobDrops) ? BigInt(maxJobDrops) : 0n,
    minCancelSeconds: integer("MIN_CANCEL_SECONDS", 60),
    maxCancelSeconds: integer("MAX_CANCEL_SECONDS", 86_400),
    finishMarginSeconds: integer("FINISH_MARGIN_SECONDS", 5),
    port: integer("PORT", 4100),
    dataDir: env.DATA_DIR || "./data",
    testUsd,
  };

  if (problems.length > 0) throw new Error(`Invalid signer configuration: ${problems.join("; ")}`);
  return { config, seeds: { buyer, service } };
}
