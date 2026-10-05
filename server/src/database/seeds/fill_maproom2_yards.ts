import mikroOrmConfig from "../../mikro-orm.config.js";

import { MikroORM } from "@mikro-orm/postgresql";

import { botConfig, seededYardsOn } from "../../config/BotConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { findSeededPlayers, giveSeededYards, isBlankSeedYard } from "../../services/bots/seededPlayers.js";

/**
 * Gives the Map Room 2 dev players `db:seed:mr2` made before issue #233 the
 * yards a fresh seed now gives them: every seeded player still on the blank
 * new-account yard gets a generated one, spread over levels 1-40, which the
 * bot sweep then repairs and grows (`services/bots/seededPlayers.ts`).
 * Players already given one, and seeded accounts someone has built on, are
 * left alone, so it is safe to run again.
 *
 *   bun run db:seed:mr2:yards [--dry-run] [--seed N]
 *
 * Dev databases only: refused when ENV is production. Writes to the database
 * `DB_NAME` names (`server/.env`). Opens its own ORM and boots no server.
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const seedAt = args.indexOf("--seed");
const seed = seedAt >= 0 ? Number(args[seedAt + 1]) : Date.now() >>> 0;

if (!seededYardsOn(process.env)) {
  console.error("db:seed:mr2:yards is for dev databases only (ENV is production).");
  process.exit(1);
}

const orm = await MikroORM.init({ ...mikroOrmConfig, debug: false, pool: { min: 0, max: 2 } });
try {
  const em = orm.em.fork();
  console.log(`Database: ${process.env.DB_NAME}`);

  if (dryRun) {
    const players = await findSeededPlayers(em);
    const blank = players.filter((player) => isBlankSeedYard(player.buildingdata)).length;
    console.log(`Seeded players without a yard: ${blank} blank, ${players.length - blank} built on (left alone).`);
    console.log("Dry run: nothing written.");
  } else {
    const byLevel: Record<number, number> = {};
    const { given, notBlank } = await giveSeededYards(em, {
      rng: mulberry32(seed),
      now: Math.floor(Date.now() / 1000),
      daysPerLevel: botConfig().daysPerLevel,
      onBatch: (batch) => {
        for (const player of batch) byLevel[player.level] = (byLevel[player.level] ?? 0) + 1;
        process.stdout.write(".");
      },
    });
    console.log(`\nGave ${given.length} seeded player(s) a yard (seed ${seed}); ${notBlank} built on, left alone.`);
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    if (levels.length > 0) console.log(`Per level: ${levels.map((level) => `${level}:${byLevel[level]}`).join(" ")}`);
  }
} finally {
  await orm.close(true);
}
process.exit(0);
