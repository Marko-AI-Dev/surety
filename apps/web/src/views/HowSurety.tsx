import { Ban, Eye, Gavel, KeyRound, Landmark, type LucideIcon, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";

// How Surety works, on one page: what happens to the money in five steps, and what makes it safe.
// Everything said here is true of the build today; what is not real yet is said at the bottom.

const STEPS: { title: string; text: string }[] = [
  { title: "You say yes", text: "Your agents negotiate and recommend a deal. Nothing has moved. No agent can pay." },
  { title: "The money locks", text: "The amount of that one deal is locked on the XRP Ledger. It is not sent to the supplier." },
  { title: "The supplier ships", text: "The supplier sends the invoice and the shipping document for the order." },
  { title: "Two checks", text: "The paperwork must match your order, and an independent inspector, a person, confirms the shipment." },
  { title: "Paid, or refunded", text: "Both checks pass: the supplier is paid in seconds. One does not: all of it comes back to you." },
];

const SAFE: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Gavel, title: "Nothing locks before your yes", text: "The agent's choice is a recommendation. A no moves nothing." },
  { icon: Ban, title: "The agents cannot pay", text: "The keys live in one isolated signer that does three things only: lock, release, refund. No agent can reach it." },
  { icon: SlidersHorizontal, title: "A person sets the limits", text: "The most for one deal, the most in one day, and which suppliers are approved. Agents can read them, never change them." },
  { icon: ShieldCheck, title: "A bouncer reads every message first", text: "A supplier's message is screened before any agent sees it. A message that tries to steer the agent or change the wallet is stopped, and the supplier is carded." },
  { icon: KeyRound, title: "Two keys to release", text: "Rules check the paperwork against the order, then a second, independent AI check. A person, the inspector, confirms the shipment. A failed rule can never be overruled." },
  { icon: RotateCcw, title: "The refund does not depend on anyone", text: "If the checks are not passed by the deadline, the ledger itself lets the money go back. Nobody has to agree." },
  { icon: Landmark, title: "The lock is the ledger's own", text: "Escrow is built into the XRP Ledger. There is no bank in the middle and no contract code to trust." },
  { icon: Eye, title: "Anyone can check it", text: "Every lock, release and refund is a public transaction. The escrow ledger links each one to the explorer." },
];

export function HowSurety() {
  return (
    <div className="tw flex flex-col gap-3.5 text-foreground">
      <header className="glass flex flex-col gap-1.5 rounded-xl px-5 py-4">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">How Surety works</h1>
        <p className="m-0 text-base text-muted-foreground">The ledger is the vault. Surety is the referee. Your AI agents can buy for your business, and cannot steal from it.</p>
      </header>

      <section className="glass flex flex-col gap-3 rounded-xl p-4" aria-label="What happens to the money">
        <h2 className="m-0 text-base font-semibold">What happens to the money</h2>
        <ol className="m-0 flex list-none flex-wrap gap-2.5 p-0">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex min-w-44 flex-1 flex-col gap-1.5 rounded-xl border border-solid bg-background/60 p-3.5">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
                {i + 1}
              </span>
              <strong className="text-[0.95rem] font-semibold">{s.title}</strong>
              <span className="text-sm leading-relaxed text-muted-foreground">{s.text}</span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-sm text-muted-foreground">A purchase locks only its own amount, once, for the one supplier you said yes to. Nothing is locked while the agents negotiate.</p>
      </section>

      <section className="glass flex flex-col gap-3 rounded-xl p-4" aria-label="What makes it safe">
        <h2 className="m-0 text-base font-semibold">What makes it safe</h2>
        <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
          {SAFE.map((s) => (
            <li key={s.title} className="flex min-w-64 flex-1 items-start gap-3 rounded-xl border border-solid bg-background/60 p-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground" aria-hidden="true">
                <s.icon className="size-[1.125rem]" />
              </span>
              <span className="flex flex-col gap-1">
                <strong className="text-[0.95rem] font-semibold">{s.title}</strong>
                <span className="text-sm leading-relaxed text-muted-foreground">{s.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="glass flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl p-4" aria-label="See it for yourself">
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <h2 className="m-0 text-base font-semibold">See it for yourself</h2>
          <p className="m-0 text-sm text-muted-foreground">Four real test purchases are recorded here: two paid, two refunded. Every transaction opens on the public XRP Ledger explorer.</p>
        </div>
        <a href="#/admin/ledger" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground no-underline hover:bg-money">
          Open the escrow ledger
        </a>
        <a href="#/admin" className="inline-flex min-h-11 items-center rounded-full border border-solid px-5 text-sm font-semibold text-foreground no-underline hover:bg-accent">
          One purchase, step by step
        </a>
      </section>

      <p className="glass m-0 rounded-xl px-4 py-3 text-sm text-muted-foreground">
        <strong className="font-semibold text-foreground">What is not real yet.</strong> This runs on the XRP Ledger test network with a test dollar that has no value. The approved-supplier list is a demo list, not an identity check. The inspector is a stand-in role.
      </p>
    </div>
  );
}
