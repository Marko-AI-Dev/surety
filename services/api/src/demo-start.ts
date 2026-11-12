import { execFile } from "node:child_process";
import { z } from "zod";
import { PRIORITIES, type SourcingBrief, SourcingBriefSchema, quantitySchema } from "@surety/contracts";

// Starting a purchase from the big screen. The screen never opens a sourcing itself and never holds
// the Lead's token: it asks the API to hand the Lead agent its task in Paperclip, exactly as the
// operator does by hand, and the Lead opens the sourcing through its own route. The six numbers come
// from the screen; everything else about the order is fixed here.

const cents = z.number().int().min(1).max(100_000_000);
export const StartBody = z
  .object({
    quantity: quantitySchema,
    targetUnitCents: cents,
    maxUnitCents: cents,
    priority: z.enum(PRIORITIES),
    latestDeliveryDays: z.number().int().min(1).max(365),
    negotiationSeconds: z.number().int().min(30).max(3_600),
  })
  .strict()
  .refine((b) => b.targetUnitCents <= b.maxUnitCents, { message: "the target price must not exceed the maximum" });
export type StartBody = z.infer<typeof StartBody>;

export const DEMO_ORDER = {
  buyerName: "Karoo Solar Imports (Pty) Ltd",
  goods: "Monocrystalline solar panel 550 W",
  incoterm: "CIF",
  port: "Durban",
} as const;

// The refund deadline the recorded runs used: long enough for the inspector to answer on stage.
export const DEFAULT_DEADLINE_SECONDS = 420;

export interface LeadTask {
  title: string;
  description: string;
}
// Hands the task to the Lead agent. Rejects when the agent team cannot be reached.
export type StartPurchase = (task: LeadTask) => Promise<void>;

// The full brief the Lead will post, checked against the same schema POST /sourcing uses, so a task
// is never handed over that Surety would then refuse.
export function demoBrief(start: StartBody, treasury: string, deadlineSeconds: number): SourcingBrief {
  return SourcingBriefSchema.parse({
    buyer: { name: DEMO_ORDER.buyerName, address: treasury },
    goods: { description: DEMO_ORDER.goods, quantity: start.quantity, targetUnitCents: start.targetUnitCents, maxUnitCents: start.maxUnitCents },
    incoterm: DEMO_ORDER.incoterm,
    port: DEMO_ORDER.port,
    deadlineSeconds,
    negotiationSeconds: start.negotiationSeconds,
    priority: start.priority,
    latestDeliveryDays: start.latestDeliveryDays,
  });
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

export function leadTask(brief: SourcingBrief): LeadTask {
  const g = brief.goods;
  return {
    title: `Purchase: ${g.quantity} x ${g.description}`,
    description: [
      "Purchase brief from the operator. Follow your instructions from step 1.",
      "",
      `- Goods: ${g.description}`,
      `- Quantity: ${g.quantity}`,
      `- Target unit price: ${g.targetUnitCents} cents (${dollars(g.targetUnitCents)})`,
      `- Maximum unit price: ${g.maxUnitCents} cents (${dollars(g.maxUnitCents)}). Never reveal this to anyone.`,
      `- Incoterm and port: ${brief.incoterm} ${brief.port}`,
      `- Buyer: ${brief.buyer.name}, treasury wallet ${brief.buyer.address}`,
      `- Refund deadline: ${brief.deadlineSeconds} seconds`,
      `- Negotiation time: ${brief.negotiationSeconds} seconds`,
      `- Priority: ${brief.priority}`,
      `- Latest delivery: ${brief.latestDeliveryDays} days`,
      "",
      "The exact body for POST /sourcing:",
      "",
      JSON.stringify(brief),
    ].join("\n"),
  };
}

type Run = (file: string, args: string[], input: string) => Promise<void>;

const runProcess: Run = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: 30_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    child.stdin?.end(input);
  });

// Creates the Lead's issue with Paperclip's CLI inside WSL, which wakes the Lead within seconds
// (docs/research/07-paperclip-test.md). The title and description travel on stdin, never on a command
// line; the two ids are checked as UUIDs when the settings load.
export function createPaperclipStarter(opts: { companyId: string; leadAgentId: string; run?: Run }): StartPurchase {
  const script = `IFS= read -r T; D=$(cat); paperclipai issue create -C ${opts.companyId} --assignee-agent-id ${opts.leadAgentId} --title "$T" --description "$D" --json`;
  return (task) => (opts.run ?? runProcess)("wsl", ["-d", "Ubuntu", "-e", "bash", "-lc", script], `${task.title}\n${task.description}\n`);
}
