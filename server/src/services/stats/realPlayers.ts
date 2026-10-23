import type { EntityManager } from "@mikro-orm/postgresql";

/**
 * Who counts as a player in the dashboard's numbers: every account except
 *
 * - bots: any `bym.bot` row, the seeded Map Room 2 dev players (state
 *   'seeded') included. The game treats a seeded player as a person
 *   (`isBot`, `services/bots/isBot.ts`), but nobody plays them, so they stay
 *   out of these numbers; and
 * - test accounts: a username starting `zz_` (the tutorial and test helpers'
 *   `zz_tut_*`, `zz_br_*`...), or an email at a reserved test domain: one
 *   ending `.invalid` or `.example`, or at example.com, example.net or
 *   example.org.
 *
 * Banned accounts still count: they were real players.
 */

/**
 * A SQL condition that holds for real players only, on a `bym."user"` row
 * named `alias`. It takes no parameters.
 */
export const realPlayerSql = (alias = "u"): string =>
  `NOT EXISTS (SELECT 1 FROM bym.bot zb WHERE zb.userid = ${alias}.userid)
   AND ${alias}.username NOT ILIKE 'zz\\_%'
   AND lower(${alias}.email) !~ '(\\.invalid|\\.example|@example\\.(com|net|org))$'`;

/** Whether one username and email belong to a test account (the second half of {@link realPlayerSql}). */
export const isTestAccount = (username: string, email: string): boolean =>
  /^zz_/i.test(username) || /(\.invalid|\.example|@example\.(com|net|org))$/.test(email.toLowerCase());

/** Rows looked up per statement when filtering a list of account numbers. */
const CHUNK = 5000;

/**
 * The real players among `userids` (bots, test accounts and numbers with no
 * account left out), in no particular order.
 */
export const realPlayerIds = async (em: EntityManager, userids: Iterable<number>): Promise<number[]> => {
  const unique = [...new Set([...userids].filter((id) => Number.isSafeInteger(id) && id > 0))];
  const real: number[] = [];
  for (let start = 0; start < unique.length; start += CHUNK) {
    const chunk = unique.slice(start, start + CHUNK);
    const rows = await em.execute<{ userid: number | string }[]>(
      `SELECT u.userid FROM bym."user" u WHERE u.userid = ANY(?::int[]) AND ${realPlayerSql("u")}`,
      [`{${chunk.join(",")}}`]
    );
    for (const row of rows) real.push(Number(row.userid));
  }
  return real;
};
