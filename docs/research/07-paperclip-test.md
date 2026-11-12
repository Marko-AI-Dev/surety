# Paperclip stage-speed test for the buyer team

Run on 9 Nov 2026 (Phase 4c, Task 1). Question: can a Paperclip agent, running on Marko's ChatGPT subscription, call a Surety service on the Windows host fast and reliably enough for a live demo?

**Verdict: yes, on the Codex adapter's CLI engine.** The buyer team runs on Paperclip.

## Setup

- **Paperclip:** v2026.916.1, a systemd user service in WSL Ubuntu, `local_trusted` mode, API at `http://127.0.0.1:3101`.
- **Company:** a new company, "Karoo Solar Imports (demo)" (`a5420cfe-19a3-4b7d-99a2-8e7999c2e9f8`, issue prefix `KAR`). No existing company, agent or setup file was opened.
- **Agent:** "Probe" (`5da54575-2dc0-4b1a-844b-96378ed144ec`), adapter `codex_local`, Paperclip's default Codex model, `modelReasoningEffort: "low"`.
- **Subscription:** the Codex CLI (0.156.1) in Ubuntu was already signed in with ChatGPT (`codex login status`: "Logged in using ChatGPT"). Paperclip reports `totalCostCents: 0` for the agent, so nothing is billed per call.
- **The probe:** `scripts/paperclip-probe.ts` (`pnpm probe:paperclip`), an HTTP server on the Windows host at port 4299. Each task told the agent to `GET /ping?nonce=<n>`, then `POST /pong`, then mark the issue done with the curl exit codes.

## Results

Times are from the issue being created (assigned) to each request reaching the probe. They're upper bounds within about a second, because the assignment time was taken as the create command returned.

| Run | Engine | First request | Both requests | Result |
|---|---|---|---|---|
| 1 | ACP (default) | 42 s | 46 s | pass |
| 2 | ACP | 25 s | 29 s | pass |
| 3 | ACP | none | none | **fail:** curl exit 7, no network in that run |
| 4 | ACP | 34 s | 34 s | pass |
| 5 | ACP | none | none | **fail:** no network at all, the agent couldn't even reach Paperclip's own API |
| 6 | CLI | 18 s | 18 s | pass |
| 7 | CLI | 14 s | 15 s | pass |
| 8 | CLI | 18 s | 19 s | pass |

- **The default ACP engine is not reliable for this:** two of five runs had no network. Both were resumed sessions shortly after a previous run. The adapter's own notes say ACP turns network on per turn through a patch; in practice some turns ran without it.
- **The CLI engine passed every run and was about twice as fast.** Its default is a writable workspace sandbox with network on.
- **The agent reported failures honestly.** In runs 3 and 5 it said the requests failed with exit code 7, instead of claiming success.

## Findings for Task 11

- **Adapter:** `codex_local` with `adapterConfig.engine: "cli"`. Set `cwd` per agent (for example `/home/marko/surety-demo/<role>`) and `modelReasoningEffort: "low"` unless a role needs more.
- **Starting work programmatically:** `paperclipai issue create -C <companyId> --assignee-agent-id <agentId> --title ... --description ...` wakes the agent by itself within seconds; no manual heartbeat is needed. `paperclipai agent heartbeat:invoke <agentId>` also exists to wake an agent on demand.
- **Reaching a Windows service from WSL:** WSL uses its default NAT networking, so the Windows host is the default gateway, `172.19.160.1` on this machine. WSL's `127.0.0.1` does not reach Windows. The address can change after a reboot, so read it at runtime with `ip route show default | awk '{print $3}'`, and bind the Surety API on an address WSL can reach (`API_HOST=0.0.0.0` or that gateway's interface). Windows Firewall did not block the probe port.
- **Secrets and environment:** `paperclipai secrets create` stores a company secret. An agent's `adapterConfig.env` binds it with `{ "type": "secret_ref", "secretId": "<uuid>" }`, so API tokens never sit in plain agent config.
- **Locking the agents down:** Bubblewrap is installed (`/usr/bin/bwrap`), so the CLI engine supports `networkScope: "allowlist"` with `networkAllowlist` (only the Surety API host and the Codex provider) and `filesystemScope: "workspace"`. Task 11 should try this, so the agents can't reach any other site even if told to. If it breaks the ChatGPT sign-in, record which host it needs.
- **Instructions:** `adapterConfig.instructionsFilePath` points at a markdown file that is prepended to every run, which is where `agents/paperclip/*.md` go.
- **Housekeeping:** the probe agent and issues KAR-1 to KAR-8 can stay or be archived; they hold no secrets.

## Sandbox: the agents cannot see the keys (9 Nov, after the external review)

An external review (Fable 5.2) pointed out that the agents run with a shell inside WSL, which mounts the Windows drive holding the repo and its secret files. Tested with a harmless canary file placed next to those files (no secret was ever involved):

| Test | Agent config | Result |
|---|---|---|
| 1 | CLI engine, no filesystem scope | The agent printed the canary word: it could read the Windows drive, so it could have read the keys |
| 2 | `filesystemScope: "workspace"` | The sandbox failed to start: Paperclip's Bubblewrap setup binds `/bin`, `/sbin`, `/lib` and `/lib64` after symlinking them to `usr/*`, which fails on merged-`/usr` Ubuntu. Failed closed |
| 3 | plus `filesystemSandboxCommand` pointing at `agents/paperclip/bwrap-merged-usr.sh` (drops those four redundant binds) | The sandbox started; Codex got `401` because the ChatGPT sign-in file sits outside the sandbox |
| 4 | plus `filesystemExtraPaths: ["/home/marko/.codex/auth.json"]` (read-only) | `cat: /mnt/c/Users/Marko/HACKATHON/.sandbox-canary: No such file or directory`. The agent ran on the subscription, used Paperclip and reported back, but cannot see the Windows drive |

The Lead, Sourcing and Negotiator agents now run with the test-4 settings (`pnpm paperclip:team` installs the wrapper and applies them). They see only their own working folder, read-only system paths and the sign-in file; network stays on so they can reach Paperclip, ChatGPT and the Surety API. The keys and secrets are invisible to them. The remaining boundary to make physical is the signer on a separate device.
