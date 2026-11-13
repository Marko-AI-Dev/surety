import { z } from "zod";
import { PRIORITIES, PUSH_LEVELS } from "@surety/contracts";

// The buyer says what it needs in plain words; this turns the words into the six numbers a purchase
// needs and asks, one plain question at a time, for whatever is missing. Code reads the obvious
// ("400 panels", "$120", "30 days"); a small model, when the API has one, fills in what code missed
// ("four hundred", "a hundred and ten bucks"). Whatever the model returns is checked like any other
// input, and a model that fails changes nothing. Nothing here opens a purchase or moves money.

export const DraftSchema = z
  .object({
    quantity: z.number().int().min(1).max(1_000_000).optional(),
    targetUnitCents: z.number().int().min(1).max(100_000_000).optional(),
    maxUnitCents: z.number().int().min(1).max(100_000_000).optional(),
    priority: z.enum(PRIORITIES).optional(),
    latestDeliveryDays: z.number().int().min(1).max(365).optional(),
    push: z.enum(PUSH_LEVELS).optional(),
  })
  .strict();
export type Draft = z.infer<typeof DraftSchema>;
export type Field = keyof Draft;

export const FIELDS: Field[] = ["quantity", "maxUnitCents", "targetUnitCents", "latestDeliveryDays", "priority", "push"];

export const IntakeBody = z
  .object({
    text: z.string().trim().min(1).max(1_000),
    draft: DraftSchema.optional(),
    // The question the buyer is answering, so a bare "120" is read as that field.
    field: z.enum(FIELDS as [Field, ...Field[]]).optional(),
  })
  .strict();

const QUESTIONS: Record<Field, string> = {
  quantity: "How many panels do you need?",
  maxUnitCents: "What is the most you will pay for one panel, in US dollars? Your team will never go above it, and the suppliers never see it.",
  targetUnitCents: "What price for one panel would you be happy with? Your negotiator aims for it.",
  latestDeliveryDays: "How soon do you need them delivered? For example, 30 days.",
  priority: "What matters most: the lowest price, the fastest delivery, or a balance of both?",
  push: "How hard should your negotiator push: gentle, or firm?",
};

const number = (s: string) => Number(s.replace(/[,\s]/g, ""));
const toCents = (dollars: number) => Math.round(dollars * 100);
const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:dollars|usd|bucks)\b/gi;
const MAX_CUE = /(max|maximum|most|no more than|not more than|up to|ceiling|limit|cap|budget)[^$\d]{0,24}$/i;
// The same cue said after the price: "$120 at most", "$120 tops".
const MAX_CUE_AFTER = /^[^$\d]{0,6}(at most|at the most|max|maximum|tops|or less)\b/i;
const TARGET_CUE = /(target|aim|aiming|around|about|ideally|hoping|happy with|prefer|roughly)[^$\d]{0,24}$/i;

function priorityOf(t: string): Draft["priority"] | undefined {
  if (/\b(balance|balanced|both|mix)\b/i.test(t)) return "balanced";
  if (/\b(fast|fastest|quick|quickest|urgent|soon|speed|asap)\b/i.test(t)) return "speed";
  if (/\b(cheap|cheapest|lowest|price|cost|save)\b/i.test(t)) return "price";
  return undefined;
}
function pushOf(t: string): Draft["push"] | undefined {
  if (/\b(gentle|gently|soft|softly|easy|polite|friendly|relationship)\b/i.test(t)) return "gentle";
  if (/\b(firm|firmly|hard|tough|aggressive|strong)\b/i.test(t)) return "firm";
  return undefined;
}
function daysOf(t: string): number | undefined {
  const m = /(\d{1,3})\s*(day|week|month)s?\b/i.exec(t);
  if (!m) return undefined;
  const days = Number(m[1]) * (m[2]?.toLowerCase() === "week" ? 7 : m[2]?.toLowerCase() === "month" ? 30 : 1);
  return days >= 1 && days <= 365 ? days : undefined;
}

// What code can read from the words alone.
export function readWords(text: string, field?: Field): Draft {
  const out: Draft = {};
  const qty = /(\d[\d,]*)\s*(?:x\s*)?(?:solar\s+|pv\s+)?(?:panel|panels|unit|units|piece|pieces|pcs|modules?)\b/i.exec(text);
  if (qty?.[1]) out.quantity = number(qty[1]);

  const prices: { cents: number; cue: "max" | "target" | null }[] = [];
  for (const m of text.matchAll(MONEY)) {
    const before = text.slice(0, m.index);
    const after = text.slice((m.index ?? 0) + m[0].length);
    prices.push({
      cents: toCents(number(m[1] ?? m[2] ?? "")),
      cue: MAX_CUE.test(before) || MAX_CUE_AFTER.test(after) ? "max" : TARGET_CUE.test(before) ? "target" : null,
    });
  }
  for (const p of prices) {
    if (p.cue === "max") out.maxUnitCents = p.cents;
    if (p.cue === "target") out.targetUnitCents = p.cents;
  }
  const bare = prices.filter((p) => p.cue === null).map((p) => p.cents).sort((a, b) => a - b);
  if (bare.length >= 2 && out.maxUnitCents === undefined && out.targetUnitCents === undefined) {
    out.targetUnitCents = bare[0];
    out.maxUnitCents = bare[bare.length - 1];
  } else if (bare.length === 1 && (field === "maxUnitCents" || field === "targetUnitCents")) {
    out[field] = bare[0];
  }

  const days = daysOf(text);
  if (days !== undefined) out.latestDeliveryDays = days;
  const priority = priorityOf(text);
  if (priority && (field === undefined || field === "priority")) out.priority = priority;
  const push = pushOf(text);
  if (push && (field === undefined || field === "push")) out.push = push;

  // A bare number answering a question is that field.
  const lone = /^\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*$/.exec(text);
  if (lone?.[1] && field) {
    const n = number(lone[1]);
    if (field === "quantity" && Number.isInteger(n)) out.quantity = n;
    if (field === "latestDeliveryDays" && Number.isInteger(n)) out.latestDeliveryDays = n;
    if (field === "maxUnitCents" || field === "targetUnitCents") out[field] = toCents(n);
  }
  const parsed = DraftSchema.safeParse(out);
  return parsed.success ? parsed.data : {};
}

export type Chat = (system: string, user: string, maxTokens: number) => Promise<string>;

const MODEL_SYSTEM = [
  "You read what a small business owner says they want to buy and return JSON only.",
  'Keys, all optional: "quantity" (whole number of solar panels), "targetUsd" (price per panel they hope for), "maxUsd" (the most they will pay per panel), "days" (delivery within this many days), "priority" ("price", "speed" or "balanced"), "push" ("gentle" or "firm").',
  "Leave out any key the person did not state. Never guess. No other text.",
].join(" ");

const ModelAnswer = z
  .object({
    quantity: z.number().optional(),
    targetUsd: z.number().optional(),
    maxUsd: z.number().optional(),
    days: z.number().optional(),
    priority: z.string().optional(),
    push: z.string().optional(),
  })
  .passthrough();

// What the model read, checked like any other input. Anything unusable is dropped.
export async function readWithModel(chat: Chat, text: string): Promise<Draft> {
  try {
    const raw = await chat(MODEL_SYSTEM, text, 150);
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const a = ModelAnswer.parse(JSON.parse(json));
    const out: Draft = {};
    for (const [key, value] of [
      ["quantity", a.quantity],
      ["targetUnitCents", a.targetUsd === undefined ? undefined : toCents(a.targetUsd)],
      ["maxUnitCents", a.maxUsd === undefined ? undefined : toCents(a.maxUsd)],
      ["latestDeliveryDays", a.days],
      ["priority", a.priority],
      ["push", a.push],
    ] as const) {
      if (value === undefined) continue;
      const one = DraftSchema.safeParse({ [key]: value });
      if (one.success) Object.assign(out, one.data);
    }
    return out;
  } catch {
    return {};
  }
}

export interface IntakeResult {
  draft: Draft;
  // The next thing to ask, or null when the six numbers are all there.
  question: { field: Field; ask: string } | null;
  ready: boolean;
  // Which reader filled the draft this turn, for the screen to be honest about.
  readBy: "code" | "code and model";
}

export async function intake(raw: unknown, chat?: Chat): Promise<IntakeResult> {
  const body = IntakeBody.parse(raw);
  const fromCode = readWords(body.text, body.field);
  // The model is asked only for a free description, never for a one-word answer to a question.
  const fromModel = chat && !body.field ? await readWithModel(chat, body.text) : {};
  // Code wins where both read something: it is the one we can test.
  const draft: Draft = { ...body.draft, ...fromModel, ...fromCode };

  if (draft.targetUnitCents !== undefined && draft.maxUnitCents !== undefined && draft.targetUnitCents > draft.maxUnitCents) {
    delete draft.targetUnitCents;
    return {
      draft,
      question: { field: "targetUnitCents", ask: "The price you hope for cannot be above the most you will pay. What price would you be happy with?" },
      ready: false,
      readBy: Object.keys(fromModel).length > 0 ? "code and model" : "code",
    };
  }
  const missing = FIELDS.find((f) => draft[f] === undefined);
  return {
    draft,
    question: missing ? { field: missing, ask: QUESTIONS[missing] } : null,
    ready: missing === undefined,
    readBy: Object.keys(fromModel).length > 0 ? "code and model" : "code",
  };
}

// The model behind the intake and the admin assistant: one small chat call through OpenRouter.
export function createOpenRouterChat(opts: { apiKey: string; model: string; fetchFn?: typeof fetch }): Chat {
  return async (system, user, maxTokens) => {
    const res = await (opts.fetchFn ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`the model answered ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("the model returned no text");
    return content;
  };
}
