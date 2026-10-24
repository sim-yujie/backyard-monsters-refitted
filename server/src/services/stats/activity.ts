/**
 * The day-by-day record behind the dashboard's daily numbers
 * (`dailyStats.ts`): who played each UTC day, who took part in each event,
 * how many wild monster raids landed and how many errors came in.
 *
 * The game calls the `note*` functions where those things happen (own-yard
 * load and presence ping, event progress, raid landing, error store). They
 * hand the fact to a recorder that `server.ts` installs at start-up
 * ({@link setActivityRecorder}); with none installed (tests, scripts) they do
 * nothing. A note never throws and is never awaited by the game: a failed
 * write only loses one mark.
 *
 * The Redis recorder ({@link redisActivityRecorder}) keeps, per UTC day:
 *
 * - `stats:active:<day>` — a set of the account numbers seen that day;
 * - `stats:event:<day>:<eventId>` — a set per event;
 * - `stats:raids:<day>` and `stats:errors:<day>:<source>` — counters.
 *
 * Each key lives {@link ACTIVITY_TTL_SECONDS}, long enough for the daily
 * count to read it after a few days of downtime. Bots and test accounts are
 * marked too; the count leaves them out (`realPlayers.ts`).
 */

/** How long a day's keys are kept: 8 days. */
export const ACTIVITY_TTL_SECONDS = 8 * 24 * 60 * 60;

export type ErrorSource = "browser" | "server";

export interface ActivityRecorder {
  activePlayer(day: string, userid: number): Promise<void>;
  eventPlayer(day: string, eventId: string, userid: number): Promise<void>;
  tribeRaid(day: string): Promise<void>;
  errors(day: string, source: ErrorSource, count: number): Promise<void>;
}

/** The UTC day of `at` as `YYYY-MM-DD`. */
export const utcDay = (at: number | Date = Date.now()): string => new Date(at).toISOString().slice(0, 10);

export const activeKey = (day: string): string => `stats:active:${day}`;
export const eventKey = (day: string, eventId: string): string => `stats:event:${day}:${eventId}`;
export const eventIdsKey = (day: string): string => `stats:eventids:${day}`;
export const raidsKey = (day: string): string => `stats:raids:${day}`;
export const errorsKey = (day: string, source: ErrorSource): string => `stats:errors:${day}:${source}`;

let recorder: ActivityRecorder | null = null;
let onFailure: (err: unknown) => void = () => {};

/** Installs (or, with null, removes) the recorder; `failed` hears each failed write. */
export const setActivityRecorder = (next: ActivityRecorder | null, failed: (err: unknown) => void = () => {}): void => {
  recorder = next;
  onFailure = failed;
};

const note = (write: (r: ActivityRecorder) => Promise<void>): void => {
  if (!recorder) return;
  try {
    write(recorder).catch((err) => onFailure(err));
  } catch (err) {
    onFailure(err);
  }
};

/** The player opened the game today (own-yard load or presence ping). */
export const noteActivePlayer = (userid: number, now: number = Date.now()): void =>
  note((r) => r.activePlayer(utcDay(now), userid));

/** The player made progress in event `eventId` today. */
export const noteEventPlayer = (eventId: string, userid: number, now: number = Date.now()): void =>
  note((r) => r.eventPlayer(utcDay(now), eventId, userid));

/** A wild monster raid landed on a player's yard. */
export const noteTribeRaid = (now: number = Date.now()): void => note((r) => r.tribeRaid(utcDay(now)));

/** `count` errors came in from `source`. */
export const noteErrors = (source: ErrorSource, count: number, now: number = Date.now()): void => {
  if (count > 0) note((r) => r.errors(utcDay(now), source, count));
};

/** The few Redis commands the recorder and the daily count use (Bun's `RedisClient` has them). */
export interface ActivityRedis {
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  incrby(key: string, increment: number): Promise<number>;
  get(key: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<number>;
}

/**
 * A recorder on Redis. A set's expiry is set when its day's first member
 * arrives (and again harmlessly when an existing member is re-added), so a
 * busy day costs one write per player per mark, not two.
 */
export const redisActivityRecorder = (redis: ActivityRedis): ActivityRecorder => {
  const addTo = async (key: string, member: string) => {
    const added = await redis.sadd(key, member);
    if (added > 0) await redis.expire(key, ACTIVITY_TTL_SECONDS);
  };
  const addCount = async (key: string, by: number) => {
    const total = await redis.incrby(key, by);
    if (total === by) await redis.expire(key, ACTIVITY_TTL_SECONDS);
  };
  return {
    activePlayer: (day, userid) => addTo(activeKey(day), String(userid)),
    eventPlayer: async (day, eventId, userid) => {
      await addTo(eventKey(day, eventId), String(userid));
      await addTo(eventIdsKey(day), eventId);
    },
    tribeRaid: (day) => addCount(raidsKey(day), 1),
    errors: (day, source, count) => addCount(errorsKey(day, source), count),
  };
};
