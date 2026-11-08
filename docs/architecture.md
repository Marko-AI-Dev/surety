# Surety architecture

Surety lets one AI agent pay another for work, with the money held in native XRP Ledger escrow until the work is verified. The ledger enforces the money rules; Surety's gate decides whether the work is good; only an isolated signer can move funds.

```mermaid
flowchart LR
  classDef built fill:#1f6f43,stroke:#7be3a6,color:#fff
  classDef planned fill:#2b2f36,stroke:#8a93a3,color:#e6e6e6,stroke-dasharray: 4 3
  classDef ledger fill:#123a5c,stroke:#6fb3ff,color:#fff

  Operator([Human operator]):::planned
  Buyer[Buyer agent<br/>Claude Haiku 5.5]:::planned
  Seller[Seller agent<br/>Claude Haiku 5.5]:::planned

  subgraph App[Surety app]
    API[API and workflow<br/>job state machine]:::planned
    Rules[Deterministic checks<br/>schema, arithmetic, source match]:::planned
    Jev[Jev evaluator<br/>via OpenRouter]:::planned
    Worker[Expiry worker<br/>restart-safe refunds]:::planned
    DB[(Supabase<br/>mirror of jobs and receipts)]:::planned
    UI[Live pipeline view<br/>receipts, limits panel]:::planned
  end

  subgraph KeyBoundary[Key boundary: the only place keys exist]
    Signer[Isolated signer<br/>3 operations, HMAC-authenticated<br/>limits, one-use authorizations]:::built
  end

  XRPL[(XRP Ledger Testnet<br/>EscrowCreate / Finish / Cancel)]:::ledger

  Operator -->|sets caps and allowlist| UI
  Buyer -->|post job, fund| API
  Seller -->|deliver JSON| API
  API --> Rules --> Jev
  Jev -->|pass: signed one-use authorization| Signer
  Worker -->|expired: cancel| Signer
  API -->|fund: create escrow| Signer
  Signer -->|signed transactions| XRPL
  API --- DB
  UI --- DB
  XRPL -.->|validated results| API
```

Green is built and proven on testnet. Dashed is planned for the rest of the hackathon.

## Trust boundaries

- **Keys live only in the signer.** It is a separate process on 127.0.0.1 with its own secrets file. A repo-wide check (`pnpm check:boundaries`) fails if any other code reads a seed or the preimage key.
- **The signer accepts three operations, nothing else.** Create escrow for a job, finish with a one-use authorization, cancel an expired escrow. There is no endpoint that signs an arbitrary transaction.
- **Limits are enforced outside the agents.** The signer checks the per-job cap and the destination allowlist on every create, and checks the authorization against the escrow on the validated ledger before every finish.
- **Payment needs a secret only the signer holds.** Each escrow is locked with a PREIMAGE-SHA-256 condition. The matching fulfillment is encrypted at rest and only released on chain inside an authorized EscrowFinish.
- **Ledger time decides, not laptop time.** Finish is refused close to expiry and cancel is refused before expiry, both by validated ledger close time.
- **Validated `tesSUCCESS` is the only success.** Transaction hashes are journaled before submission, so a timeout is resolved by lookup and never by signing twice.

What the ledger does not do: it does not understand the work. A compromised gate or signer could still release wrongly. That is why the gate is layered (rules first, then Jev, both fail closed) and why every release carries a binding to the exact job, deliverable and policy version.

## Escrow lifecycle

```mermaid
stateDiagram-v2
  [*] --> Locked: EscrowCreate (buyer, Condition + CancelAfter)
  Locked --> Paid: checks pass, one-use authorization, EscrowFinish (service)
  Locked --> AwaitingExpiry: checks fail or evaluator down
  AwaitingExpiry --> Refunded: ledger time passes CancelAfter, EscrowCancel (service)
  Paid --> [*]
  Refunded --> [*]
```
