/**
 * The owner-only dashboard (`controllers/admin/routes.ts`,
 * `docs/design/admin-dashboard-api.md`).
 *
 * - `ADMIN_USER_IDS` — the account numbers (`user.userid`) that may open it,
 *   comma separated. Unset or empty means nobody: every admin route then
 *   answers 404 to everyone.
 *
 * Read on each call rather than once at import, so tests can change them.
 */

type Env = Record<string, string | undefined>;

/** The account numbers in `ADMIN_USER_IDS`; anything that is not a whole number above 0 is ignored. */
export const adminUserIds = (env: Env = process.env): ReadonlySet<number> =>
  new Set(
    (env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => /^\d+$/.test(part))
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );

/** Whether `userid` may open the dashboard. */
export const isAdminUser = (userid: unknown, env: Env = process.env): boolean =>
  typeof userid === "number" && adminUserIds(env).has(userid);
