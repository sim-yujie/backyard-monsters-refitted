import { afterEach, describe, expect, test } from "bun:test";

import { devConfig } from "../../config/GameConfig.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { AVATAR_IDS, avatarPath, PLACEHOLDER_PIC_SQUARE } from "../../game-data/avatars.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { starterBuildingData } from "../yard/starterBase.js";
import {
  AVATAR_SHARE,
  backdate,
  BOT_MAX_LEVEL,
  botSaveData,
  botUserData,
  drawBot,
  drawProfile,
  evenSpread,
  fillPlan,
} from "./factory.js";
import { levelBand } from "./progression.js";

/** The bot factory's pure parts (issue #239, `docs/design/bot-neighbours.md` §4.1, §10). */

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;
const T = 3;

/** A user row as the factory has it after the insert, asking for the sandbox to prove it is refused. */
const botUser = (): User =>
  ({ userid: 9100, username: "MossyGoblin", sandbox_start: true }) as unknown as User;

describe("evenSpread and fillPlan (decision 4, §10)", () => {
  test("500 over 40 levels: 13 on levels 1-20, 12 on 21-40", () => {
    const spread = evenSpread(500);
    expect(spread).toHaveLength(BOT_MAX_LEVEL);
    expect(spread.reduce((sum, count) => sum + count, 0)).toBe(500);
    expect(spread.slice(0, 20).every((count) => count === 13)).toBe(true);
    expect(spread.slice(20).every((count) => count === 12)).toBe(true);
  });

  test("an empty table is filled lowest levels first", () => {
    const plan = fillPlan(500, {});
    expect(plan).toHaveLength(500);
    expect(plan).toEqual([...plan].sort((a, b) => a - b));
    expect(plan.filter((level) => level === 1)).toHaveLength(13);
    expect(plan.filter((level) => level === 40)).toHaveLength(12);
  });

  test("only the shortfall is made, so a second run makes nothing", () => {
    const active: Record<number, number> = {};
    for (const level of fillPlan(80, {})) active[level] = (active[level] ?? 0) + 1;
    expect(fillPlan(80, active)).toEqual([]);

    active[3] = 0;
    active[7] = 5; // over its share of 2: left alone
    expect(fillPlan(80, active)).toEqual([3, 3]);
  });

  test("a limit takes the lowest levels", () => {
    expect(fillPlan(500, {}, 15)).toEqual([...Array(13).fill(1), 2, 2]);
    expect(fillPlan(500, {}, 0)).toEqual([]);
  });
});

describe("drawProfile", () => {
  test("ages and pace fit the level, and nothing is in the future", () => {
    const rng = mulberry32(42);
    for (let level = 1; level <= BOT_MAX_LEVEL; level++) {
      for (let i = 0; i < 10; i++) {
        const profile = drawProfile(rng, level, NOW, T);
        const levelSince = profile.levelSince.getTime() / 1000;
        expect(profile.createtime).toBeLessThan(NOW);
        expect(profile.createtime).toBeLessThanOrEqual(levelSince);
        expect(levelSince).toBeLessThanOrEqual(NOW);
        expect(NOW - levelSince).toBeLessThanOrEqual(T * DAY);
        expect(profile.savetime).toBeGreaterThanOrEqual(profile.createtime);
        expect(profile.savetime).toBeLessThanOrEqual(NOW);

        const { min, max } = levelBand(level);
        expect(profile.targetPoints).toBeGreaterThanOrEqual(min);
        expect(profile.targetPoints).toBeLessThan(max);
      }
    }
  });

  test("an account looks about as old as its level, with jitter", () => {
    const rng = mulberry32(5);
    const ages = Array.from({ length: 50 }, () => backdate(rng, 20, 0.5, T));
    for (const age of ages) {
      expect(age).toBeGreaterThan(19.5 * T * DAY * 0.8);
      expect(age).toBeLessThan(19.5 * T * DAY * 1.3 + 36 * 60 * 60);
    }
    expect(new Set(ages).size).toBe(ages.length);
  });

  test("avatars: critters and the placeholder, about the set share", () => {
    const rng = mulberry32(11);
    const pics = Array.from({ length: 2000 }, () => drawProfile(rng, 5, NOW, T).picSquare);
    const critters = new Set(AVATAR_IDS.map(avatarPath));
    expect(pics.every((pic) => critters.has(pic) || pic === PLACEHOLDER_PIC_SQUARE)).toBe(true);
    const share = pics.filter((pic) => critters.has(pic)).length / pics.length;
    expect(Math.abs(share - AVATAR_SHARE)).toBeLessThan(0.05);
  });
});

describe("drawBot", () => {
  test("the yard stands on the level asked for, at every level", () => {
    const rng = mulberry32(239);
    for (let level = 1; level <= BOT_MAX_LEVEL; level++) {
      const { profile, yard } = drawBot(rng, level, NOW, T);
      expect(yard.level).toBe(level);
      expect(calculateBaseLevel(yard.points, yard.basevalue)).toBe(level);
      expect(profile.level).toBe(level);
    }
  });

  test("refuses a level outside 1-40", () => {
    expect(() => drawBot(mulberry32(1), 0, NOW, T)).toThrow();
    expect(() => drawBot(mulberry32(1), 41, NOW, T)).toThrow();
  });
});

describe("botSaveData", () => {
  const sandbox = devConfig.devSandbox;
  afterEach(() => {
    devConfig.devSandbox = sandbox;
  });

  test("never the sandbox yard, even with DEV_SANDBOX on and sandbox_start set (#234)", () => {
    devConfig.devSandbox = true;
    const { profile, yard } = drawBot(mulberry32(3), 12, NOW, T);
    const save = botSaveData(botUser(), profile, yard);
    const ids = [...yard.buildings, ...yard.decorations].map((building) => String(building.id)).sort();
    expect(Object.keys(save.buildingdata).sort()).toEqual(ids);
    expect(save.points).toBe(yard.points);
    // The sandbox yard is maxed: a level 12 bot's yard is nowhere near it.
    expect(calculateBaseLevel(save.points, save.basevalue)).toBe(12);
  });

  test("a Map Room 1 main yard with no protection, no world, a back-dated createtime", () => {
    const { profile, yard } = drawBot(mulberry32(4), 25, NOW, T);
    const save = botSaveData(botUser(), profile, yard);
    expect(save.mapversion).toBe(MapRoomVersion.V1);
    expect(save.worldid).toBeNull();
    expect(save.protected).toBe(0);
    expect(save.createtime).toBe(profile.createtime);
    // Level 25 is about 24 levels of T days in, less the jitter's 20%.
    expect(save.createtime).toBeLessThan(NOW - 24 * T * DAY * 0.8);
    expect(save.createdAt.getTime()).toBe(profile.createtime * 1000);
    expect(save.level).toBe(25);
    expect(save.tutorialstage).toBe(205);
    expect(save.onboarding).toBeNull();
    expect(save.userid).toBe(9100);
    expect(save.saveuserid).toBe(9100);
    expect(save.name).toBe("MossyGoblin");
    expect(save.resources).toEqual({ ...yard.resources });
    expect(save.champion).toEqual(yard.champion);
  });

  test("each building keeps its spot and level", () => {
    const { profile, yard } = drawBot(mulberry32(9), 30, NOW, T);
    const data = botSaveData(botUser(), profile, yard).buildingdata as BuildingDataMap;
    for (const building of yard.buildings) {
      expect(data[String(building.id)]).toMatchObject({ id: building.id, t: building.t, l: building.l, X: building.X, Y: building.Y });
    }
  });
});

describe("getDefaultBaseData forBot (#234 carried into #239)", () => {
  const sandbox = devConfig.devSandbox;
  afterEach(() => {
    devConfig.devSandbox = sandbox;
  });

  test("a bot gets the starter yard where a player who asked would get the sandbox", () => {
    devConfig.devSandbox = true;
    const user = botUser();
    const player = getDefaultBaseData(user, BaseType.MAIN) as { buildingdata?: BuildingDataMap };
    expect(player.buildingdata).not.toEqual(starterBuildingData());

    const bot = getDefaultBaseData(user, BaseType.MAIN, { forBot: true }) as { buildingdata?: BuildingDataMap };
    expect(bot.buildingdata).toEqual(starterBuildingData());
  });
});

describe("botUserData", () => {
  test("an unusable address, the hash, the avatar, no sandbox", () => {
    const profile = drawProfile(mulberry32(1), 8, NOW, T);
    const data = botUserData("kai_builds", "$2b$10$hash", profile);
    expect(data.email).toMatch(/^bot\+[0-9a-f-]{36}@bymr\.invalid$/);
    expect(data.password).toBe("$2b$10$hash");
    expect(data.pic_square).toBe(profile.picSquare);
    expect(data.sandbox_start).toBe(false);
    expect(data.terms_accepted_at.getTime()).toBe(profile.createtime * 1000);
    expect(botUserData("kai_builds", "x", profile).email).not.toBe(data.email);
  });
});
