import { createMemoryRepo } from "../src/index";
import { describeRepo } from "./repo-contract";

describeRepo("in-memory", async () => createMemoryRepo());
