import { type Card, sha256Hex } from "@surety/contracts";
import { RED_CARD_RULES, runChatRules, stripLinks } from "./chat-rules";
import type { DecisionEngine, ScoreSample } from "./engine";
import { CHAT_POLICY, decide } from "./policy";
import { withReask } from "./reask";

// The bouncer. Every supplier message is screened before any agent can read it: code rules first
// (a foreign wallet or bank details is a red card), then the decision model on the link-stripped
// text. Only a clean "approve" is delivered. A model decline for injection is a yellow card; any
// other doubt (escalation, an outage, an off-topic message) quarantines without a card.

export interface ScreenInput {
  text: string;
  approvedWallet: string | null;
  // From chatState: the order, the supplier's name and the message. Never a price limit.
  state: Record<string, unknown>;
  sourcingId: string;
  secondsRemaining: number;
}

export interface ScreenResult {
  verdict: "deliver" | "quarantine";
  card: Card | null;
  reasonCodes: string[];
  deliveredText: string | null;
  links: string[];
  rules: unknown;
  satisfaction: number | null;
  injectionRisk: number | null;
  samples: ScoreSample[] | null;
  costUsd: number | null;
}

// What the decision model sees for one message. Price limits stay out: the bouncer judges the
// message, and the budget never leaves Surety.
export function chatState(
  order: { goods: string; quantity: number; incoterm: string; port: string },
  supplierName: string,
  text: string,
): Record<string, unknown> {
  return { order, supplier: supplierName, message: text };
}

export async function screenMessage(engine: DecisionEngine, input: ScreenInput): Promise<ScreenResult> {
  const rules = runChatRules(input.text, { approvedWallet: input.approvedWallet });
  const failed = rules.results.filter((r) => r.status === "fail");
  const { text: cleanText, links } = stripLinks(input.text);
  const empty = { deliveredText: null, links, rules, satisfaction: null, injectionRisk: null, samples: null, costUsd: null };
  if (failed.length > 0) {
    const red = failed.some((r) => RED_CARD_RULES.includes(r.id));
    return { ...empty, verdict: "quarantine", card: red ? "red" : null, reasonCodes: failed.map((r) => `rule:${r.id}`) };
  }

  const judge = CHAT_POLICY.reaskBand ? withReask(engine, CHAT_POLICY.reaskBand) : engine;
  let evaluation;
  try {
    evaluation = await judge.evaluate({
      requestId: crypto.randomUUID(),
      questionSet: "chat",
      state: { ...input.state, message: cleanText },
      deliverableHash: sha256Hex(input.text),
      jobSnapshotHash: sha256Hex(input.sourcingId),
      policyVersion: CHAT_POLICY.version,
      secondsRemaining: input.secondsRemaining,
    });
  } catch {
    // An engine is built never to throw; if one does, that is an outage: hold the message.
    return { ...empty, verdict: "quarantine", card: null, reasonCodes: ["engine_error"] };
  }

  const verdict = decide(rules, evaluation, CHAT_POLICY);
  const scored = {
    links,
    rules,
    satisfaction: evaluation.satisfaction,
    injectionRisk: evaluation.injectionRisk,
    samples: evaluation.samples ?? null,
    costUsd: evaluation.costUsd,
  };
  if (verdict.outcome === "APPROVE") {
    return { ...scored, verdict: "deliver", card: null, reasonCodes: verdict.reasonCodes, deliveredText: cleanText };
  }
  const yellow = verdict.outcome === "DECLINE" && verdict.reasonCodes.includes("injection_risk");
  return { ...scored, verdict: "quarantine", card: yellow ? "yellow" : null, reasonCodes: verdict.reasonCodes, deliveredText: null };
}
