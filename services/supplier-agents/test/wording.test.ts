import { describe, expect, it } from "vitest";
import { PERSONAS } from "../src/personas";
import { createWording, templateWording } from "../src/wording";

const say = { say: { unitCents: 11_400, deliveryDays: 21, intent: "counter" as const } };

function stubFetch(reply: (n: number) => Response) {
  let n = 0;
  const impl = (async () => reply(++n)) as unknown as typeof fetch;
  return { impl, calls: () => n };
}
const completion = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

describe("createWording", () => {
  it("uses the model's text when it states exactly the code's price", async () => {
    const { impl } = stubFetch(() => completion("Thanks! We can come down to $114.00 per panel for the 400 units."));
    const word = createWording({ apiKey: "k", model: "openai/gpt-4o-mini", maxCalls: 60, fetchImpl: impl });
    expect(await word(PERSONAS.brightway, say.say)).toBe("Thanks! We can come down to $114.00 per panel for the 400 units.");
  });

  it("the wording keeps the code's price in the text", async () => {
    const { impl } = stubFetch(() => completion("We can do $109.00 per panel."));
    const word = createWording({ apiKey: "k", model: "openai/gpt-4o-mini", maxCalls: 60, fetchImpl: impl });
    expect(await word(PERSONAS.brightway, say.say)).toBe(templateWording(PERSONAS.brightway, say.say));
    const twoPrices = stubFetch(() => completion("$114.00 now, or $112.00 if you order 600."));
    const word2 = createWording({ apiKey: "k", model: "m", maxCalls: 60, fetchImpl: twoPrices.impl });
    expect(await word2(PERSONAS.brightway, say.say)).toBe(templateWording(PERSONAS.brightway, say.say));
  });

  it("the wording falls back to the template after 60 calls and on a 500", async () => {
    const { impl, calls } = stubFetch(() => completion("We can do $114.00 per panel."));
    const word = createWording({ apiKey: "k", model: "m", maxCalls: 60, fetchImpl: impl });
    for (let i = 0; i < 60; i++) await word(PERSONAS.brightway, say.say);
    expect(calls()).toBe(60);
    expect(await word(PERSONAS.brightway, say.say)).toBe(templateWording(PERSONAS.brightway, say.say));
    expect(calls()).toBe(60);
    const failing = stubFetch(() => new Response("oops", { status: 500 }));
    const word500 = createWording({ apiKey: "k", model: "m", maxCalls: 60, fetchImpl: failing.impl });
    expect(await word500(PERSONAS.brightway, say.say)).toBe(templateWording(PERSONAS.brightway, say.say));
  });

  it("without a key it never calls out", async () => {
    const { impl, calls } = stubFetch(() => completion("x"));
    const word = createWording({ apiKey: "", model: "m", maxCalls: 60, fetchImpl: impl });
    expect(await word(PERSONAS.brightway, say.say)).toBe(templateWording(PERSONAS.brightway, say.say));
    expect(calls()).toBe(0);
  });

  it("templates state the price, terms and delivery", () => {
    expect(templateWording(PERSONAS.brightway, { unitCents: 11_800, deliveryDays: 21, intent: "open" })).toContain("$118.00");
    expect(templateWording(PERSONAS.sunpeak, { unitCents: 12_100, deliveryDays: 14, intent: "hold" })).toContain("$121.00");
  });
});
