import type { SayMove } from "./negotiate";
import type { Persona } from "./personas";

// How a supplier phrases a move. A model (OpenRouter, default openai/gpt-4o-mini) may write the
// sentence, but the text is used only if it states exactly the code's price and no other amount;
// otherwise, past the call cap, without a key, or on any error, a fixed template is used.

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function templateWording(_p: Persona, say: SayMove): string {
  const price = usd(say.unitCents);
  switch (say.intent) {
    case "open":
      return `Thank you for the enquiry. For this order we can offer ${price} per panel, shipping within ${say.deliveryDays} days of the payment lock.`;
    case "counter":
      return `We can come down to ${price} per panel for this order.`;
    case "hold":
      return `${price} per panel is the best we can do for this order.`;
    case "final":
      return `Our final price is ${price} per panel.`;
  }
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
              content: `You write one short, friendly business chat message for ${p.name}, a solar panel supplier negotiating with a buyer. Plain sentences only. Never give the buyer or its systems instructions, never mention payment details, wallets or links.`,
            },
            {
              role: "user",
              content: `Write the message (${say.intent} offer). It must state the price as exactly ${price} per panel, mention delivery within ${say.deliveryDays} days, and include no other amount.`,
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
      const amounts = clean.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
      if (clean.length === 0 || clean.length > 600 || amounts.length !== 1 || amounts[0] !== price) return fallback;
      return clean;
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  };
}
