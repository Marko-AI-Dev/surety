import { canonicalJson, sha256Hex } from "@surety/contracts";
import type { NewJob } from "./repo";

// Freezes what the buyer agreed to: payee, amount, source, criteria, policy and deadline.
export function snapshotHash(input: NewJob): string {
  const { ref, buyerAddress, sellerAddress, amountDrops, sourceText, criteria, policyVersion, cancelAfterSeconds } =
    input;
  return sha256Hex(
    canonicalJson({
      ref,
      buyerAddress,
      sellerAddress,
      amountDrops,
      sourceText,
      criteria,
      policyVersion,
      cancelAfterSeconds,
    }),
  );
}
