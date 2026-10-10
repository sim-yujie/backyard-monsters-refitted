import mikroOrmConfig from "../mikro-orm.config.js";

import { RedisClient } from "bun";
import { MikroORM } from "@mikro-orm/postgresql";

import {
  AccountDeletionRefused,
  deleteAccount,
  findAccount,
  planAccountDeletion,
  type DeletionPlan,
} from "../services/privacy/deleteAccount.js";

/**
 * Deletes one player's account for good, when they ask (the Privacy Policy,
 * section 5). Run from the server directory; it uses the database and Redis
 * that `server/.env` names.
 *
 *   bun run account:delete <username or id> --dry-run
 *       Lists everything that would be deleted or changed. Touches nothing.
 *   bun run account:delete <username or id> --yes
 *       Deletes it. There is no undo, except restoring a backup.
 *
 * With neither flag it does the dry run and says to add --yes. `id:123` or
 * `name:Bob` picks one when a number is also someone's username.
 *
 * What goes and what stays is in `services/privacy/deleteAccount.ts`. It opens
 * its own ORM and never imports `server.ts`, so it boots no server; it is safe
 * to run while the game is up.
 */

const USAGE = `Usage: bun run account:delete <username | id | id:N | name:X> [--dry-run | --yes]`;

const printPlan = (plan: DeletionPlan, done: boolean) => {
  const { account } = plan;
  console.log(`\nAccount #${account.userid} "${account.username}" <${account.email}>`);
  console.log(done ? "Deleted:" : "Would delete or change:");
  for (const [label, rows] of Object.entries(plan.rows)) console.log(`  ${String(rows).padStart(6)}  ${label}`);
  if (plan.alliance) console.log(`  Alliance: ${plan.alliance}`);
  console.log(`  Redis: ${plan.redis.keys.length} keys (logins, chat, caches)`);
  for (const key of plan.redis.keys) console.log(`          ${key}`);
  console.log(`  Redis: ${plan.redis.chatLines} world chat lines, ${plan.redis.botCheckRows} fair-play log rows,`);
  console.log(`         ${plan.redis.ignoreLists} other players' chat ignore lists`);
  console.log(`  Kept: chat reports (no name in them), deleted by the daily clean-up when they are old enough.`);
  console.log(`  Not covered: database backups and server log files, which expire on their own.\n`);
};

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const confirmed = args.includes("--yes");
  const [who] = args.filter((arg) => !arg.startsWith("--"));

  if (!who || (dryRun && confirmed)) {
    console.error(USAGE);
    process.exit(1);
  }

  const orm = await MikroORM.init({ ...mikroOrmConfig, debug: false });
  const redis = new RedisClient(process.env.REDIS_URL);

  try {
    await redis.connect();
    const account = await findAccount(orm.em, who);

    if (confirmed) {
      printPlan(await deleteAccount(orm.em, redis, account), true);
    } else {
      printPlan(await planAccountDeletion(orm.em, redis, account), false);
      if (!dryRun) console.log(`Nothing was deleted. Add --yes to delete this account.`);
    }
  } catch (error) {
    console.error(error instanceof AccountDeletionRefused ? error.message : error);
    process.exitCode = 1;
  } finally {
    redis.close();
    await orm.close();
  }
  process.exit();
})();
