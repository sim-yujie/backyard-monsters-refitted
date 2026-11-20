import mikroOrmConfig from "../../mikro-orm.config.js";

import { MikroORM } from "@mikro-orm/postgresql";

import { seedMainPointsEarned } from "../../services/maproom/v2/outpostEarnedSeed.js";

/**
 * One-off seed of `save.mainpointsearned` for outposts built before patch 8.1
 * (`services/maproom/v2/outpostEarnedSeed.ts`). Run once, right after the
 * deploy that adds the column:
 *
 *   bun src/database/seeds/seed_outpost_mainpoints.ts            dry run: writes nothing
 *   bun src/database/seeds/seed_outpost_mainpoints.ts --apply    writes, once
 *
 * `--force` runs `--apply` again on a database it already ran on (the column
 * comment says so); `--rows` prints every outpost's figures. The database is
 * the one `DB_NAME` names, as for the server.
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");
const showRows = args.includes("--rows");

const f = (n: number) => n.toLocaleString("en");

const orm = await MikroORM.init({ ...mikroOrmConfig, debug: false, pool: { min: 0, max: 2 } });
try {
  console.log(`Database: ${process.env.DB_NAME}${apply ? "" : " (dry run: nothing is written)"}`);
  const report = await seedMainPointsEarned(orm.em.fork(), { apply, force });
  console.log(`Column comment before: ${report.mark ?? "(none)"}`);
  console.log(`Outposts: ${f(report.outposts)}; ${f(report.changed)} ${apply ? "seeded" : "would be seeded"}.`);
  const estimate = report.rows.reduce((total, row) => total + row.after - row.before, 0);
  console.log(`Main points already paid on outposts (added): ${f(estimate)}`);
  console.log(`Outpost formula points, all outposts: ${f(report.points)}`);
  console.log(`Board outpost points before: ${f(report.boardBefore)}; after: ${f(report.boardAfter)}; taken off: ${f(report.boardBefore - report.boardAfter)}`);
  const line = (row: (typeof report.topAfter)[number]) =>
    `${String(row.rank).padStart(3)}  ${row.name.padEnd(20)} ${f(row.empirePoints).padStart(16)}  (yard ${f(row.yardPoints)}, outposts ${f(row.outpostPoints)} in ${row.outposts})`;
  console.log("\nBoard top, before:");
  for (const row of report.topBefore) console.log(line(row));
  console.log("\nBoard top, after:");
  for (const row of report.topAfter) console.log(line(row));
  if (showRows) {
    console.log("\nbasesaveid userid points before estimate after");
    for (const row of report.rows) console.log([row.basesaveid, row.userid, row.points, row.before, row.estimate, row.after].join(" "));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await orm.close(true);
}
