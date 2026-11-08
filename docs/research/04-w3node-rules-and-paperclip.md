# 04: W3NODE rules and Paperclip integration

Researched 2026-11-08, read-only. Main source [BB]: the organiser's BuilderBase page (org "Node Engine - W3Node"), https://builderbase.com/event/node-engine-hackathon-9o8q. Its text loads client-side, so I read it from the public JSON at https://edge.builderbase.com/super-events/public/node-engine-hackathon-9o8q.

**Act now:** the checkpoint is tomorrow, Mon 9 Nov 17:00 SAST, and it is mandatory.

## Part A: W3NODE / Node Engine Hackathon

1. **Dates and deadlines** VERIFIED [BB], https://w3node.io/
   - Virtual build 2-11 Nov. In-person build 12-13 Nov at Park View Event Space, Woodstock. Finals 14 Nov, times TBC.
   - Checkpoint Mon 9 Nov 17:00 SAST, submitted on BuilderBase. You need the concept (problem, African users, 3-5 features), a technical foundation (a repo with meaningful commits, or an architecture diagram) and a team update. It is feedback, not elimination.
   - Final submission closes **Fri 13 Nov 23:59 SAST**. Your "checkpoint 9 Nov, close 13 Nov" is correct.
   - Already passed: team lock (Fri 6 Nov 23:59) and the workshops.
2. **Registration**
   - Registration is still open. Acceptance is manual, and "every teammate must apply and be accepted individually." VERIFIED [BB JSON]
   - Solo is allowed: "Hack alone or in a team of up to four." VERIFIED [BB]
   - How acceptance is notified: NOT FOUND. Contacts are percy.maphologela@saintrockmedia.com and Telegram https://t.me/+WkUK-tp-yGFhMTVh.
3. **Tracks and bounties** (4 tracks, and your project must align with one). VERIFIED [BB]
   - **Agentic Finance (Ripple):** $2,500 plus a fast track into Ripple's UDAX Cape Town accelerator. The MVP must include:
     - at least one Testnet/Devnet transaction executed autonomously by an agent
     - limits enforced somewhere the agent doesn't control
     - a way for a human operator to set those limits outside the agent

     You also need a real customer pain point and a go-to-market strategy. Ripple judges "meaningful use of the XRP Ledger and RLUSD".
   - **Mobile Money and P2P (Tether):** $1,500. The other two tracks are open, with prizes TBA.
   - The listed resources include an XRPL x402 facilitator and an RLUSD testnet faucet.
   - What this means for Surety: escrow plus an independent gate covers the limits requirement. You still need an operator limits control and an EscrowCreate signed by the agent. I did not check whether testnet escrow can hold RLUSD.
   - The DevFest announcement was NOT FOUND, but [BB] confirms the Ripple/Tether sponsorship and UDAX link.
4. **Pre-existing code and AI**
   - The rules say: "Pre-existing projects can't be submitted. Open-source libraries and AI tools are welcome." Pre-existing code must be disclosed, and work that relies mostly on it "historically scored lower". VERIFIED [BB]
   - Hacking began 2 Nov, so disclose Paperclip and any earlier Surety code. I found no disclosure rule for AI-generated code.
5. **Judging and submission** VERIFIED [BB]
   - The rubric is out of 90: Product, Technical and Business, 30 each. On Technical, "local demo only" scores 9-14, while a testnet deployment reaches the top band.
   - Submit on BuilderBase: a public GitHub repo with a README, plus a demo video of up to 3 minutes.
   - The pitch is 5 minutes plus 3 minutes of Q&A. At least one member must be on site.
6. **Prizes and UDAX**
   - The pool is "up to $10K" plus travel grants. VERIFIED [BB]
   - UDAX terms (equity, funding, dates): NOT FOUND.
7. **Practical**
   - Wifi and power: NOT FOUND. The organiser advises bringing "a mobile hotspot" and to "pre-load transactions". VERIFIED [BB]
   - Mentors are available through check-ins and Telegram. Missed check-ins "risk losing your spot".
   - Testnet: public faucets and xrpl-up only.

## Part B: Paperclip

1. **Releases since v2026.916.1**
   - The latest is **v2026.1106.0** (6 Nov).
   - Breaking changes along the way:
     - harnesses now default to full auto
     - @-mentions no longer start runs
     - workspace locks changed
     - budgets block unpriced usage by default
     - the Runner is the default for new agents (needs glibc 2.39)
   - 1012.0 added an experimental "Assistant connection (MCP)". It lets external clients create tasks and receive signed event webhooks, but needs HTTPS.
   - There are no payments, x402, crypto or marketplace features. "x402" appears only as a link in `doc/plans/2026-02-18-agent-authentication.md`. "Hiring" means creating agents inside your own company.
   - Recommendation: stay on 916.1. Upgrading brings risk and nothing you need.
2. **External service hooks**
   - (a) **Create a task:** `POST /api/companies/{companyId}/issues` with `assigneeAgentId` (`docs/api/issues.md`). Assigning it wakes the agent.
   - (b) **Know when it's done:** poll `GET /api/issues/{issueId}` until the status is `in_review` or `done`. The push options don't fit here: plugin events (`doc/plugins/PLUGIN_SPEC.md`) are early, and MCP webhooks reject private networks.
   - (c) **Read the deliverable:** `GET /api/issues/{id}/documents/{key}`, plus `/comments` and `/work-products`.
3. **Feasibility**
   - **Mapping:** the buyer creates the issue and the seller is the assignee. The deliverable is a named document. The verification gate is an approval stage in the execution policy (`docs/guides/execution-policy.md`).
   - **Flow:** the service PATCHes `done` to release payment (EscrowFinish) or `in_progress` to send the work back.
   - **Half a day is realistic.** It takes four calls: create, poll, read, PATCH.
   - **Awkward points:**
     - Cross-company access returns 403, so buyer and seller must share one company.
     - Paperclip budgets cap LLM spend and are unrelated to escrow.
     - Require a named document, and treat a missing one as failed delivery.
     - Agent latency is unpredictable, so pre-record the demo video.
     - Escrow expiry and task state can drift. Make the escrow service the source of truth.
4. **Licence:** MIT (`gh repo view` licenseInfo).
