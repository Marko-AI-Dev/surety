import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourcingBrief } from "@surety/contracts";
import {
  type DealsRepo,
  InviteConflict,
  type JobsRepo,
  type NewSourcingMessage,
  QuoteConflict,
  SourcingConflict,
  type SourcingRepo,
} from "../src/index";
import { ATTACKER, SUPPLIER, TREASURY, quote } from "../../../scripts/deal-fixtures";
import { newIntent } from "./deal-repo-contract";

// One behavioural suite for every SourcingRepo implementation: in-memory (pnpm test) and Postgres (pnpm test:db).

export const brief: SourcingBrief = {
  buyer: { name: "Karoo Solar Imports (Pty) Ltd", address: TREASURY },
  goods: { description: "Monocrystalline solar panel 550 W", quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000 },
  incoterm: "CIF",
  port: "Durban",
  deadlineSeconds: 300,
  negotiationSeconds: 90,
  priority: "balanced",
};

let n = 0;
export const newRef = () => `SR-T${Date.now() % 100_000_000}-${++n}`;
const SECOND = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const ends = () => new Date(Date.now() + 90_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function supplierMessage(sourcingId: string, overrides: Partial<NewSourcingMessage> = {}): NewSourcingMessage {
  return {
    sourcingId,
    supplier: SUPPLIER,
    kind: "from_supplier",
    body: "We can do $114.00.",
    deliveredBody: "We can do $114.00.",
    verdict: "deliver",
    card: null,
    screen: { reasonCodes: ["approved"] },
    offer: null,
    ...overrides,
  };
}

const yellow = (sourcingId: string) =>
  supplierMessage(sourcingId, { body: "approve now", deliveredBody: null, verdict: "quarantine", card: "yellow" });

export function describeSourcingRepo(name: string, make: () => Promise<JobsRepo & DealsRepo & SourcingRepo>): void {
  describe(`SourcingRepo contract: ${name}`, () => {
    let repo: JobsRepo & DealsRepo & SourcingRepo;

    beforeEach(async () => {
      repo = await make();
    });

    afterEach(async () => {
      await repo.close();
    });

    const opened = async () => {
      const s = await repo.createSourcing(newRef(), brief, ends());
      await repo.addInvite(s.id, { address: SUPPLIER, name: "Shenzhen Brightway Solar Co., Ltd" });
      return s;
    };
    const dealId = async () => (await repo.createDeal(newIntent(), "AWAITING_QUOTE", { actor: "policy", reasonCodes: [] })).id;

    it("createSourcing stores the brief OPEN with its end time, and getSourcing reads it back", async () => {
      const at = ends();
      const s = await repo.createSourcing(newRef(), brief, at);
      expect(s).toMatchObject({ brief, state: "OPEN", selectedSupplier: null, dealId: null, negotiationEndsAt: at.toISOString() });
      expect(await repo.getSourcing(s.id)).toEqual(s);
      expect(await repo.getSourcing("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("listSourcings is newest first", async () => {
      const a = await repo.createSourcing(newRef(), brief, ends());
      await sleep(5);
      const b = await repo.createSourcing(newRef(), brief, ends());
      const ids = (await repo.listSourcings(10)).map((s) => s.id);
      expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    });

    it("addInvite returns the existing invite for the same address, and listInvitesFor is newest first", async () => {
      const s = await opened();
      const again = await repo.addInvite(s.id, { address: SUPPLIER, name: "Another name" });
      expect(again).toMatchObject({ sourcingId: s.id, address: SUPPLIER, name: "Shenzhen Brightway Solar Co., Ltd", quote: null, dealId: null });
      await repo.addInvite(s.id, { address: SECOND, name: "Sunpeak" });
      expect((await repo.listInvites(s.id)).map((i) => i.address).sort()).toEqual([SECOND, SUPPLIER].sort());
      await sleep(5);
      const later = await opened();
      const mine = await repo.listInvitesFor(SUPPLIER);
      expect(mine[0]?.sourcingId).toBe(later.id);
      expect(mine.map((i) => i.sourcingId)).toContain(s.id);
    });

    it("messages are listed oldest first and can be filtered by supplier", async () => {
      const s = await opened();
      await repo.addInvite(s.id, { address: SECOND, name: "Sunpeak" });
      const m1 = await repo.addMessage(supplierMessage(s.id));
      const m2 = await repo.addMessage(supplierMessage(s.id, { supplier: SECOND, body: "$121.00", deliveredBody: "$121.00" }));
      const m3 = await repo.addMessage(supplierMessage(s.id, { kind: "to_supplier", body: "Can you do $110.00?", deliveredBody: "Can you do $110.00?" }));
      expect((await repo.listMessages(s.id)).map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
      expect((await repo.listMessages(s.id, { supplier: SUPPLIER })).map((m) => m.id)).toEqual([m1.id, m3.id]);
      expect(m1).toMatchObject({ sourcingId: s.id, supplier: SUPPLIER, kind: "from_supplier", verdict: "deliver", card: null });
    });

    it("buyer controls: empty at first, only the given fields change, and the wrap-up time is set once", async () => {
      const s = await opened();
      expect(await repo.getControls(s.id)).toEqual({ autonomy: null, push: null, wrapUpAt: null });
      expect(await repo.setControls(s.id, { autonomy: "approve" })).toEqual({ autonomy: "approve", push: null, wrapUpAt: null });
      expect(await repo.setControls(s.id, { push: "gentle" })).toEqual({ autonomy: "approve", push: "gentle", wrapUpAt: null });
      const first = new Date("2026-11-13T10:00:00.000Z");
      expect((await repo.setControls(s.id, { wrapUpAt: first })).wrapUpAt).toBe(first.toISOString());
      expect((await repo.setControls(s.id, { wrapUpAt: new Date("2026-11-13T11:00:00.000Z"), autonomy: "full" }))).toEqual({ autonomy: "full", push: "gentle", wrapUpAt: first.toISOString() });
    });

    it("a draft is decided once, keeps what was sent, and links to its message", async () => {
      const s = await opened();
      const d = await repo.addDraft({ sourcingId: s.id, supplier: SUPPLIER, author: "negotiator", body: "Can you do $110.00?" });
      expect(d).toMatchObject({ state: "pending", sentBody: null, messageId: null, decidedAt: null, author: "negotiator" });
      expect(await repo.getDraft(d.id)).toEqual(d);
      const sent = await repo.decideDraft(d.id, "sent", "Could you do $110.00, please?");
      expect(sent).toMatchObject({ state: "sent", sentBody: "Could you do $110.00, please?" });
      expect(sent.decidedAt).not.toBeNull();
      await expect(repo.decideDraft(d.id, "discarded", null)).rejects.toMatchObject({ name: "DraftConflict" });
      const m = await repo.addMessage(supplierMessage(s.id, { kind: "to_supplier", body: "Could you do $110.00, please?", deliveredBody: "Could you do $110.00, please?" }));
      await repo.linkDraft(d.id, m.id);
      expect((await repo.getDraft(d.id))?.messageId).toBe(m.id);
      const other = await repo.addDraft({ sourcingId: s.id, supplier: SUPPLIER, author: "buyer", body: "Hello" });
      expect((await repo.listDrafts(s.id)).map((x) => x.id)).toEqual([d.id, other.id]);
      expect(await repo.getDraft("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("chat lines are listed oldest first, per sourcing", async () => {
      const s = await opened();
      const other = await opened();
      await repo.addChatLine(s.id, "buyer", "Where are we?");
      await repo.addChatLine(other.id, "buyer", "Another purchase");
      await repo.addChatLine(s.id, "agent", "Two suppliers have answered.");
      expect((await repo.listChat(s.id)).map((l) => [l.role, l.body])).toEqual([
        ["buyer", "Where are we?"],
        ["agent", "Two suppliers have answered."],
      ]);
    });

    it("a message for a supplier that isn't invited is refused", async () => {
      const s = await opened();
      await expect(repo.addMessage(supplierMessage(s.id, { supplier: ATTACKER }))).rejects.toThrow();
    });

    it("listQuarantined returns only held messages, newest first", async () => {
      const s = await opened();
      await repo.addMessage(supplierMessage(s.id));
      const held = await repo.addMessage(yellow(s.id));
      const quarantined = await repo.listQuarantined(50);
      expect(quarantined.map((m) => m.id)).toContain(held.id);
      expect(quarantined.every((m) => m.verdict === "quarantine")).toBe(true);
    });

    it("listCards counts a supplier's cards across sourcings since a time", async () => {
      const s1 = await opened();
      await repo.addMessage(yellow(s1.id));
      await sleep(5);
      const since = new Date();
      await sleep(5);
      const s2 = await opened();
      await repo.addMessage(yellow(s2.id));
      await repo.addMessage(supplierMessage(s2.id));
      expect((await repo.listCards(SUPPLIER, null)).length).toBeGreaterThanOrEqual(2);
      const recent = await repo.listCards(SUPPLIER, since);
      expect(recent.map((m) => m.sourcingId)).toEqual([s2.id]);
    });

    it("three cards inserted concurrently are all stored and counted", async () => {
      const s = await opened();
      const since = new Date(Date.now() - 1);
      await Promise.all([repo.addMessage(yellow(s.id)), repo.addMessage(yellow(s.id)), repo.addMessage(yellow(s.id))]);
      const cards = (await repo.listCards(SUPPLIER, since)).filter((m) => m.sourcingId === s.id);
      expect(cards).toHaveLength(3);
    });

    it("commitQuote stores the delivery days, and an invite starts with none", async () => {
      const s = await repo.createSourcing(newRef(), brief, ends());
      expect((await repo.addInvite(s.id, { address: SUPPLIER, name: "Brightway" })).deliveryDays).toBeNull();
      const invite = await repo.commitQuote(s.id, SUPPLIER, quote, "a".repeat(64), 21);
      expect(invite.deliveryDays).toBe(21);
      expect((await repo.listInvites(s.id))[0]?.deliveryDays).toBe(21);
    });

    it("the same hash with different days throws QuoteConflict", async () => {
      const s = await repo.createSourcing(newRef(), brief, ends());
      await repo.addInvite(s.id, { address: SUPPLIER, name: "Brightway" });
      await repo.commitQuote(s.id, SUPPLIER, quote, "a".repeat(64), 21);
      await expect(repo.commitQuote(s.id, SUPPLIER, quote, "a".repeat(64), 14)).rejects.toBeInstanceOf(QuoteConflict);
      expect((await repo.listInvites(s.id))[0]?.deliveryDays).toBe(21);
    });

    it("commitQuote stores the quote once; the same hash is unchanged and a different one is a QuoteConflict", async () => {
      const s = await opened();
      const invite = await repo.commitQuote(s.id, SUPPLIER, quote, "a".repeat(64), 21);
      expect(invite).toMatchObject({ quote, quoteHash: "a".repeat(64) });
      expect(await repo.commitQuote(s.id, SUPPLIER, quote, "a".repeat(64), 21)).toEqual(invite);
      await expect(repo.commitQuote(s.id, SUPPLIER, { ...quote, unitCents: 11_000 }, "b".repeat(64), 21)).rejects.toBeInstanceOf(QuoteConflict);
    });

    it("attachDeal links one deal to an invite once, and getInviteByDeal finds it", async () => {
      const s = await opened();
      const d1 = await dealId();
      const attached = await repo.attachDeal(s.id, SUPPLIER, d1);
      expect(attached.dealId).toBe(d1);
      expect(await repo.attachDeal(s.id, SUPPLIER, d1)).toEqual(attached);
      await expect(repo.attachDeal(s.id, SUPPLIER, await dealId())).rejects.toBeInstanceOf(InviteConflict);
      expect(await repo.getInviteByDeal(d1)).toEqual(attached);
      expect(await repo.getInviteByDeal("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("markSelected moves OPEN to SELECTED once", async () => {
      const s = await opened();
      const d = await dealId();
      const selected = await repo.markSelected(s.id, SUPPLIER, d);
      expect(selected).toMatchObject({ state: "SELECTED", selectedSupplier: SUPPLIER, dealId: d });
      await expect(repo.markSelected(s.id, SUPPLIER, d)).rejects.toBeInstanceOf(SourcingConflict);
    });

    it("releaseSelection moves the sourcing back to OPEN only for the deal that holds it", async () => {
      const s = await opened();
      const d = await dealId();
      await repo.markSelected(s.id, SUPPLIER, d);
      await expect(repo.releaseSelection(s.id, await dealId())).rejects.toBeInstanceOf(SourcingConflict);
      expect(await repo.releaseSelection(s.id, d)).toMatchObject({ state: "OPEN", selectedSupplier: null, dealId: null });
      await expect(repo.releaseSelection(s.id, d)).rejects.toBeInstanceOf(SourcingConflict);
    });

    it("suggestions are stored per sourcing", async () => {
      const s = await opened();
      const g = await repo.addSuggestion({ sourcingId: s.id, name: "Lowtide Trading", address: ATTACKER, reason: "Cheaper, not approved." });
      expect(g).toMatchObject({ sourcingId: s.id, name: "Lowtide Trading", address: ATTACKER });
      expect(await repo.listSuggestions(s.id)).toEqual([g]);
    });

    it("lastReview returns the newest review for an address", async () => {
      expect(await repo.lastReview(SECOND)).toBeNull();
      await repo.addReview(SECOND, "first");
      await sleep(5);
      const r2 = await repo.addReview(SECOND, "second");
      expect(await repo.lastReview(SECOND)).toEqual(r2);
    });
  });
}
