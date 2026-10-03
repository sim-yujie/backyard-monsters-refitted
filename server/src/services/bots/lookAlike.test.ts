import { describe, expect, test } from "bun:test";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MR1_TRIBES } from "../../enums/Tribes.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { shapeDiff } from "../../testing/shapeDiff.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import { currentMR1Tribes } from "../maproom/v1/mr1TribeRules.js";
import { catchUpYard } from "../yard/catchUp.js";
import { botSaveData, drawBot, settleNewYard } from "./factory.js";
import { visitMapRoom1 } from "./lookAlike.js";

/**
 * A bot's save as any client is sent it (issue #245, decision 3): the view and
 * attack loads send every `@FrontendKey` field of the defender's save, so a
 * bot's must have the shape a real player's has: the same fields, holding the
 * same kinds of value (`testing/shapeDiff.ts`).
 *
 * Two real players stand beside the bots:
 *
 * - At levels 1 and 2, a new account after its first load
 *   (`getDefaultBaseData`, then the owner's catch-up), the same level as the
 *   bot.
 * - At every level, an account whose yard holds the bot's buildings and army,
 *   brought up to date by the same owner's catch-up: whatever a bot carries
 *   that the real yard code would not write, or lacks that it would, shows.
 */

const NOW = 1_800_000_000;
const T = 3;

/** Fields a building has only while something runs on it: countdowns, a repair, a harvester's cycle. */
const RUNNING_STATE = new Set(["cB", "cL", "cU", "cF", "cP", "rE", "hp"]);

/** What the database fills in on a new save row (`save.model.ts` defaults). */
const ROW_DEFAULTS = { level: 1, points: "0", basevalue: "0", tutorialstage: 0, worldid: null };

const player = { userid: 9200, username: "kai_builds", sandbox_start: false } as unknown as User;
const botUser = { userid: 9201, username: "MossyGoblin", sandbox_start: false } as unknown as User;

/** A real player's main yard after sign-up and the first load, optionally holding a given yard. */
const realYard = (yard: Partial<Save> = {}): Save => {
  const save = Object.assign(new Save(), ROW_DEFAULTS, getDefaultBaseData(player, BaseType.MAIN), structuredClone(yard), {
    savetime: NOW - 60,
  });
  catchUpYard(save, NOW);
  return save;
};

/** A bot's main yard as the factory writes it. */
const botYard = (level: number, seed: number): Save => {
  const { profile, yard } = drawBot(mulberry32(seed), level, NOW, T);
  const save = Object.assign(new Save(), ROW_DEFAULTS, botSaveData(botUser, profile, yard));
  settleNewYard(save, profile.savetime);
  return save;
};

/** The buildings and army a real player of the bot's yard would have built and trained. */
const sameYard = (bot: Save): Partial<Save> => {
  const buildingdata = Object.fromEntries(
    Object.entries(bot.buildingdata ?? {}).map(([id, building]) => {
      const idle = Object.fromEntries(Object.entries(building).filter(([key]) => !RUNNING_STATE.has(key)));
      return [id, idle];
    })
  ) as Save["buildingdata"];
  const { level, points, basevalue, lockerdata, academy, champion, storedata, resources, tutorialstage } = bot;
  return {
    level,
    points,
    basevalue,
    tutorialstage,
    buildingdata,
    lockerdata,
    academy,
    champion,
    storedata,
    resources,
    monsters: { housed: { ...((bot.monsters?.housed as object) ?? {}) } },
  };
};

/** What a client is sent, with `buildingdata` keyed by building type so yards of different layouts compare. */
const sent = (save: Save) => {
  const fields = FilterFrontendKeys(save) as Record<string, unknown>;
  const byType: Record<string, unknown> = {};
  for (const building of Object.values((fields.buildingdata ?? {}) as Record<string, { t: number }>)) {
    byType[String(building.t)] ??= building;
  }
  return { ...fields, buildingdata: byType };
};

const LEVELS = [1, 2, 3, 5, 8, 10, 13, 15, 18, 20, 23, 25, 28, 30, 33, 35, 38, 40];

describe("a bot's save has a real player's shape (#245)", () => {
  test.each([1, 2])("level %i: as a new account of that level", (level) => {
    const real = sent(realYard());
    for (const seed of [245, 2450, 24500]) {
      const bot = sent(botYard(level, seed + level));
      expect(Object.keys(bot).sort()).toEqual(Object.keys(real).sort());
      expect(shapeDiff(bot, real, RUNNING_STATE)).toEqual([]);
    }
  });

  test.each(LEVELS)("level %i: as a real account with the same yard", (level) => {
    for (const seed of [245, 2450]) {
      const bot = botYard(level, seed + level);
      const real = realYard(sameYard(bot));
      expect(shapeDiff(sent(bot), sent(real), RUNNING_STATE)).toEqual([]);
      expect(Object.keys(FilterFrontendKeys(bot)).sort()).toEqual(Object.keys(FilterFrontendKeys(real)).sort());
    }
  });

  test("a new bot's save already has what a loaded yard carries: hatchery queues, mushrooms, Map Room 1's tribes", () => {
    const bot = botYard(12, 77);
    expect(Object.keys(bot.monsters ?? {}).sort()).toEqual(Object.keys(realYard().monsters ?? {}).sort());
    expect(bot.mushrooms).toMatchObject({ l: expect.any(Array), s: expect.any(Number) });
    expect(bot.wmstatus).toHaveLength(4);
  });

  test("settling a new bot changes no level, points or base value, and keeps its savetime", () => {
    for (const level of LEVELS) {
      const { profile, yard } = drawBot(mulberry32(level), level, NOW, T);
      const save = Object.assign(new Save(), botSaveData(botUser, profile, yard));
      settleNewYard(save, profile.savetime);
      expect(save).toMatchObject({ level: yard.level, points: yard.points, basevalue: yard.basevalue, savetime: profile.savetime });
    }
  });
});

describe("visitMapRoom1 writes what opening Map Room 1 writes (#245)", () => {
  const yardWithHall = (hall: number, level: number, wmstatus: number[][] = []) =>
    ({ buildingdata: { "1": { id: 1, t: 14, l: hall, X: 0, Y: 0 } }, level, wmstatus }) as unknown as Save;

  test("the Town Hall's four tribes, at the levels round the player's", () => {
    const save = yardWithHall(4, 12);
    visitMapRoom1(save);

    const tribes = currentMR1Tribes(4, MR1_TRIBES).map((slot) => Number(slot.template.baseid));
    expect(save.wmstatus).toEqual([
      [tribes[0], 11, 0],
      [tribes[1], 12, 0],
      [tribes[2], 13, 0],
      [tribes[3], 14, 0],
    ]);
  });

  test("a wrecked tribe stays wrecked, and an older tier's entries are kept, as on a player's save", () => {
    const old = currentMR1Tribes(2, MR1_TRIBES).map((slot) => Number(slot.template.baseid));
    const now = currentMR1Tribes(6, MR1_TRIBES).map((slot) => Number(slot.template.baseid));
    const save = yardWithHall(6, 1, [
      [old[0]!, 1, 1],
      [now[1]!, 3, 1],
    ]);
    visitMapRoom1(save);

    expect(save.wmstatus).toContainEqual([old[0], 1, 1]);
    expect(save.wmstatus).toContainEqual([now[1], 1, 1]);
    expect(save.wmstatus).toContainEqual([now[0], 1, 0]);
    expect(save.wmstatus).toHaveLength(5);
  });
});
