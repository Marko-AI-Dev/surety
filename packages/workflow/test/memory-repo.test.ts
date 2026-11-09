import { createMemoryRepo } from "../src/index";
import { describeDealsRepo } from "./deal-repo-contract";
import { describeRepo } from "./repo-contract";

describeRepo("in-memory", async () => createMemoryRepo());
describeDealsRepo("in-memory", async () => createMemoryRepo());
