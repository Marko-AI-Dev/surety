import { canonicalJson, sha256Hex, wireAmount } from "@surety/contracts";
import type { NewJob } from "./repo";

// Freezes what the buyer agreed to: payee, amount, source, criteria, policy and deadline. Criteria
// text joins the hash only when present, so jobs created before it existed keep their hash. The amount
// joins in its wire form, so an XRP job hashes exactly as it did before TESTUSD existed.
export function snapshotHash(input: NewJob): string {
  const { ref, buyerAddress, sellerAddress, amount, sourceText, criteria, policyVersion, cancelAfterSeconds } = input;
  return sha256Hex(
    canonicalJson({
      ref,
      buyerAddress,
      sellerAddress,
      ...wireAmount(amount),
      sourceText,
      criteria,
      policyVersion,
      cancelAfterSeconds,
      ...(input.criteriaText === undefined ? {} : { criteriaText: input.criteriaText }),
    }),
  );
}
