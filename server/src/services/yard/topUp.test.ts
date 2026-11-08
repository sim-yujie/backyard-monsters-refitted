import { describe, expect, test } from "bun:test";
import { topupCost } from "../base/economy/resourceBudget.js";
import { purseShortfallErr } from "./surfaceInferno.js";
import { withTopUp } from "./topUp.js";
import { yardRefusedErr } from "./yardErrors.js";

/** A plan that charges `cost` from the pool, refusing `409 shortfall` as the real plans do. */
const poolPlan = (cost: Record<"r1" | "r2" | "r3" | "r4", number>) => (save: { resources?: Record<string, unknown> | null }) => {
  const held = (key: "r1" | "r2" | "r3" | "r4") => Number(save.resources?.[key]) || 0;
  const shortfall = {
    r1: Math.max(0, cost.r1 - held("r1")),
    r2: Math.max(0, cost.r2 - held("r2")),
    r3: Math.max(0, cost.r3 - held("r3")),
    r4: Math.max(0, cost.r4 - held("r4")),
  };
  if (Object.values(shortfall).some((amount) => amount > 0)) {
    throw yardRefusedErr("shortfall", "short", { shortfall });
  }
  return { report: "started", debit: cost };
};

const COST = { r1: 1_000, r2: 500, r3: 0, r4: 0 };

const caught = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as { data: Record<string, unknown> };
  }
  throw new Error("did not refuse");
};

describe("withTopUp (Flash's BRTOPUP, BUILDINGOPTIONSPOPUP.as:642-760)", () => {
  test("without topUp it is the plan, refusals included", async () => {
    const save = { resources: { r1: 0, r2: 0, r3: 0, r4: 0 }, poolCap: 10_000 };
    const error = await caught(() => withTopUp(save, undefined, poolPlan(COST)));
    expect(error.data).toMatchObject({ reason: "shortfall", shortfall: { r1: 1_000, r2: 500 } });
  });

  test("a pool that can pay is charged as usual, the topUp ignored", async () => {
    const save = { resources: { r1: 5_000, r2: 5_000, r3: 0, r4: 0 }, poolCap: 10_000 };
    expect(await withTopUp(save, 99, poolPlan(COST))).toEqual({ report: "started", debit: COST });
  });

  test("the exact price funds the shortfall: the debit drops by it and the Shiny is added", async () => {
    const save = { resources: { r1: 400, r2: 0, r3: 0, r4: 0 }, poolCap: 10_000 };
    const price = topupCost({ r1: 600, r2: 500, r3: 0, r4: 0 });
    const outcome = await withTopUp(save, price, poolPlan(COST));
    expect(outcome).toMatchObject({ report: "started", shiny: price, debit: { r1: 400, r2: 0, r3: 0, r4: 0 } });
    // The save itself is untouched; the wrapper applies the outcome.
    expect(save.resources.r1).toBe(400);
  });

  test("another price is refused, naming the right one", async () => {
    const save = { resources: { r1: 0, r2: 0, r3: 0, r4: 0 }, poolCap: 10_000 };
    const price = topupCost({ r1: 1_000, r2: 500, r3: 0, r4: 0 });
    const error = await caught(() => withTopUp(save, price + 1, poolPlan(COST)));
    expect(error.data).toMatchObject({ reason: "shortfall", topUp: price, shortfall: { r1: 1_000, r2: 500, r3: 0, r4: 0 } });
  });

  test("a price over the storage cap cannot be topped up (msg_overcapacity)", async () => {
    const save = { resources: { r1: 0, r2: 0, r3: 0, r4: 0 }, poolCap: 800 };
    const price = topupCost({ r1: 1_000, r2: 500, r3: 0, r4: 0 });
    const error = await caught(() => withTopUp(save, price, poolPlan(COST)));
    expect(error.data).toMatchObject({ reason: "overCap" });
  });

  test("other refusals pass through untouched", async () => {
    const save = { resources: {}, poolCap: 10_000 };
    const error = await caught(() =>
      withTopUp(save, 5, () => {
        throw yardRefusedErr("workers", "busy");
      })
    );
    expect(error.data).toMatchObject({ reason: "workers" });
  });

  test("an Inferno price funds the Inferno purse up to its own caps", async () => {
    const iresources = { r1: 100, r2: 0, r3: 0, r4: 0, r1max: 5_000, r2max: 5_000, r3max: 5_000, r4max: 5_000 };
    const plan = (save: { iresources?: Record<string, number> | null }) => {
      const held = save.iresources?.r1 ?? 0;
      if (held < 1_000) throw purseShortfallErr({ r1: 1_000 - held, r2: 0, r3: 0, r4: 0 });
      return { report: "started", slices: { iresources: { ...save.iresources, r1: held - 1_000 } } };
    };
    const price = topupCost({ r1: 900, r2: 0, r3: 0, r4: 0 });
    const outcome = await withTopUp({ resources: {}, poolCap: 1, iresources }, price, plan);
    expect(outcome).toMatchObject({ shiny: price, slices: { iresources: { r1: 0, r1max: 5_000 } } });
  });
});
