import { post, postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * `POST /api/:apiVersion/bm/presence` (#242): refreshes the player's presence
 * mark on the server for two minutes. A ping alone does not keep the player
 * safe from attack: that takes a real game action in the last ten minutes too
 * (#271). It carries what the player is looking at ({@link PresenceScreen},
 * #226): a ping saying "yard, Planner closed" may open a wild monster raid.
 */
export const PRESENCE_PATH = "/api/:apiVersion/bm/presence";

/**
 * `POST /api/:apiVersion/bm/presence/stay`: the "Stay protected?" prompt's
 * tap (#275). A real game action, so the player cannot be attacked for ten
 * more minutes; it answers as a ping does, with `lastAction` already now.
 */
export const STAY_PROTECTED_PATH = "/api/:apiVersion/bm/presence/stay";

/** What both answer (#275, the server's `PresenceAnswer`); all optional for an older server. */
export interface PresenceAnswer extends ApiEnvelope {
  /** The server's clock, unix seconds. */
  readonly now?: number;
  /** The last real game action, unix seconds; 0 when none in the last ten minutes. */
  readonly lastAction?: number;
  /** An in-game check waits for an answer (#273, `api/botCheck.ts`); the player counts as away until then. */
  readonly checkPending?: boolean;
  /** An attack running on the player's main yard: who by, and when it runs out at the latest. */
  readonly attack?: { readonly by: string; readonly ends: number };
  /** The open wild monster raid (#226, `api/raid.ts` `RaidView`); checked by `parseRaidView`. */
  readonly raid?: unknown;
}

/**
 * Where the player is, as the ping says it (#226, `docs/design/wild-raids.md`
 * §7.3): on their own main yard or anywhere else, and whether the Yard
 * Planner is open there. A raid opens and starts only on the yard with the
 * Planner closed.
 */
export interface PresenceScreen {
  readonly where: "yard" | "other";
  readonly planner: boolean;
}

/** Anywhere but the own main yard. */
export const ELSEWHERE: PresenceScreen = { where: "other", planner: false };

/** Sent as JSON, because the server wants `planner` as a real boolean. */
export const sendPresence = (screen: PresenceScreen = ELSEWHERE): Promise<PresenceAnswer> =>
  postJson<PresenceAnswer>(PRESENCE_PATH, { where: screen.where, planner: screen.planner });

export const stayProtected = (): Promise<PresenceAnswer> => post<PresenceAnswer>(STAY_PROTECTED_PATH);
