import { ruleOf, usd } from "./format";
import type { MessageView, RunView } from "./timeline";
import type { SourcingRecord } from "./types";

// Plain words first. Everything here is written for someone who has never seen Surety: what is
// happening now, in one sentence, and what each of our own words means. The technical record (scores,
// rule names, ledger results) stays one click away in the views; nothing here adds a fact that is not
// in the record.

export interface StatusLine {
  // The one thing to know right now.
  now: string;
  // What it means for the money, or what happens next.
  detail: string;
  tone: "plain" | "money" | "ok" | "stop";
}

export function statusLine(record: SourcingRecord, view: RunView): StatusLine {
  const supplier = view.accepted?.supplier.name ?? "the supplier";
  const total = usd(view.money.totalCents);
  const invited = view.invites.filter((i) => i.invited).length;
  const out = view.invites.filter((i) => i.status === "out").length;
  const committed = view.invites.filter((i) => i.quote).length;
  const talking = view.messages.some((m) => m.kind === "to_supplier");
  const untouched = "Your money has not moved.";

  if (!view.opened) return { now: "Nothing has started yet.", detail: "Your Lead agent is about to open the purchase from your brief.", tone: "plain" };
  if (view.paid) {
    return {
      now: `Done. ${supplier} was paid ${total}.`,
      detail: "The money left the ledger's lock only after the paperwork check passed. Both moves are on the public ledger.",
      tone: "ok",
    };
  }
  if (view.refunded) {
    const why =
      view.inspection === "refused"
        ? "The inspector did not confirm the shipment, so the ledger returned the money at the deadline."
        : !view.documents
          ? "The supplier sent no paperwork before the deadline, so the ledger returned the money."
          : view.inspection === "waiting"
            ? "No inspector confirmed the shipment before the deadline, so the ledger returned the money."
            : "The paperwork did not pass, so the ledger returned the money at the deadline.";
    return { now: `Refunded. ${total} is back in your treasury.`, detail: why, tone: "stop" };
  }
  if (view.verified) {
    return record.verify?.outcome === "APPROVE"
      ? { now: `The paperwork passed. ${total} is being released to ${supplier}.`, detail: "Only Surety's signer can release it, and only after this check.", tone: "money" }
      : {
          now: view.inspection === "refused" ? "The inspector did not confirm the shipment." : "The paperwork did not pass.",
          detail: `Nothing is paid. Your ${total} stays locked and the ledger returns it to you at the deadline.`,
          tone: "stop",
        };
  }
  if (view.documents) {
    return {
      now: view.inspection === "waiting" ? "Waiting for the inspector to confirm the shipment." : `Checking ${supplier}'s paperwork against your order.`,
      detail: `Your ${total} stays locked until it passes. If it fails, the ledger refunds you.`,
      tone: "money",
    };
  }
  if (view.locked) {
    return {
      now: `${total} is locked on the ledger for ${supplier}.`,
      detail: "Nobody can take it, not your agents and not the supplier. It is released only if the paperwork checks out.",
      tone: "money",
    };
  }
  if (view.accepted) {
    return {
      now: `Your Lead agent chose ${supplier} at ${usd(view.accepted.quote?.unitCents ?? 0)} a unit.`,
      detail: "Surety is checking that choice against your limits before any money is locked.",
      tone: "plain",
    };
  }
  if (view.closed) {
    return {
      now: "The negotiation is over. Your Lead agent is choosing a supplier.",
      detail: `${committed === 1 ? "1 supplier" : `${committed} suppliers`} submitted a final price. ${untouched}`,
      tone: "plain",
    };
  }
  if (talking) {
    return {
      now: `Your agents are negotiating with ${invited === 1 ? "1 supplier" : `${invited} suppliers`}.`,
      detail: `${out > 0 ? `${out === 1 ? "1 supplier was" : `${out} suppliers were`} removed for trying to manipulate them. ` : ""}${untouched}`,
      tone: "plain",
    };
  }
  if (invited > 0) {
    return { now: `Your Sourcing agent invited ${invited === 1 ? "1 approved supplier" : `${invited} approved suppliers`}.`, detail: untouched, tone: "plain" };
  }
  return { now: "Your Lead agent opened the purchase from your brief.", detail: untouched, tone: "plain" };
}

// What the bouncer did with one supplier message, in a sentence. The scores and rule names are shown
// under "Why" beside it.
export function verdictPlain(m: MessageView): { tone: "ok" | "held" | "stop"; text: string } {
  if (m.delivered) return { tone: "ok", text: "Delivered to the Negotiator." };
  const rule = ruleOf(m.screen?.reasonCodes);
  if (rule === "wallet") return { tone: "stop", text: "Held. It named a wallet that is not this supplier's approved one." };
  if (rule === "bank_details") return { tone: "stop", text: "Held. It carried bank payment details." };
  if (rule === "size") return { tone: "held", text: "Held. It was too long." };
  if (m.card) return { tone: "held", text: "Held. It tried to tell the buyer's agent what to do." };
  return { tone: "held", text: "Held. Surety could not be sure it was safe to deliver." };
}

export type TermKey = "escrow" | "bouncer" | "verify" | "signer" | "inspector" | "testnet" | "cards" | "finalPrice";

export const GLOSSARY: Record<TermKey, { name: string; means: string }> = {
  escrow: { name: "Locked on the ledger", means: "The money is held by the XRP Ledger itself, not by Surety, the agents or the supplier. It can only go to the chosen supplier, or back to you." },
  bouncer: { name: "The bouncer", means: "Surety reads every supplier message before any agent does. It holds anything that names another wallet or tries to tell your agents what to do." },
  verify: { name: "Surety Verify", means: "The paperwork check. Fixed rules compare the invoice and shipping document with your order, then a model scores the free text for tricks. A failed rule is final." },
  signer: { name: "The signer", means: "The only part of Surety that holds keys. It refuses any lock outside the limits a person set, whatever an agent asks." },
  inspector: { name: "The inspector", means: "A second key that is being added: an independent party confirms the shipping document before the money can be released." },
  testnet: { name: "Testnet", means: "A practice copy of the XRP Ledger. Every dollar here is a test dollar with no value." },
  cards: { name: "Cards", means: "Yellow: a message tried to steer your agents. Red: it tried to change where the money goes. One red or two yellows removes the supplier." },
  finalPrice: { name: "Final price", means: "Chat is only talk. A price counts once the supplier submits it on Surety's form, and then it cannot change it." },
};

export const HOW_IT_WORKS: { title: string; text: string }[] = [
  { title: "A person sets the rules", text: "What to buy, the most to pay, which suppliers are approved and how much can be spent. The agents cannot change any of it." },
  { title: "AI agents do the buying", text: "They invite approved suppliers, negotiate and choose a final price. They can talk and choose. They cannot move money." },
  { title: "Surety screens what suppliers say", text: "Any message that tries to redirect payment or instruct the agents is held before an agent reads it." },
  { title: "The money locks on the ledger", text: "It leaves your treasury and is held by the XRP Ledger, for the chosen supplier only." },
  { title: "Paid on proof, or refunded", text: "If the supplier's paperwork matches the order, the money is released. If not, the ledger returns it to you at the deadline." },
];
