import { describe, expect, test } from "bun:test";
import { INFERNO_LAB_ABILITIES, labStep } from "../../game-data/monsterCatalogue.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { catchUpResearch } from "./catchUpTraining.js";
import {
  planLabCancel,
  planLabFinish,
  planLabInstant,
  planLabStart,
  powerupRank,
  topRank,
  type LabSave,
} from "./lab.js";
import { instantResearchPrice, timeCost } from "./shiny.js";

/**
 * The Infernal Monster Lab (beta 9, owner, 21 Nov 2026: "same rules as the
 * surface Lab"; numbers card b9-numbers): type 116 in the Inferno yard,
 * researching the Inferno roster for Sulfur (`r3`) off the Inferno row's own
 * `academy` and Strongbox. Rank N needs Lab level N and the monster at level
 * N + 1; Balthazar (IC5) has two ranks.
 */

const NOW = 1_800_000_000;
const LAB = 9;

/**
 * An Inferno yard: Under Hall 6, a level 3 Lab (id 9). Spurtz (IC1) at level
 * 2 can take rank 1; Balthazar (IC5) at level 5 with rank 2 is at its top;
 * King Wormzer (IC8) at level 3 with rank 1 can take rank 2; Grokus (IC6) is
 * not unlocked.
 */
const infernoOf = (overrides: Partial<LabSave> = {}): LabSave => ({
  type: "inferno",
  resources: { r1: 0, r2: 0, r3: 50_000_000, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 6 },
    "2": { id: 2, t: 6, x: 0, y: 0, l: 10 },
    [String(LAB)]: { id: LAB, t: 116, x: 0, y: 0, l: 3 },
  },
  buildinghealthdata: {},
  lockerdata: { IC1: { t: 2 }, IC5: { t: 2 }, IC8: { t: 2 }, C3: { t: 2 } },
  academy: {
    IC1: { level: 2 },
    IC5: { level: 5, powerup: 2 },
    IC8: { level: 3, powerup: 1 },
    C3: { level: 6 },
  },
  ...overrides,
});

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ClientSafeError) return { status: err.status, ...(err.data as object) };
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("the Infernal Lab's prices (numbers card b9-num-lab)", () => {
  test("Sulfur, each rank 1.5 times the one before; times per monster", () => {
    expect(INFERNO_LAB_ABILITIES.map((one) => [one.id, one.costs])).toEqual([
      ["IC1", [[25_000, 86_400], [37_500, 86_400], [56_250, 86_400]]],
      ["IC2", [[50_000, 86_400], [75_000, 86_400], [112_500, 86_400]]],
      ["IC3", [[400_000, 108_000], [600_000, 108_000], [900_000, 108_000]]],
      ["IC4", [[800_000, 108_000], [1_200_000, 108_000], [1_800_000, 108_000]]],
      ["IC5", [[2_000_000, 172_800], [3_000_000, 172_800]]],
      ["IC6", [[3_000_000, 216_000], [4_500_000, 216_000], [6_750_000, 216_000]]],
      ["IC7", [[4_500_000, 259_200], [6_750_000, 259_200], [10_125_000, 259_200]]],
      ["IC8", [[6_000_000, 345_600], [9_000_000, 345_600], [13_500_000, 345_600]]],
    ]);
  });

  test("Balthazar tops out at rank 2, the others at 3", () => {
    expect(INFERNO_LAB_ABILITIES.map((one) => topRank(one))).toEqual([3, 3, 3, 3, 2, 3, 3, 3]);
  });
});

describe("research in the Infernal Lab", () => {
  test("start: Spurtz rank 1 for 25,000 Sulfur, 1 day", () => {
    const outcome = planLabStart(infernoOf(), "IC1", NOW);
    expect(outcome.report).toEqual({
      monster: "IC1",
      rank: 1,
      lab: LAB,
      endsAt: NOW + 86_400,
      seconds: 86_400,
      cost: { r3: 25_000 },
    });
    expect(outcome.debit).toEqual({ r3: 25_000 });
    expect(outcome.slices.buildingdata[String(LAB)]).toMatchObject({ upg: "IC1", upt: NOW + 86_400, upl: 1 });
  });

  test("start: King Wormzer rank 2 needs level 3 (has it) and Lab 2", () => {
    const outcome = planLabStart(infernoOf(), "IC8", NOW);
    expect(outcome.report).toMatchObject({ monster: "IC8", rank: 2, cost: { r3: 9_000_000 }, seconds: 345_600 });
  });

  test("Balthazar at rank 2 is fully researched", () => {
    expect(refusal(() => planLabStart(infernoOf(), "IC5", NOW))).toMatchObject({
      status: 409,
      reason: "maxRank",
      rank: 2,
    });
  });

  test("Balthazar rank 2 costs 3M and 2 days", () => {
    const save = infernoOf({ academy: { IC5: { level: 3, powerup: 1 } } });
    expect(planLabStart(save, "IC5", NOW).report).toMatchObject({ rank: 2, cost: { r3: 3_000_000 }, seconds: 172_800 });
  });

  test("rank N needs the Lab at level N", () => {
    const save = infernoOf();
    save.buildingdata![String(LAB)] = { id: LAB, t: 116, x: 0, y: 0, l: 1 };
    expect(refusal(() => planLabStart(save, "IC8", NOW))).toMatchObject({
      status: 409,
      reason: "labLevel",
      have: 1,
      need: 2,
    });
  });

  test("rank N needs the monster at level N + 1", () => {
    const save = infernoOf({ academy: { IC1: { level: 1 } } });
    expect(refusal(() => planLabStart(save, "IC1", NOW))).toMatchObject({
      status: 409,
      reason: "monsterLevel",
      monster: "IC1",
      have: 1,
      need: 2,
    });
  });

  test("a locked Inferno monster is refused", () => {
    expect(refusal(() => planLabStart(infernoOf({ academy: { IC6: { level: 5 } } }), "IC6", NOW))).toMatchObject({
      status: 409,
      reason: "locked",
    });
  });

  test("a surface monster is not researched in the Inferno, nor an Inferno one on the surface", () => {
    expect(refusal(() => planLabStart(infernoOf(), "C3", NOW))).toMatchObject({ status: 400 });
    const surface = { ...infernoOf(), type: "main" };
    expect(refusal(() => planLabStart(surface, "IC1", NOW))).toMatchObject({ status: 400 });
  });

  test("cancel gives the full Sulfur back; finish and instant are Shiny", () => {
    const started = infernoOf();
    started.buildingdata![String(LAB)] = { id: LAB, t: 116, x: 0, y: 0, l: 3, upg: "IC8", upt: NOW + 3_600, upl: 2 };
    expect(planLabCancel(started).credit).toEqual({ r3: 9_000_000 });

    const finished = planLabFinish(started, NOW);
    expect(finished.shiny).toBe(timeCost(3_600));
    expect(powerupRank(finished.slices.academy, "IC8")).toBe(2);

    const instant = planLabInstant(infernoOf(), "IC1");
    const [sulfur, seconds] = labStep("IC1", 1)!;
    expect(instant.shiny).toBe(instantResearchPrice(seconds, sulfur));
    expect(powerupRank(instant.slices.academy, "IC1")).toBe(1);
  });

  test("the catch-up finishes a research whose time has passed", () => {
    const save = infernoOf();
    save.buildingdata![String(LAB)] = { id: LAB, t: 116, x: 0, y: 0, l: 3, upg: "IC1", upt: NOW - 1, upl: 1, upd: 86_400 };
    const jobs = catchUpResearch(save, NOW);
    expect(jobs).toHaveLength(1);
    expect(powerupRank(save.academy, "IC1")).toBe(1);
    expect(save.buildingdata![String(LAB)]).not.toHaveProperty("upg");
  });
});
