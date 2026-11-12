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

describe("wording for several rounds (Phase 4d)", () => {
  const beat = { unitCents: 11_300, deliveryDays: 21, intent: "beat" as const };
  const trade = { unitCents: 10_600, deliveryDays: 35, intent: "trade" as const };
  const word = (text: string) => createWording({ apiKey: "k", model: "m", maxCalls: 60, fetchImpl: stubFetch(() => completion(text)).impl });

  it("templates for beat and trade state the price and the days", () => {
    expect(templateWording(PERSONAS.brightway, beat)).toBe("We can beat that: $113.00 per panel, delivery in 21 days.");
    expect(templateWording(PERSONAS.brightway, trade)).toBe("If 35 days' delivery works for you, we can do $106.00 per panel.");
  });

  it("a model text saying 14 days when the code says 21 falls back to the template", async () => {
    expect(await word("We can beat that with $113.00 per panel and delivery in 14 days.")(PERSONAS.brightway, beat)).toBe(templateWording(PERSONAS.brightway, beat));
    expect(await word("Sure: $113.00 per panel, a 14-day delivery.")(PERSONAS.brightway, beat)).toBe(templateWording(PERSONAS.brightway, beat));
    expect(await word("We can beat that: $113.00 per panel, delivered in 21 days.")(PERSONAS.brightway, beat)).toBe("We can beat that: $113.00 per panel, delivered in 21 days.");
  });

  it("a model text that repeats the competitor's $114.00 falls back to the template", async () => {
    expect(await word("They offered $114.00, we offer $113.00 per panel in 21 days.")(PERSONAS.brightway, beat)).toBe(templateWording(PERSONAS.brightway, beat));
  });

  it("a trade text with no days number falls back to the template", async () => {
    expect(await word("With a slower delivery we can do $106.00 per panel.")(PERSONAS.brightway, trade)).toBe(templateWording(PERSONAS.brightway, trade));
    expect(await word("With a 35-day delivery we can do $106.00 per panel.")(PERSONAS.brightway, trade)).toBe("With a 35-day delivery we can do $106.00 per panel.");
  });

  it("an open text must state the days too", async () => {
    const open = { unitCents: 11_800, deliveryDays: 21, intent: "open" as const };
    expect(await word("Thanks for asking! $118.00 per panel.")(PERSONAS.brightway, open)).toBe(templateWording(PERSONAS.brightway, open));
  });
});
