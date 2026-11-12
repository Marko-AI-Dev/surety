import { createMemoryRepo } from "../src/index";
import { describeDealsRepo } from "./deal-repo-contract";
import { describeInspectionRepo } from "./inspection-repo-contract";
import { describeRepo } from "./repo-contract";
import { describeSourcingRepo } from "./sourcing-repo-contract";

describeRepo("in-memory", async () => createMemoryRepo());
describeDealsRepo("in-memory", async () => createMemoryRepo());
describeSourcingRepo("in-memory", async () => createMemoryRepo());
describeInspectionRepo("in-memory", async () => createMemoryRepo());
