export interface WorkerConfig {
  databaseUrl: string;
  signerUrl: string;
  hmacSecret: string;
  wsUrl: string;
  intervalMs: number;
}

// The worker holds no keys: it reads the database, the validated ledger (read-only) and calls the signer.
// Error messages name variables, never their values.
export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const problems: string[] = [];
  const required = (name: string): string => {
    const value = env[name];
    if (!value) problems.push(`${name} is required`);
    return value ?? "";
  };

  const config: WorkerConfig = {
    databaseUrl: required("DATABASE_URL"),
    signerUrl: required("SIGNER_URL"),
    hmacSecret: required("SIGNER_HMAC_SECRET"),
    wsUrl: required("XRPL_WS_URL"),
    intervalMs: 5_000,
  };
  const interval = env.SWEEP_INTERVAL_MS;
  if (interval !== undefined && interval !== "") {
    if (/^[1-9]\d*$/.test(interval)) config.intervalMs = Number(interval);
    else problems.push("SWEEP_INTERVAL_MS must be a positive whole number of milliseconds");
  }

  if (problems.length > 0) throw new Error(`Invalid worker configuration: ${problems.join("; ")}`);
  return config;
}
