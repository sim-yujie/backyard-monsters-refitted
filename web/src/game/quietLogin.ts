/**
 * The test server's quiet login (server `config/QuietLoginConfig.ts`, owner
 * 11 Nov 2026): a local server started with `QUIET_LOGIN=1` says so on the
 * owner's yard load (`quietlogin: 1`), so a test account logged in to take
 * pictures lands straight in its yard.
 *
 * While it is on, the pop-ups that open by themselves stay shut: "What's new",
 * the daily login card, "Slow internet?", the owner's announcements, the
 * weekend pop-up, the support reminder, the achievement cards the load
 * brought, Korath unlocked, a team notice and Bob's one-time tips. Nothing is
 * written as seen, here or on the server, and each still opens by hand (the
 * Events page, Quests, News, Achievements, Settings' Quality, a "?" button).
 * The server itself holds back Moloch's emergence and the country question.
 *
 * A live server never sends it, so for players this is always off.
 */

let quiet = false;

/** Whether the test server's quiet login is on (the own yard's last load said so). */
export const quietLogin = (): boolean => quiet;

/** Takes the own yard's load: on only when it carries `quietlogin: 1`. */
export const setQuietLoginFrom = (load: { quietlogin?: unknown } | null | undefined): void => {
  quiet = load?.quietlogin === 1;
};

/** Sets it outright, for tests. */
export const setQuietLogin = (on: boolean): void => {
  quiet = on;
};
