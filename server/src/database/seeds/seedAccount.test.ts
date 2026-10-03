import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { devConfig } from "../../config/GameConfig.js";
import { BaseType } from "../../enums/Base.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import { starterBuildingData } from "../../services/yard/starterBase.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { User } from "../models/user.model.js";
import { seedUserData } from "./seedAccount.js";

/** Seeding never hands out the DEV_SANDBOX maxed yard (bot neighbours decision 16, #234). */

const SEEDS_DIR = import.meta.dir;
const SEED_SCRIPTS = readdirSync(SEEDS_DIR).filter((file) => /^seed_.*\.ts$/.test(file) && !file.endsWith(".test.ts"));

describe("seedUserData — a seeded dev account", () => {
  const sandbox = devConfig.devSandbox;
  afterEach(() => {
    devConfig.devSandbox = sandbox;
  });

  test("never asks for the sandbox yard, even with DEV_SANDBOX on", () => {
    devConfig.devSandbox = true;
    expect(seedUserData("abc123", "hash")).toEqual({
      username: "abc123",
      email: "abc123@test.com",
      password: "hash",
      sandbox_start: false,
    });
  });

  test("seeding with DEV_SANDBOX on gives the starter yard", () => {
    devConfig.devSandbox = true;
    const user = { userid: 9001, ...seedUserData("abc123", "hash") } as unknown as User;
    const data = getDefaultBaseData(user, BaseType.MAIN) as { buildingdata?: BuildingDataMap; resources: object };
    expect(data.buildingdata).toEqual(starterBuildingData());
    expect(data.resources).toMatchObject({ r1: 1600, r2: 1600, r3: 0, r4: 0 });
  });
});

describe("the seed scripts", () => {
  test("include the three known ones", () => {
    expect(SEED_SCRIPTS).toEqual(expect.arrayContaining(["seed_alliances.ts", "seed_maproom2.ts", "seed_maproom3.ts"]));
  });

  test.each(SEED_SCRIPTS)("%s builds its users with seedUserData and never reads DEV_SANDBOX", (file) => {
    const source = readFileSync(join(SEEDS_DIR, file), "utf8");
    expect(source).toContain("em.create(User, seedUserData(");
    expect(source).not.toContain("devSandbox");
    expect(source).not.toContain("sandbox_start");
  });
});
