export type JevMode = "live" | "fixture";

export interface WorkerConfig {
  databaseUrl: string;
  signerUrl: string;
  hmacSecret: string;
  // Signs the one-use finish authorizations the signer verifies.
  gateSecret: string;
  wsUrl: string;
  intervalMs: number;
  jevMode: JevMode;
  // Empty in fixture mode.
  openrouterApiKey: string;
}

// The worker holds no keys: it reads the database, the validated ledger (read-only) and calls the signer.
// Error messages name variables, never their values.
export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const problems: string[] = [];
  const required = (name: string, why = ""): string => {
    const value = env[name];
    if (!value) problems.push(`${name} is required${why}`);
    return value ?? "";
  };

  const mode = env.JEV_MODE === undefined || env.JEV_MODE === "" ? "live" : env.JEV_MODE;
  let jevMode: JevMode = "live";
  if (mode === "live" || mode === "fixture") jevMode = mode;
  else problems.push("JEV_MODE must be live or fixture");

  const config: WorkerConfig = {
    databaseUrl: required("DATABASE_URL"),
    signerUrl: required("SIGNER_URL"),
    hmacSecret: required("SIGNER_HMAC_SECRET"),
    gateSecret: required("GATE_AUTH_SECRET"),
    wsUrl: required("XRPL_WS_URL"),
    intervalMs: 5_000,
    jevMode,
    openrouterApiKey: jevMode === "live" ? required("OPENROUTER_API_KEY", " when JEV_MODE is live") : "",
  };
  const interval = env.SWEEP_INTERVAL_MS;
  if (interval !== undefined && interval !== "") {
    if (/^[1-9]\d*$/.test(interval)) config.intervalMs = Number(interval);
    else problems.push("SWEEP_INTERVAL_MS must be a positive whole number of milliseconds");
  }

  if (problems.length > 0) throw new Error(`Invalid worker configuration: ${problems.join("; ")}`);
  return config;
}
