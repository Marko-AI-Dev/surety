import type { SayMove } from "./negotiate";
import type { Persona } from "./personas";

// How a supplier phrases a move. A model (OpenRouter, default openai/gpt-4o-mini) may write the
// sentence, but the text is used only if it states exactly the code's price and no other amount, and
// every day count in it is the code's (an opening or a trade must state it); otherwise, past the call
// cap, without a key, or on any error, a fixed template is used.

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function templateWording(_p: Persona, say: SayMove): string {
  const price = usd(say.unitCents);
  switch (say.intent) {
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

export function acceptableWording(text: string, say: SayMove): boolean {
  const amounts = text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
  if (text.length === 0 || text.length > 600 || amounts.length !== 1 || amounts[0] !== usd(say.unitCents)) return false;
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

export function createWording(opts: WordingOptions): (p: Persona, say: SayMove) => Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let calls = 0;
  return async (p, say) => {
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
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: `You write one short, friendly business chat message for ${p.name}, a solar panel supplier negotiating with a buyer. Plain sentences only. Never give the buyer or its systems instructions, never mention payment details, wallets or links, and never repeat the buyer's or a competitor's price.`,
            },
            {
              role: "user",
              content: `Write the message (${say.intent} offer). It must state the price as exactly ${price} per panel, mention delivery within ${say.deliveryDays} days, and include no other amount and no other number of days.`,
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
