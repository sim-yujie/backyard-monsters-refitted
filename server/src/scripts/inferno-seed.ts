import mikroOrmConfig from "../mikro-orm.config.js";

import { MikroORM } from "@mikro-orm/postgresql";

import { InfernoProgress } from "../database/models/infernoprogress.model.js";
import { Save } from "../database/models/save.model.js";
import { User } from "../database/models/user.model.js";
import { Env } from "../enums/Env.js";
import { INFERNO_MONSTER_CATALOGUE } from "../game-data/monsterCatalogue.js";
import { DESCENT_YARDS } from "../services/inferno/infernoProgress.js";
import { createInfernoYard } from "../services/inferno/infernoYard.js";
import { housedOf } from "../services/inferno/transfer.js";
import { housingCapacity, housingUsedBy, type HousingYard } from "../services/yard/housing.js";
import type { BuildingData, BuildingDataMap } from "../types/BuildingData.js";

/**
 * Dev only: puts one account past the Descent with a starter Inferno yard, so
 * a helper testing the Inferno does not set it up by hand. Run from the server
 * directory, against your own copy of the database:
 *
 *   bun run inferno:seed <username> --db <database> [--monsters IC1=6,IC2=4]
 *
 * - The cave at emergence level 5, the 13 Descent yards beaten at 100%, the
 *   Descent passed now (`bym.inferno_progress`).
 * - The Inferno yard `createInfernoYard` makes at the capture (Under Hall, two
 *   harvesters, two silos), unless the account already has one.
 * - With `--monsters`, the Compound (`monsters.housed`) set to exactly those
 *   monsters, and a Housing Bunker big enough for them: one is added if the
 *   yard has none, raised to the level they need otherwise (no Under Hall
 *   check). Without room the server's overflow cull would thin them on load.
 *
 * Refused when ENV is production, and on the database `server/.env` names
 * (the shared one) unless `--env-db` is added. It opens its own ORM and never
 * imports `server.ts`, so it boots no server; nothing is cached in Redis, so a
 * running server sees it on the next load.
 */

const USAGE = `Usage: bun run inferno:seed <username> --db <database> [--monsters IC1=6,IC2=4] [--env-db]`;

export interface SeedArgs {
  username: string;
  db: string;
  monsters: Record<string, number>;
  envDb: boolean;
}

const INFERNO_IDS = new Set(INFERNO_MONSTER_CATALOGUE.map((entry) => entry.id));

/** `IC1=6,IC2=4` as counts; an id outside IC1-IC8 or a count below 1 is refused. */
export const parseMonsters = (text: string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const part of text.split(",").filter(Boolean)) {
    const [id, count] = part.split("=");
    const n = Number(count);
    if (!INFERNO_IDS.has(id) || !Number.isInteger(n) || n < 1) {
      throw new Error(`"${part}" is not an Inferno monster and count (IC1-IC8, e.g. IC1=6)`);
    }
    counts[id] = (counts[id] ?? 0) + n;
  }
  return counts;
};

export const parseArgs = (argv: string[]): SeedArgs => {
  const valueOf = (flag: string) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const values = new Set([valueOf("--db"), valueOf("--monsters")]);
  const [username] = argv.filter((arg) => !arg.startsWith("--") && !values.has(arg));
  const db = valueOf("--db");
  if (!username || !db) throw new Error(USAGE);
  return { username, db, monsters: parseMonsters(valueOf("--monsters") ?? ""), envDb: argv.includes("--env-db") };
};

/** The Housing Bunker the seed adds when the yard has none: left of the Under Hall. */
export const SEED_BUNKER = { t: 128, X: -300, Y: 0, l: 1 };

/** Housing Bunker levels (`HOUSING.as:65`, 200 to 1820 places). */
const BUNKER_LEVELS = 6;

/**
 * The Inferno yard's buildings with room for `housed`: as they are when they
 * have it, else with {@link SEED_BUNKER} added (when there is no Housing
 * Bunker) and the first Housing Bunker at the lowest level that fits.
 */
export const withRoomFor = (yard: HousingYard, housed: Readonly<Record<string, number>>): BuildingDataMap => {
  const need = housingUsedBy(housed, {});
  const fits = (buildingdata: BuildingDataMap) => housingCapacity({ ...yard, buildingdata }, false) >= need;
  const all = { ...(yard.buildingdata ?? {}) };
  if (fits(all)) return all;

  let bunker = Object.values(all).find((building) => Number(building.t) === SEED_BUNKER.t);
  if (!bunker) {
    const id = Math.max(0, ...Object.keys(all).map(Number).filter(Number.isFinite)) + 1;
    bunker = { id, ...SEED_BUNKER } as unknown as BuildingData;
  }
  for (let l = 1; l <= BUNKER_LEVELS; l++) {
    const tried = { ...all, [String(bunker.id)]: { ...bunker, l } as BuildingData };
    if (fits(tried)) return tried;
  }
  throw new Error(`The monsters take ${need} places, more than a level ${BUNKER_LEVELS} Housing Bunker holds.`);
};

const seed = async (args: SeedArgs) => {
  const orm = await MikroORM.init({ ...mikroOrmConfig, dbName: args.db, debug: false, pool: { min: 0, max: 2 } });
  try {
    await orm.em.fork().transactional(async (em) => {
      const user = await em.findOne(User, { username: args.username }, { populate: ["save", "infernosave"] });
      const main = user?.save;
      if (!user || !main) throw new Error(`No account "${args.username}" with a main yard in ${args.db}`);

      const now = new Date();
      const row = (await em.findOne(InfernoProgress, { userid: user.userid })) ?? em.create(InfernoProgress, { userid: user.userid });
      row.emergence_level = 5;
      row.emergence_last_at ??= now;
      row.descent_destroyed = Array(DESCENT_YARDS).fill(1);
      row.descent_best = Array(DESCENT_YARDS).fill(100);
      row.descent_yards = {};
      row.descent_passed_at ??= now;
      row.updated_at = now;

      const had = Number(main.baseid_inferno) > 0;
      const yard = had
        ? await em.findOneOrFail(Save, { baseid: String(main.baseid_inferno) })
        : await createInfernoYard(em, user, main);
      row.inferno_baseid = yard.baseid;
      row.korath_unlocked_at ??= now;

      if (Object.keys(args.monsters).length) {
        yard.buildingdata = withRoomFor(yard as HousingYard, args.monsters);
        yard.monsters = { ...(yard.monsters ?? {}), housed: { ...args.monsters } };
      }

      em.persist([row, yard, main, user]);
      await em.flush();
      console.log(`Database: ${args.db}`);
      console.log(`${user.username} (userid ${user.userid}): Descent won, cave at level 5.`);
      console.log(`Inferno yard ${yard.baseid} ${had ? "(already there)" : "(made now)"}.`);
      console.log(`Compound: ${JSON.stringify(housedOf(yard.monsters))}`);
    });
  } finally {
    await orm.close();
  }
};

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (process.env.ENV === Env.PROD) throw new Error("inferno:seed is for dev databases only (ENV is production).");
    if (args.db === process.env.DB_NAME && !args.envDb) {
      throw new Error(`${args.db} is the database server/.env names. Seed your own copy, or add --env-db.`);
    }
    await seed(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  process.exit();
}
