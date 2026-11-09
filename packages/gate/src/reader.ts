import type { TradeDocuments, TradeFields } from "@surety/contracts";
import { parseTradeDocuments } from "./trade-docs";

// Reads a deal's documents into fields for the trade rules. The AI verification agent (Phase 4c) is one
// reader; the template parser is the other, and rule reader_agrees requires the reader's fields to equal
// the parser's, so a misled reader can never pass documents that say something else.
export type ReadResult = { status: "ok"; fields: TradeFields } | { status: "unavailable"; reason: string };

export interface DocumentReader {
  readonly kind: "parser" | "agent";
  readonly model: string | null;
  read(docs: TradeDocuments): Promise<ReadResult>;
}

export const parserReader: DocumentReader = {
  kind: "parser",
  model: null,
  async read(docs) {
    const fields = parseTradeDocuments(docs);
    return fields ? { status: "ok", fields } : { status: "unavailable", reason: "unparseable" };
  },
};
