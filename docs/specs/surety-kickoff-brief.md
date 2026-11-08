# Surety - kickoff brief for Claude

Read the attached master build spec first. It is the plan of record. This brief only sets how we start.

## What we are proving
One AI agent hires another to extract an invoice from synthetic data. Test XRP is locked in escrow. Payment is released only after agreed checks pass. Three outcomes must work reliably and be demonstrable: **pay on pass, reject on fail, refund after expiry when the evaluator is down.**

## Stack and rules (from the spec)
TypeScript, React, Node backend, xrpl.js, Supabase. Deterministic checks decide facts and payment rules; Jev adds an assessment; an isolated signing service releases payment. Testnet only. No mainnet, no real funds.

## Ask before you do any of these
- paid API calls or anything that spends money
- deployment
- changing the stack, the signer isolation, or the three outcomes
- reusing assets or code from another project

## Step 1 - plan, no code yet
Before writing code, reply with:
1. The smallest implementation plan that proves the three outcomes end to end.
2. Anything in the spec that is out of date or wrong. Check current xrpl.js escrow APIs. Jev is now listed at jev-1.14.0 (spec says 1.13.0 / jev-latest) and OpenRouter exposes it through a separate Decisions API / System One route, not chat completions. Confirm against the vendor docs and pin a version.
3. The three riskiest assumptions, and how to test each cheaply.
4. Where you would challenge the design. Be specific, and mark each point as "verified" or "my opinion".

Then stop and wait for my go-ahead.

## Step 2 - build order
Signer isolation applies from the first escrow code. Even the first scripted escrow create/release/cancel calls go through the separate signer interface. No script or app code holds the key or seed.

1. Signer service (testnet key only) with a narrow interface: sign only the allowed escrow actions. Then testnet escrow create, release and cancel after expiry through it, scripted, no UI.
2. Durable expiry cancellation that survives a server restart. Persisted state, not an in-memory timer.
3. Deterministic checks on a synthetic invoice, with a pass fixture and a fail fixture.
4. Jev assessment layered on top. Evaluator offline must mean no payment, then refund after expiry.
5. Minimal UI that makes the three outcomes visible, using the reference UI selectively (see UI). Polish comes last.

Definition of done, with evidence that fits each step:
- Ledger operations (create, release, cancel): testnet transaction hashes plus the resulting ledger state.
- Restart-safe cancellation: an automated test or log showing a restart before expiry and the refund still happening.
- Signer isolation: a test or check showing the app cannot sign or read the key directly, and that disallowed actions are refused.
- Checks and Jev: tests for the pass, fail and evaluator-offline fixtures.
- UI: a recorded or screenshotted run of the three outcomes.

## Design review (one pass, then lock)
After Step 1 and before Step 2, spend one short round on product and creative ideas: what makes the demo clearer or more convincing. Propose at most three improvements, each tagged "fits in scope" or "stretch". Nothing is added to the build unless I approve it. Paperclip runtime integration is stretch.

## UI
I have an existing personal project with a polished, Apple-style 3D interface. Inspect it now, read-only, in parallel with Step 1. I will point you at the repo or describe it. Do not modify it and do not copy anything yet.
- List its components, styles/design tokens, motion/3D approach and dependencies.
- Say which parts are compatible with Surety's React/TypeScript stack and which would need a rewrite or add heavy dependencies.
- Flag any third-party assets, fonts or code whose licence I need to check.
- Sketch an early Surety UI layout from this, kept light.
After the core flow works, selectively port the compatible parts. Do not let UI work delay the escrow, signer and refund path.

## Working rules
- Keep a running log: decisions, open questions, and spend. Keep coding-agent cost separate from the measured runtime cost per completed job.
- Small commits. Never commit keys or seeds. Runtime keys stay server-side.
- If the spec and reality disagree, say so before changing anything.
- Dates: I am working to a checkpoint on Nov 9 and a close on Nov 13. These are unconfirmed until I get the organiser rules.
