// Sets up the buyer team in Paperclip's "Karoo Solar Imports (demo)" company (Phase 4c, Task 11):
//   - one Paperclip secret per role token (lead, sourcing, negotiator), read from .env.api and piped
//     to Paperclip through stdin, never printed or put on a command line;
//   - the Lead (CEO), Sourcing and Negotiator agents on the Codex adapter's CLI engine (Marko's ChatGPT
//     subscription), each with its instructions and the Surety API skill copied into its working folder.
// Re-runnable: existing secrets are rotated, existing agents updated. Never touches another company.
// Run: pnpm paperclip:team   (needs .env.api; prints only names and ids)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const COMPANY = "a5420cfe-19a3-4b7d-99a2-8e7999c2e9f8"; // Karoo Solar Imports (demo); see docs/research/07-paperclip-test.md
const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = "/mnt/c/Users/Marko/HACKATHON/agents/paperclip";

// The agents run inside Paperclip's workspace sandbox (Bubblewrap): they see only their own working
// folder, read-only system paths and the ChatGPT sign-in file, never the Windows drive that holds the
// repo and its secrets. The wrapper fixes Paperclip's sandbox on merged-/usr Ubuntu
// (docs/research/07-paperclip-test.md). Proven with a canary file: readable before, "No such file" after.
const SANDBOX_WRAPPER = "/home/marko/surety-demo/bin/bwrap-merged-usr";
const CODEX_SIGN_IN = "/home/marko/.codex/auth.json";

const wsl = (script: string, input?: string) =>
  execFileSync("wsl", ["-d", "Ubuntu", "-e", "bash", "-lc", script], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const json = <T>(text: string): T => JSON.parse(text) as T;
const listOf = <T>(v: unknown): T[] => (Array.isArray(v) ? v : ((v as { items?: T[] }).items ?? []));

const env = parseEnv(readFileSync(resolve(ROOT, ".env.api"), "utf8"));
const port = process.env.API_PORT ?? "4200";
const gateway = wsl("ip route show default | awk '{print $3}'").trim();
if (!/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) throw new Error("could not read the Windows host address from WSL");
const apiUrl = `http://${gateway}:${port}`;

const ROLES = [
  { key: "lead", name: "Lead", role: "ceo", title: "Head of purchasing", file: "lead.md", token: env.API_TOKEN_LEAD },
  { key: "sourcing", name: "Sourcing", role: "researcher", title: "Sourcing", file: "sourcing.md", token: env.API_TOKEN_SOURCING },
  { key: "negotiator", name: "Negotiator", role: "general", title: "Negotiator", file: "negotiator.md", token: env.API_TOKEN_NEGOTIATOR },
] as const;

wsl(`mkdir -p /home/marko/surety-demo/bin && cp ${SOURCE}/bwrap-merged-usr.sh ${SANDBOX_WRAPPER} && chmod +x ${SANDBOX_WRAPPER}`);

const secrets = listOf<{ id: string; name: string }>(json(wsl(`paperclipai secrets list -C ${COMPANY} --json`)));
const agents = listOf<{ id: string; name: string }>(json(wsl(`paperclipai agent list -C ${COMPANY} --json`)));

const secretIds: Record<string, string> = {};
for (const r of ROLES) {
  if (!r.token) throw new Error(`.env.api has no token for ${r.key}: run pnpm api:tokens`);
  const name = `SURETY_TOKEN_${r.key.toUpperCase()}`;
  const existing = secrets.find((s) => s.name === name);
  const out = existing
    ? wsl(`read -r V; export V; paperclipai secrets rotate ${existing.id} --value-env V --json`, `${r.token}\n`)
    : wsl(`read -r V; export V; paperclipai secrets create -C ${COMPANY} --name ${name} --key ${name} --value-env V --json`, `${r.token}\n`);
  secretIds[r.key] = existing?.id ?? json<{ id: string }>(out).id;
  console.log(`secret ${name}: ${existing ? "rotated" : "created"} (${secretIds[r.key]})`);
}

let leadId = agents.find((a) => a.name === "Lead")?.id ?? null;
for (const r of ROLES) {
  const cwd = `/home/marko/surety-demo/${r.key}`;
  wsl(`mkdir -p ${cwd} && cp ${SOURCE}/${r.file} ${SOURCE}/surety-api.md ${cwd}/`);
  const payload = {
    name: r.name,
    role: r.role,
    title: r.title,
    adapterType: "codex_local",
    adapterConfig: {
      engine: "cli",
      cwd,
      modelReasoningEffort: "low",
      instructionsFilePath: `${cwd}/${r.file}`,
      filesystemScope: "workspace",
      filesystemSandboxCommand: SANDBOX_WRAPPER,
      filesystemExtraPaths: [CODEX_SIGN_IN],
      env: { SURETY_API_URL: apiUrl, SURETY_API_TOKEN: { type: "secret_ref", secretId: secretIds[r.key] } },
    },
    ...(r.key !== "lead" && leadId ? { reportsTo: leadId } : {}),
  };
  const existing = agents.find((a) => a.name === r.name);
  const arg = JSON.stringify(payload).replaceAll("'", "'\\''");
  const out = existing
    ? wsl(`paperclipai agent update ${existing.id} --payload-json '${arg}' --json`)
    : wsl(`paperclipai agent create -C ${COMPANY} --payload-json '${arg}' --json`);
  const id = existing?.id ?? json<{ id: string }>(out).id;
  if (r.key === "lead") leadId = id;
  console.log(`agent ${r.name}: ${existing ? "updated" : "created"} (${id}), API ${apiUrl}`);
}
