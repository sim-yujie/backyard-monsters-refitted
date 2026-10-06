import { Migration } from "@mikro-orm/migrations";

/**
 * Makes usernames unique whatever their case in the database too (issue #216).
 *
 * Sign-up and rename already refuse "Bob" while "bob" exists
 * (`services/user/usernameLookup.ts`), but two requests racing with those two
 * spellings could both pass that check, and the old unique index on
 * `username` is case-sensitive, so it took both. The new index on
 * `lower(username)` refuses the second; register and rename already answer
 * its refusal with the "username taken" error.
 *
 * The index cannot be built while two accounts already share a name in
 * different case. Rather than rename anyone, the migration then stops with
 * every clashing name and its user IDs, and changes nothing: someone has to
 * decide who keeps the name and rename the other through the rename service.
 *
 * The old case-sensitive index stays, as `user.model.ts` declares it.
 */
export class AddUsernameLowerUniqueIndex extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$
      DECLARE
        clashes text;
      BEGIN
        SELECT string_agg(format('%s (user ids %s)', names, ids), '; ')
          INTO clashes
          FROM (
            SELECT string_agg("username", ', ' ORDER BY "userid") AS names,
                   string_agg("userid"::text, ', ' ORDER BY "userid") AS ids
              FROM "bym"."user"
             GROUP BY lower("username")
            HAVING count(*) > 1
          ) AS duplicates;

        IF clashes IS NOT NULL THEN
          RAISE EXCEPTION 'Usernames that differ only by case must be resolved before they can be made unique (issue #216): %', clashes;
        END IF;
      END $$;
    `);

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_username_lower_unique"
        ON "bym"."user" (lower("username"));
    `);
  }
}
