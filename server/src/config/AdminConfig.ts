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

/** The Shiny the dashboard offers each genuine chat reporter, and the first one (`services/admin/chatCases.ts`). */
export interface ChatReportAward {
  each: number;
  first: number;
}

const wholeOr = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 10_000 ? value : fallback;
};

/**
 * - `CHAT_REPORT_SHINY` — what the page offers each reporter of a chat case. Default 10.
 * - `CHAT_REPORT_FIRST_SHINY` — what it offers the first reporter. Default: the same
 *   as everyone (the owner chose no first-reporter bonus, 4 Nov 2026).
 *
 * Only the starting amounts: the owner can change or untick each one before giving.
 */
export const chatReportAward = (env: Env = process.env): ChatReportAward => {
  const each = wholeOr(env.CHAT_REPORT_SHINY, 10);
  return { each, first: wholeOr(env.CHAT_REPORT_FIRST_SHINY, each) };
};
