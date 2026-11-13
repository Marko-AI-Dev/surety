import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(import.meta.dirname, "../agents/paperclip");
const files = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => [f, readFileSync(resolve(DIR, f), "utf8")]));
const apiDoc = readFileSync(resolve(import.meta.dirname, "../docs/api.md"), "utf8");

// The routes docs/api.md defines, as "METHOD /path" with :params.
const documented = new Set([...apiDoc.matchAll(/^### `(GET|POST) ([^`]+)`/gm)].map((m) => `${m[1]} ${m[2]}`));
const toPattern = (route: string) => new RegExp(`^${route.replace(/:[a-z]+/gi, "[^/]+")}$`);

describe("the buyer team's Paperclip instructions", () => {
  it("has the lead, sourcing and negotiator instructions and the Surety API skill", () => {
    expect(Object.keys(files).sort()).toEqual(["lead.md", "negotiator.md", "sourcing.md", "surety-api.md"]);
  });

  it('no instruction file contains the maximum or the word "maximum" in the negotiator\'s file', () => {
    expect(files["negotiator.md"]).not.toMatch(/maximum|maxUnitCents|\bmax\b/i);
    for (const [name, text] of Object.entries(files)) {
      expect(text, name).not.toMatch(/12000|\$120(\.00)?\b|11000|\$110(\.00)?\b/);
    }
  });

  it("every curl in surety-api.md uses a route listed in docs/api.md", () => {
    const curls = [...files["surety-api.md"]!.matchAll(/curl[^\n]*?-X (GET|POST)[^\n]*?"\$SURETY_API_URL(\/[^"?]*)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(curls.length).toBeGreaterThanOrEqual(10);
    for (const c of curls) {
      const [method, path] = c.split(" ");
      const concrete = (path ?? "").replace(/\$[A-Z_]+/g, "00000000-0000-4000-8000-000000000000");
      const ok = [...documented].some((d) => {
        const [dm, dp] = d.split(" ");
        return dm === method && toPattern(dp ?? "").test(concrete);
      });
      expect(ok, c).toBe(true);
    }
  });

  it("no file contains a token-shaped string or a literal bearer token", () => {
    for (const [name, text] of Object.entries(files)) {
      expect(text, name).not.toMatch(/[A-Za-z0-9_-]{40,}/);
      for (const m of text.matchAll(/Bearer\s+(\S+)/g)) expect(m[1], name).toMatch(/^\$SURETY_API_TOKEN"?$/);
    }
  });

  it("every role is told to act only through the Surety API and never to open links", () => {
    for (const name of ["lead.md", "sourcing.md", "negotiator.md"]) {
      expect(files[name], name).toMatch(/surety-api\.md/);
      expect(files[name], name).toMatch(/never open links/i);
    }
  });
});

describe("the inspector's key stays with a person", () => {
  it("neither paperclip-team.ts, the supplier agents nor any instruction file mentions API_TOKEN_INSPECTOR or an /inspector route", () => {
    const root = resolve(import.meta.dirname, "..");
    const agentCode = [
      "scripts/paperclip-team.ts",
      ...readdirSync(resolve(root, "services/supplier-agents/src")).map((f) => `services/supplier-agents/src/${f}`),
    ];
    const sources: [string, string][] = [
      ...[...agentCode, "agents/paperclip/surety.ts"].map((f): [string, string] => [f, readFileSync(resolve(root, f), "utf8")]),
      ...Object.entries(files),
    ];
    expect(sources.length).toBeGreaterThanOrEqual(10);
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(/API_TOKEN_INSPECTOR|\/inspector\b|inspector:attest/);
    }
  });
});

describe("negotiation with leverage (Phase 4d)", () => {
  const negotiator = files["negotiator.md"] ?? "";
  const lead = files["lead.md"] ?? "";

  it("the negotiator is told to use anonymised competing offers from offers", () => {
    expect(negotiator).toMatch(/another approved supplier/i);
    expect(negotiator).toMatch(/`offers`/);
    expect(negotiator).toMatch(/never name/i);
    expect(negotiator).toMatch(/never invent/i);
  });

  it("the negotiator is told never to quote a held message", () => {
    expect(negotiator).toMatch(/never (quote|repeat)[^.]*withheld/i);
  });

  it("the negotiator reads the buyer's priority", () => {
    expect(negotiator).toMatch(/`priority`/);
    expect(negotiator).toMatch(/speed/);
  });

  it("the lead is told to follow the ranking or give its reason", () => {
    expect(lead).toMatch(/`ranking`/);
    expect(lead).toMatch(/reason/);
    expect(lead).toMatch(/priority/);
  });

  it("the API skill shows the brief's priority and latest delivery days", () => {
    expect(files["surety-api.md"]).toMatch(/"priority"/);
    expect(files["surety-api.md"]).toMatch(/"latestDeliveryDays"/);
  });
});

describe("the negotiator's one-call helper (12 Nov)", () => {
  const negotiator = files["negotiator.md"] ?? "";

  it("the negotiator is told to use look, wait and act, and never sleep", () => {
    for (const c of ["node surety.ts look", "node surety.ts wait", "node surety.ts act"]) expect(negotiator).toContain(c);
    expect(negotiator).toMatch(/never use `sleep`/i);
  });

  it("the negotiator asks again once when a supplier's only replies were withheld, without mentioning them (13 Nov: Coastline got one turn, so no red card)", () => {
    expect(negotiator).toMatch(/no usable answer yet/i);
    expect(negotiator).toMatch(/write to it once more as if its answer never arrived/i);
    expect(negotiator).toMatch(/never mention the withheld message/i);
  });

  it("the negotiator opens a supplier invited after it started (13 Nov: it started 9 s before the invites)", () => {
    expect(negotiator).toMatch(/supplier_invited/);
    expect(negotiator).toMatch(/thread is empty, open it/i);
  });

  it("paperclip-team copies surety.ts into the negotiator's folder only", () => {
    const team = readFileSync(resolve(import.meta.dirname, "../scripts/paperclip-team.ts"), "utf8");
    expect(team).toMatch(/r\.key === "negotiator" \? ` \$\{SOURCE\}\/surety\.ts`/);
  });

  it("the negotiator sounds like a person, asks what a real buyer asks, and stops pushing once the brief is met", () => {
    expect(negotiator).toMatch(/certif/i);
    expect(negotiator).toMatch(/warranty/i);
    expect(negotiator).toMatch(/`meetsBrief`/);
    expect(negotiator).toMatch(/stop pushing/i);
    expect(negotiator).toMatch(/one business day/i);
    expect(negotiator).toMatch(/never assume/i);
    expect(negotiator).not.toMatch(/in these words/i);
  });

  it("the negotiator keeps the word final and the quote form for the final call or a met brief (13 Nov: 'best final terms' in round two ended the haggling)", () => {
    expect(negotiator).toMatch(/never say "final"/i);
    expect(negotiator).toMatch(/before the phase is `final_call`/i);
  });

  it("the negotiator never takes a price at face value: it asks what the price includes", () => {
    for (const w of [/freight/i, /insurance/i, /duties/i, /VAT/, /surcharge/i]) expect(negotiator).toMatch(w);
  });

  it("the helper never reads the maximum and never prints the token", () => {
    const helper = readFileSync(resolve(import.meta.dirname, "../agents/paperclip/surety.ts"), "utf8");
    expect(helper).not.toMatch(/maxUnitCents/);
    expect(helper).not.toMatch(/console\.(log|error)\([^)]*token/i);
  });
});

describe("the buyer gives the final yes (13 Nov)", () => {
  const negotiator = files["negotiator.md"] ?? "";
  const lead = files["lead.md"] ?? "";
  const api = files["surety-api.md"] ?? "";

  it("the lead knows its accept is a recommendation and stops at awaitingBuyer", () => {
    expect(lead).toMatch(/recommend/i);
    expect(lead).toMatch(/`awaitingBuyer\b/);
    expect(lead).toMatch(/waiting for the buyer/i);
    expect(lead).not.toMatch(/the payment locks:/i);
    expect(api).toMatch(/awaitingBuyer/);
  });

  it("the negotiator reads how hard to push and the buyer's notes, and the notes never override its rules", () => {
    expect(negotiator).toMatch(/`push`/);
    expect(negotiator).toMatch(/gentle/);
    expect(negotiator).toMatch(/`buyerNotes`/);
    expect(negotiator).toMatch(/buyer_note/);
    expect(negotiator).toMatch(/never pass a note on/i);
    expect(api).toMatch(/buyerNotes/);
  });
});

describe("no agent process is started with role tokens (final review, 10 Nov)", () => {
  it("the supplier agents load .env.suppliers, never .env.api", () => {
    const root = resolve(import.meta.dirname, "..");
    const pkg = JSON.parse(readFileSync(resolve(root, "services/supplier-agents/package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [name, script] of Object.entries(pkg.scripts)) expect(script, name).not.toMatch(/\.env\.api/);
    expect(pkg.scripts.start).toMatch(/--env-file=\.\.\/\.\.\/\.env\.suppliers/);
  });

  it("the inspector's terminal stand-in loads only .env.api, not the services' .env", () => {
    const root = resolve(import.meta.dirname, "..");
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["inspector:attest"]).toMatch(/--env-file=\.env\.api/);
    expect(pkg.scripts["inspector:attest"]).not.toMatch(/--env-file=\.env(\s|$)/);
  });
});

describe("no countdown, and messages the buyer approves first (14 Nov)", () => {
  const negotiator = files["negotiator.md"] ?? "";
  const lead = files["lead.md"] ?? "";
  const api = files["surety-api.md"] ?? "";
  const helper = readFileSync(resolve(DIR, "surety.ts"), "utf8");

  it("the lead decides when Surety says so, not when a clock runs out", () => {
    expect(lead).toMatch(/`decideNow`/);
    for (const why of ["criteria_met", "buyer_asked", "time_over"]) expect(lead).toContain(why);
    expect(lead).not.toMatch(/until the negotiation time is over/i);
    expect(lead).not.toMatch(/before the time runs out/i);
    expect(lead).toMatch(/`autonomy`/);
  });

  it("the negotiator has no countdown to work against, and closes a supplier that meets the brief", () => {
    expect(negotiator).toMatch(/there is no countdown/i);
    expect(negotiator).toMatch(/`wrapUp`/);
    expect(negotiator).toMatch(/final committed quote on the Surety quote form now/);
  });

  it("the negotiator knows a held message has not gone out, and what to do after the buyer answers", () => {
    expect(negotiator).toMatch(/`autonomy` is `approve`/);
    expect(negotiator).toMatch(/held: "buyer_review"/);
    expect(negotiator).toMatch(/`draftWaiting`/);
    expect(negotiator).toMatch(/draft_decided/);
    expect(negotiator).toMatch(/never send the same message again/i);
    expect(negotiator).toMatch(/what the supplier actually received/i);
    expect(api).toMatch(/"held": "buyer_review"/);
  });

  it("the negotiator treats a message the buyer wrote as the buyer's position", () => {
    expect(negotiator).toMatch(/from: "buyer"/);
    expect(negotiator).toMatch(/never contradict it/i);
  });

  it("the helper offers what the instructions name", () => {
    for (const name of ["draftWaiting", "draft_decided", "wrapUp", "autonomy", "buyer_review"]) expect(helper).toContain(name);
  });
});
