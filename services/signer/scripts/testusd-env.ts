// Renders the env files the one-time TESTUSD setup writes. Pure functions, so the content is tested
// without touching the network or the disk.

// services/signer/.env.testusd: loaded by the signer at start. The caps are the initial operator
// policy only; once the signer has written its policy file, live updates win.
export function renderTestUsdEnv(p: { issuer: string; approvedSuppliers: string[]; operatorSecret: string }): string {
  return [
    "# Surety signer TESTUSD settings. TESTUSD is a self-issued test dollar on XRPL Testnet with no value.",
    `TESTUSD_ISSUER=${p.issuer}`,
    `APPROVED_SUPPLIERS=${p.approvedSuppliers.join(",")}`,
    "# initial policy; change it live through the operator policy update",
    "MAX_DEAL_TESTUSD_CENTS=10000000",
    "DAILY_TESTUSD_CENTS=50000000",
    "MAX_OPEN_TESTUSD_DEALS=10",
    "# Authenticates the operator-only policy route. The worker and the agents never hold it.",
    `OPERATOR_HMAC_SECRET=${p.operatorSecret}`,
    "",
  ].join("\n");
}

// services/signer/.env.issuer: read only by setup and future top-ups. The signer never loads it.
export function renderIssuerEnv(seed: string): string {
  return [
    "# TESTUSD issuer key. TESTNET ONLY. Never commit, never copy elsewhere. The signer does not load this file.",
    `TESTUSD_ISSUER_SEED=${seed}`,
    "",
  ].join("\n");
}

// Root .env.operator: for operator tools (the evidence script, later the Control room's server side).
export function renderOperatorEnv(operatorSecret: string): string {
  return [
    "# Surety operator credential. Never commit. Never give this to the worker or the agents.",
    `OPERATOR_HMAC_SECRET=${operatorSecret}`,
    "",
  ].join("\n");
}
