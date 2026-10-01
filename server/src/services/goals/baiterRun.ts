import type { Save } from "../../database/models/save.model.js";
import { updateOnboarding } from "../onboarding/state.js";
import { levelOf } from "../yardplanner/costs.js";
import { yardRefusedErr } from "../yard/yardErrors.js";

/**
 * The record of finished Wild Monster Baiter practice runs, for goal N1
 * (`docs/design/tutorial.md` §6.2, decision of 2026-10-01: "an actual
 * completed practice run").
 *
 * A Baiter run is a client simulation the server cannot replay, so the
 * record is made hard to fake rather than proven:
 *
 * 1. As the Baiter scene opens, `goals/baiter-start` issues a one-use token,
 *    kept on the server ({@link BaiterTokenStore}, Redis in production) with
 *    the second it was issued. Only a yard with a finished Baiter gets one.
 * 2. When the run reaches its end screen, `goals/baiter-run { token }` spends
 *    it: refused unless it is the token issued to this player, unspent, and at
 *    least {@link BAITER_MIN_SECONDS} old (the army walks in from 1,000 yard
 *    units out, so no real run ends sooner), and unless the Baiter still
 *    stands. Then `counters.baiterRuns` goes up by one.
 *
 * A replayed or invented token, a second spend, or a run "finished" the
 * moment it started all count nothing.
 */

/** Wild Monster Baiter (`client/scripts/BUILDING19.as`). */
export const BAITER_TYPE = 19;

/** A run must last at least this long, from token to end screen. */
export const BAITER_MIN_SECONDS = 5;

/** How long an issued token lives (a run is a few minutes at most). */
export const BAITER_TOKEN_SECONDS = 900;

/** One issued token. */
export interface BaiterTicket {
  token: string;
  /** Unix seconds it was issued. */
  at: number;
}

/** Where tokens are kept, one per player; injectable so tests need no Redis. */
export interface BaiterTokenStore {
  /** Keeps `ticket` for `userid`, replacing any earlier one. */
  issue(userid: number, ticket: BaiterTicket): Promise<void>;
  /** Takes the player's ticket out, so it can be spent once; null when there is none. */
  take(userid: number): Promise<BaiterTicket | null>;
}

/** `report` of `goals/baiter-start`. */
export interface BaiterStartReport {
  token: string;
}

/** `report` of `goals/baiter-run`. */
export interface BaiterRunReport {
  baiterRuns: number;
}

/** `409 noBaiter` unless a finished Baiter stands on the yard. */
const requireBaiter = (save: Save): void => {
  const standing = Object.values(save.buildingdata ?? {}).some(
    (building) => building && Number(building.t) === BAITER_TYPE && levelOf(building) >= 1,
  );
  if (!standing) throw yardRefusedErr("noBaiter", "Build a Wild Monster Baiter first.");
};

/** `goals/baiter-start`: issues the run's token. */
export const planBaiterStart = async (
  save: Save,
  userid: number,
  now: number,
  store: BaiterTokenStore,
  makeToken: () => string = () => crypto.randomUUID(),
) => {
  requireBaiter(save);
  const token = makeToken();
  await store.issue(userid, { token, at: now });
  const report: BaiterStartReport = { token };
  return { report };
};

/** `goals/baiter-run`: spends the token and counts the run. */
export const planBaiterRun = async (
  save: Save,
  userid: number,
  token: string,
  now: number,
  store: BaiterTokenStore,
) => {
  const ticket = await store.take(userid);
  if (!ticket || ticket.token !== token) {
    throw yardRefusedErr("noRun", "That practice run was not started here.");
  }
  if (now - ticket.at < BAITER_MIN_SECONDS) {
    throw yardRefusedErr("tooSoon", "That practice run ended too soon to count.");
  }
  requireBaiter(save);
  const onboarding = updateOnboarding(save, (record) => {
    record.counters.baiterRuns += 1;
  });
  const report: BaiterRunReport = { baiterRuns: onboarding.counters.baiterRuns };
  return { report, slices: { onboarding } };
};
