import { Address } from "@surety/contracts";

// The API's settings. Every role has its own bearer token, and each supplier its own, so a token
// names exactly one caller. Errors name the setting, never its value.

export interface ApiTokens {
  lead: string;
  sourcing: string;
  negotiator: string;
  view: string;
  // The inspector is a person holding the second key, never an agent.
  inspector: string;
}

export interface ApiConfig {
  host: string;
  port: number;
  databaseUrl: string;
  signerUrl: string;
  signerHmacSecret: string;
  wsUrl: string;
  openRouterKey: string;
  directoryFile: string;
  tokens: ApiTokens;
  // Shown as the attesting inspector on every attestation.
  inspectorName: string;
  // Supplier wallet address to its token.
  supplierTokens: Record<string, string>;
}

export const MIN_TOKEN_CHARS = 32;

export function loadApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const problems: string[] = [];
  const need = (name: string): string => {
    const v = env[name];
    if (!v) problems.push(`${name} is not set`);
    return v ?? "";
  };
  const token = (name: string): string => {
    const v = need(name);
    if (v && v.length < MIN_TOKEN_CHARS) problems.push(`${name} must be at least ${MIN_TOKEN_CHARS} characters`);
    return v;
  };

  const tokens: ApiTokens = {
    lead: token("API_TOKEN_LEAD"),
    sourcing: token("API_TOKEN_SOURCING"),
    negotiator: token("API_TOKEN_NEGOTIATOR"),
    view: token("API_TOKEN_VIEW"),
    inspector: token("API_TOKEN_INSPECTOR"),
  };

  let supplierTokens: Record<string, string> = {};
  const rawSuppliers = need("API_SUPPLIER_TOKENS");
  if (rawSuppliers) {
    try {
      const parsed = JSON.parse(rawSuppliers) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      for (const [address, t] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Address.safeParse(address).success || typeof t !== "string" || t.length < MIN_TOKEN_CHARS) {
          throw new Error("bad entry");
        }
      }
      supplierTokens = parsed as Record<string, string>;
    } catch {
      problems.push(`API_SUPPLIER_TOKENS must be a JSON object of supplier address to a token of at least ${MIN_TOKEN_CHARS} characters`);
    }
  }

  const all = [...Object.values(tokens), ...Object.values(supplierTokens)].filter(Boolean);
  if (new Set(all).size !== all.length) problems.push("every API token must be distinct");

  const port = Number(env.API_PORT ?? "4200");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) problems.push("API_PORT must be a port number");

  const config: ApiConfig = {
    host: env.API_HOST ?? "127.0.0.1",
    port,
    databaseUrl: need("DATABASE_URL"),
    signerUrl: need("SIGNER_URL"),
    signerHmacSecret: need("SIGNER_HMAC_SECRET"),
    wsUrl: need("XRPL_WS_URL"),
    openRouterKey: need("OPENROUTER_API_KEY"),
    directoryFile: env.SUPPLIER_DIRECTORY ?? "fixtures/sourcing/directory.json",
    tokens,
    inspectorName: env.API_INSPECTOR_NAME || "Port inspector (demo)",
    supplierTokens,
  };
  if (problems.length > 0) throw new Error(`API config: ${problems.join("; ")}`);
  return config;
}
