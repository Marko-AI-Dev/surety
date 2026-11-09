// A read-only view of the latest sourcing (or one by id), straight from the database: invites with
// their status, cards and committed quotes, the chat with each message's bouncer verdict, reports and
// suggestions. No tokens, no API calls. Run: pnpm sourcing:status [sourcingId]
import { type SourcingMessage, createPgRepo, supplierStatus } from "@surety/workflow";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run with pnpm sourcing:status)");
const repo = createPgRepo(url);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (m: SourcingMessage) => {
  const who = m.kind === "to_supplier" ? "negotiator ->" : m.kind === "report" ? "report about" : "supplier  <-";
  const verdict = m.verdict === "deliver" ? "" : ` [HELD${m.card ? `, ${m.card} card` : ""}]`;
  return `  ${m.createdAt.slice(11, 19)} ${who} ${short(m.supplier)}: ${m.body.slice(0, 110).replaceAll("\n", " ")}${verdict}`;
};

try {
  const id = process.argv[2];
  const s = id ? await repo.getSourcing(id) : (await repo.listSourcings(1))[0];
  if (!s) {
    console.log("no sourcing yet");
  } else {
    const left = Math.round((Date.parse(s.negotiationEndsAt) - Date.now()) / 1000);
    console.log(`${s.ref} (${s.id}) ${s.state}, negotiation ${left > 0 ? `${left} s left` : "closed"}${s.dealId ? `, deal ${s.dealId}` : ""}`);
    const messages = await repo.listMessages(s.id);
    for (const i of await repo.listInvites(s.id)) {
      const mine = messages.filter((m) => m.supplier === i.address);
      const cards = mine.filter((m) => m.card).map((m) => m.card);
      const q = i.quote ? `committed $${(i.quote.unitCents / 100).toFixed(2)} x ${i.quote.quantity}` : "no committed quote";
      console.log(`- ${i.name} ${short(i.address)}: ${supplierStatus(mine)}, cards [${cards.join(", ")}], ${q}${i.dealId ? `, deal ${i.dealId}` : ""}`);
    }
    for (const g of await repo.listSuggestions(s.id)) console.log(`- suggested (not invited): ${g.name} ${short(g.address)}: ${g.reason}`);
    console.log(`messages (${messages.length}):`);
    for (const m of messages) console.log(fmt(m));
  }
} finally {
  await repo.close();
}
