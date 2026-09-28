import { describe, expect, test } from "bun:test";
import type { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import {
  CHAMPION_STATUS,
  healPriceOf,
  planChampionEvolve,
  planChampionFeed,
  planChampionHeal,
  planChampionJuice,
  planChampionRaise,
  planChampionRename,
  type ChampionSave,
} from "./champion.js";
import { championEntry } from "../../game-data/championCatalogue.js";

/**
 * The Champion Cage's rules (`services/yard/champion.ts`), straight on the
 * planners: every number is the original's (`client/scripts/CHAMPIONCAGE.as`,
 * `CHAMPIONCAGEPOPUP.as`, `champions/ChampionBase.as`).
 */

const NOW = 1_800_000_000;

const CAGE = { "3": { id: 3, t: 114, x: 0, y: 0, l: 1 } };

const gorgo = (overrides: Partial<ChampionData> = {}): ChampionData => ({
  t: 1,
  hp: 40_000,
  l: 1,
  ft: NOW + 3_600,
  fd: 0,
  fb: 0,
  pl: 1,
  status: 0,
  ...overrides,
});

const yard = (overrides: Partial<ChampionSave> = {}): ChampionSave => ({
  buildingdata: { ...CAGE },
  buildinghealthdata: {},
  monsters: { housed: { C2: 40, C6: 30, C10: 50 } },
  champion: [gorgo()],
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  ...overrides,
});

/** The refusal `plan` throws: its status and reason. */
const refusal = (plan: () => unknown): { status: number; reason: unknown } => {
  try {
    plan();
  } catch (err) {
    const error = err as ClientSafeError;
    return { status: error.status, reason: (error.data as { reason?: unknown }).reason };
  }
  throw new Error("expected a refusal");
};

describe("champion/raise", () => {
  test("hatches a level 1 champion at full health, fed for 23 hours, free", () => {
    const outcome = planChampionRaise(yard({ champion: [] }), 2, NOW);
    expect(outcome.slices.champion).toEqual([
      { t: 2, hp: 12_000, l: 1, ft: NOW + 23 * 3600, fd: 0, fb: 0, pl: 1, status: 0 },
    ]);
    expect(outcome).not.toHaveProperty("shiny");
  });

  test("offers only Gorgo, Drull and Fomor (D17)", () => {
    expect(refusal(() => planChampionRaise(yard({ champion: [] }), 4, NOW)).reason).toBe("notRaisable");
    expect(refusal(() => planChampionRaise(yard({ champion: [] }), 5, NOW)).reason).toBe("notRaisable");
  });

  test("needs a finished cage", () => {
    expect(refusal(() => planChampionRaise(yard({ champion: [], buildingdata: {} }), 1, NOW)).reason).toBe(
      "noCage"
    );
    const building = { "3": { ...CAGE["3"], cB: 100 } };
    expect(refusal(() => planChampionRaise(yard({ champion: [], buildingdata: building }), 1, NOW)).reason).toBe(
      "busy"
    );
  });

  test("refuses while a champion is in the cage, or that one is frozen", () => {
    expect(refusal(() => planChampionRaise(yard(), 2, NOW)).reason).toBe("championInCage");
    const frozen = yard({ champion: [gorgo({ status: 1, ft: 3_600 })] });
    expect(refusal(() => planChampionRaise(frozen, 1, NOW)).reason).toBe("frozen");
    // A different one may be raised while Gorgo sleeps in the chamber.
    expect(planChampionRaise(frozen, 3, NOW).slices.champion).toHaveLength(2);
  });

  test("replaces a juiced champion of the same type", () => {
    const juiced = yard({ champion: [gorgo({ status: 2, l: 5, nm: "Old" })] });
    const outcome = planChampionRaise(juiced, 1, NOW);
    expect(outcome.slices.champion).toEqual([
      { t: 1, hp: 40_000, l: 1, ft: NOW + 23 * 3600, fd: 0, fb: 0, pl: 1, status: 0 },
    ]);
  });

  test("a Krallen beside the cage does not count as the cage's champion", () => {
    const krallen = { t: 5, hp: 50_000, l: 1, ft: NOW + 100, fd: 0, fb: 0, pl: 1, status: 0 };
    expect(planChampionRaise(yard({ champion: [krallen] }), 1, NOW).slices.champion).toHaveLength(2);
  });
});

describe("champion/feed", () => {
  const hungry = (overrides: Partial<ChampionData> = {}) => yard({ champion: [gorgo({ ft: NOW - 10, ...overrides })] });

  test("eats the level's Map Room 2 recipe from housing and counts a feed", () => {
    const outcome = planChampionFeed(hungry(), "monsters", NOW);
    expect(outcome.report.eaten).toEqual({ C2: 15 });
    expect(outcome.slices.monsters).toEqual({ housed: { C2: 25, C6: 30, C10: 50 } });
    expect(outcome.slices.champion[0]).toMatchObject({ l: 1, fd: 1, ft: NOW + 23 * 3600 });
    expect(outcome.report.evolved).toBe(false);
  });

  test("evolves at the level's feed count: next level, feeds 0, full health", () => {
    const outcome = planChampionFeed(hungry({ fd: 2, hp: 100 }), "monsters", NOW);
    expect(outcome.slices.champion[0]).toMatchObject({ l: 2, fd: 0, hp: 80_000, ft: NOW + 23 * 3600 });
    expect(outcome.report.evolved).toBe(true);
  });

  test("refuses before the champion is hungry", () => {
    const refused = refusal(() => planChampionFeed(yard(), "monsters", NOW));
    expect(refused).toEqual({ status: 409, reason: "notHungry" });
    expect(refusal(() => planChampionFeed(yard(), "shiny", NOW)).reason).toBe("notHungry");
  });

  test("refuses when housing is short, naming the monster", () => {
    const short = hungry();
    short.monsters = { housed: { C2: 14 } };
    expect(refusal(() => planChampionFeed(short, "monsters", NOW)).reason).toBe("notEnough");
  });

  test("a Shiny feed costs the level's feedShiny and eats nothing", () => {
    const outcome = planChampionFeed(hungry({ l: 3, fd: 1 }), "shiny", NOW);
    expect(outcome.shiny).toBe(75);
    expect(outcome.slices).not.toHaveProperty("monsters");
    expect(outcome.slices.champion[0]).toMatchObject({ l: 3, fd: 2 });
  });

  test("at level 6 a feed raises the food bonus and adds its health", () => {
    const top = hungry({ l: 6, hp: 150_000, fb: 0 });
    const outcome = planChampionFeed(top, "monsters", NOW);
    expect(outcome.report.eaten).toEqual({ C10: 20 });
    expect(outcome.slices.champion[0]).toMatchObject({ l: 6, fb: 1, hp: 162_500, ft: NOW + 23 * 3600 });
  });

  test("at level 6 the Shiny feed is the next rank's price, doubled while not hungry", () => {
    const fed = yard({ champion: [gorgo({ l: 6, hp: 200_000, fb: 1 })] });
    expect(planChampionFeed(fed, "shiny", NOW).shiny).toBe(272);
    expect(planChampionFeed(hungry({ l: 6, hp: 200_000, fb: 1 }), "shiny", NOW).shiny).toBe(136);
    const full = yard({ champion: [gorgo({ l: 6, hp: 250_000, fb: 3 })] });
    expect(refusal(() => planChampionFeed(full, "shiny", NOW)).reason).toBe("fullBuff");
    // Hungry at rank 3: feeding keeps it at 3 and resets the clock.
    const feed = planChampionFeed(hungry({ l: 6, hp: 250_000, fb: 3 }), "monsters", NOW);
    expect(feed.slices.champion[0]).toMatchObject({ fb: 3, hp: 250_000, ft: NOW + 23 * 3600 });
  });

  test("needs a champion in the cage", () => {
    expect(refusal(() => planChampionFeed(yard({ champion: [] }), "monsters", NOW)).reason).toBe("noChampion");
  });
});

describe("champion/evolve", () => {
  test("costs feedShiny × 2 × feeds still needed and evolves at once", () => {
    const outcome = planChampionEvolve(yard({ champion: [gorgo({ l: 2, fd: 4, hp: 1 })] }), NOW);
    expect(outcome.shiny).toBe(44 * 2 * 2);
    expect(outcome.slices.champion[0]).toMatchObject({ l: 3, fd: 0, hp: 120_000, ft: NOW + 23 * 3600 });
  });

  test("refuses at the top level", () => {
    expect(refusal(() => planChampionEvolve(yard({ champion: [gorgo({ l: 6 })] }), NOW)).reason).toBe("maxLevel");
  });
});

describe("champion/heal", () => {
  test("heals to full for timeCost(missing / max × healtime, false)", () => {
    // Half health at level 1: 1,800 s → min(ceil(1800 × 20 / 3600), int(sqrt(1440))) = min(10, 37).
    const outcome = planChampionHeal(yard({ champion: [gorgo({ hp: 20_000 })] }));
    expect(outcome.shiny).toBe(10);
    expect(outcome.slices.champion[0]!.hp).toBe(40_000);
  });

  test("counts the food bonus in full health", () => {
    const champion = gorgo({ l: 6, fb: 2, hp: 200_000 });
    expect(healPriceOf(champion, championEntry(1)!)).toBeGreaterThan(0);
    expect(planChampionHeal(yard({ champion: [champion] })).slices.champion[0]!.hp).toBe(227_500);
  });

  test("refuses at full health", () => {
    expect(refusal(() => planChampionHeal(yard())).reason).toBe("fullHealth");
  });
});

describe("champion/rename", () => {
  test("names the champion, trimmed", () => {
    const outcome = planChampionRename(yard(), "  Big   Gorgo ");
    expect(outcome.slices.champion[0]!.nm).toBe("Big Gorgo");
  });

  test("refuses an empty, long or rude name", () => {
    expect(refusal(() => planChampionRename(yard(), "   ")).status).toBe(400);
    expect(refusal(() => planChampionRename(yard(), "x".repeat(21))).status).toBe(400);
    expect(refusal(() => planChampionRename(yard(), "shit")).reason).toBe("nameRefused");
  });
});

describe("champion/juice", () => {
  const JUICER = { "5": { id: 5, t: 9, x: 200, y: 0, l: 1 } };

  test("juices the champion for good, for no goo", () => {
    const outcome = planChampionJuice(yard({ buildingdata: { ...CAGE, ...JUICER } }));
    expect(outcome.slices.champion[0]!.status).toBe(CHAMPION_STATUS.JUICED);
    expect(outcome).not.toHaveProperty("credit");
  });

  test("needs a working Juicer", () => {
    expect(refusal(() => planChampionJuice(yard())).reason).toBe("noJuicer");
    const upgrading = { ...CAGE, "5": { ...JUICER["5"], cU: 100 } };
    expect(refusal(() => planChampionJuice(yard({ buildingdata: upgrading }))).reason).toBe("busy");
  });

  test("keeps every other entry as it was", () => {
    const frozen = gorgo({ t: 3, status: 1, ft: 5_000 });
    const outcome = planChampionJuice(
      yard({ buildingdata: { ...CAGE, ...JUICER }, champion: [frozen, gorgo()] })
    );
    expect(outcome.slices.champion[0]).toEqual(frozen);
  });
});

