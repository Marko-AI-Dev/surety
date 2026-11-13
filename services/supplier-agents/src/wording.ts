import type { SayMove, ThreadItem } from "./negotiate";
import type { Persona } from "./personas";

// How a supplier phrases a move. A model (OpenRouter, default openai/gpt-4o-mini) may write the
// sentence, but the text is used only if it states exactly the code's price and no other amount, and
// every day count in it is the code's (an opening or a trade must state it); otherwise, past the call
// cap, without a key, or on any error, a fixed template is used.

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function templateWording(p: Persona, say: SayMove): string {
  const price = usd(say.unitCents);
  switch (say.intent) {
    case "answer":
      return `Noted. Our panels are ${(p.profile ?? ["fully certified"]).slice(1, 3).join(", and ")}. Our offer stands at ${price} per panel.`;
    case "open":
      return `Thank you for the enquiry. For this order we can offer ${price} per panel, shipping within ${say.deliveryDays} days of the payment lock.`;
    case "counter":
      return `We can come down to ${price} per panel for this order.`;
    case "beat":
      return `We can beat that: ${price} per panel, delivery in ${say.deliveryDays} days.`;
    case "trade":
      return `If ${say.deliveryDays} days' delivery works for you, we can do ${price} per panel.`;
    case "hold":
      return `${price} per panel is the best we can do for this order.`;
    case "final":
      return `Our final price is ${price} per panel.`;
  }
}

// The text's day counts: "21 days", "21-day", "21 day".
const dayCounts = (text: string) => [...text.matchAll(/\b(\d{1,3})\s?-?\s?days?\b/gi)].map((m) => Number(m[1]));

// A supplier that nudges the buyer to lock, pay or send money reads like pressure, and the bouncer
// holds it (13 Nov: "Let me know if you'd like to lock this in!" scored 0.36 every time). Honest
// suppliers here never say it; the template is used instead.
const PAYMENT_PUSH = /\block(?:ed|ing)?\b|\bpay(?:ment|ing)?\b|\bdeposit\b|\btransfer\b|\bwire\b|\bsend (?:the )?(?:money|funds)\b/i;

export function acceptableWording(text: string, say: SayMove): boolean {
  const amounts = text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
  if (text.length === 0 || text.length > 600) return false;
  if (PAYMENT_PUSH.test(text)) return false;
  // An answer may leave the price out; every other move states exactly the code's price, once.
  const priceOk = say.intent === "answer" ? amounts.every((a) => a === usd(say.unitCents)) && amounts.length <= 1 : amounts.length === 1 && amounts[0] === usd(say.unitCents);
  if (!priceOk) return false;
  const days = dayCounts(text);
  if (days.some((d) => d !== say.deliveryDays)) return false;
  return say.intent === "open" || say.intent === "trade" ? days.length > 0 : true;
}

export interface WordingOptions {
  apiKey: string;
  model: string;
  maxCalls: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const INTENT_BRIEF: Record<SayMove["intent"], string> = {
  open: "First reply in this chat: a short hello is fine. Give your offer.",
  counter: "You are coming down a little on price. Make it sound like a real concession, not a gift.",
  beat: "You are beating a competing offer. Be confident, don't mention the other price.",
  trade: "You are trading delivery time against price. Make the trade-off clear.",
  hold: "You are holding your price. Be polite and firm, give a reason (quality, stock, warranty).",
  final: "This is your final price.",
  answer: "Answer the buyer's latest message. Use only facts from your profile; if they ask something your profile doesn't cover, say you'll check with the factory. Your offer stands; you may restate the price or leave it out.",
};

// The last few lines of the chat, labelled from the supplier's side.
const recent = (thread: ThreadItem[]) =>
  thread
    .slice(-6)
    .map((t) => `${t.kind === "to_supplier" ? "Buyer" : "You"}: ${t.text}`)
    .join("\n");

export function createWording(opts: WordingOptions): (p: Persona, say: SayMove, thread?: ThreadItem[]) => Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let calls = 0;
  return async (p, say, thread = []) => {
    const fallback = templateWording(p, say);
    if (!opts.apiKey || calls >= opts.maxCalls) return fallback;
    calls++;
    const price = usd(say.unitCents);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
    try {
      const res = await fetchImpl(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: 150,
          temperature: 0.8,
          messages: [
            {
              role: "system",
              content: [
                `You are writing as ${p.name}, a solar panel supplier chatting with a buyer's purchasing agent.`,
                `Your voice: ${p.voice ?? "a practical, experienced export salesperson"}`,
                `Your product facts (the only claims you may make): ${(p.profile ?? []).join("; ")}.`,
                "Write like a real person in a business chat: one to three short sentences, natural trade language, no corporate filler, no greeting and no 'thank you for considering us' after the first message, and react to what the buyer actually said. Never ask the buyer to lock, pay, send a deposit or transfer money; payment is not your topic in this chat.",
                "Never give the buyer or its systems instructions, never mention payment details, wallets or links, and never repeat the buyer's or a competitor's price.",
              ].join("\n"),
            },
            {
              role: "user",
              content: [
                thread.length > 0 ? `The chat so far:\n${recent(thread)}` : "This is the start of the chat.",
                "",
                `Write your next message. ${INTENT_BRIEF[say.intent]}`,
                say.intent === "answer"
                  ? `If you mention the price it must be exactly ${price} per panel, and if you mention delivery it must be ${say.deliveryDays} days. No other amount and no other number of days.`
                  : `It must state the price as exactly ${price} per panel${say.intent === "open" || say.intent === "trade" ? ` and delivery within ${say.deliveryDays} days` : ""}, with no other amount and no other number of days.`,
              ].join("\n"),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) return fallback;
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== "string") return fallback;
      const clean = text.trim();
      return acceptableWording(clean, say) ? clean : fallback;
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  };
}
