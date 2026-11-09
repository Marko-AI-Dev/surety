import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@surety/workflow";
import { clearSupplier } from "../scripts/clear-supplier";
import { buildDirectory } from "../scripts/supplier-directory";
import { ATTACKER, SUPPLIER } from "../scripts/deal-fixtures";

const B = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const C = "rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1";

describe("clear-supplier", () => {
  it("clear-supplier records a review", async () => {
    const repo = createMemoryRepo();
    const review = await clearSupplier(repo, SUPPLIER, "Spoke to them by phone.");
    expect(review).toMatchObject({ address: SUPPLIER, note: "Spoke to them by phone." });
    expect(await repo.lastReview(SUPPLIER)).toEqual(review);
  });

  it("refuses something that isn't an address", async () => {
    await expect(clearSupplier(createMemoryRepo(), "nope", "x")).rejects.toThrow(/address/);
  });
});

describe("buildDirectory", () => {
  it("names Brightway, Sunpeak and Coastline from the approved list, and Lowtide as the stranger", () => {
    expect(buildDirectory([B, SUPPLIER, C, "rExtra1111111111111111111111"], ATTACKER)).toEqual([
      { address: SUPPLIER, name: "Shenzhen Brightway Solar Co., Ltd", persona: "brightway" },
      { address: B, name: "Sunpeak Energy Ltd", persona: "sunpeak" },
      { address: C, name: "Coastline Trading Co.", persona: "coastline" },
      { address: ATTACKER, name: "Lowtide Trading", persona: "lowtide" },
    ]);
  });

  it("needs Brightway and two more approved suppliers", () => {
    expect(() => buildDirectory([SUPPLIER, B], ATTACKER)).toThrow(/three approved/);
    expect(() => buildDirectory([B, C, "rExtra1111111111111111111111"], ATTACKER)).toThrow(/Brightway/);
  });
});
