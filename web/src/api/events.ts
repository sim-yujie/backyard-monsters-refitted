import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { get, post } from "./http";
import type { ApiEnvelope, YardResponse } from "./types";

/**
 * The events routes (server `controllers/events/eventsState.ts` and
 * `controllers/yard/eventsActions.ts`):
 *
 *   GET  /api/:apiVersion/bm/events                         the list, the server's clock, the last "What's new" seen
 *   POST /api/:apiVersion/bm/whatsnew/seen  version         the player has seen the cards up to `version`
 *   POST /api/:apiVersion/bm/yard/events/calendar/claim  event        today's login-calendar reward
 *   POST /api/:apiVersion/bm/yard/events/ladder/claim    event, tier  one collection-ladder tier
 *
 * The claims are yard actions on the main yard: their answers carry the yard
 * state, so the store merges the resources, Shiny and store items they pay.
 */

/** Resource amounts, Twigs `r1` to Goo `r4`. */
export type EventResources = Partial<Record<"r1" | "r2" | "r3" | "r4", number>>;

/** One reward as the event list sends it (server `game-data/events/eventRewards.ts`). */
export type EventReward =
  | { readonly kind: "resources"; readonly amounts: EventResources }
  | { readonly kind: "shiny"; readonly amount: number }
  | { readonly kind: "shopItem"; readonly item: string }
  | { readonly kind: "speedup"; readonly item: string; readonly count: number }
  | { readonly kind: "decoration"; readonly type: number; readonly count: number }
  /** Event coins (beta 7): the decorations shop's currency. */
  | { readonly kind: "eventCoins"; readonly amount: number }
  /** The champion Krallen: level 1 the first time, one level more each later win, at most 5. */
  | { readonly kind: "krallen" }
  /** Krallen's loot aura until `until` (unix s): the Krallen Hunt's 3x mark; she fights with it from level 3. */
  | { readonly kind: "krallenAura"; readonly until: number }
  /** One of Korath's powers (Monster Madness): 1 Burn, 2 Breath of Fire, 3 Fists of Doom. */
  | { readonly kind: "korath"; readonly power: number };

/** One reward as a claim paid it (server `services/events/grant.ts`). */
export type GrantedReward =
  | { kind: "resources"; amounts: EventResources; credited: EventResources; overflow: EventResources }
  | { kind: "shiny"; amount: number }
  | { kind: "shopItem"; item: string; endsAt: number }
  | { kind: "speedup"; item: string; count: number; held: number }
  | { kind: "decoration"; type: number; count: number; stored: number }
  | { kind: "eventCoins"; amount: number }
  /** `raised` false: she was at the top already and nothing changed. */
  | { kind: "krallen"; level: number; raised: boolean }
  /** Her aura's end (unix s, 0 without a Krallen), her level when paid, and whether she had a Krallen. */
  | { kind: "krallenAura"; until: number; level: number; hasKrallen: boolean }
  /** Korath's power now; `raised` false when it was that high already; `hasKorath` false when it waits for him. */
  | { kind: "korath"; power: number; raised: boolean; hasKorath: boolean };

export interface CalendarView {
  /** Each day's rewards, day 1 first. */
  days: EventReward[][];
  /** Days claimed so far. */
  claimed: number;
  /** Whether a claim now would be paid. */
  canClaim: boolean;
  /** When the next day opens (unix s), while today's is claimed and days are left. */
  nextAt: number | null;
}

export interface LadderTierView {
  need: number;
  rewards: EventReward[];
  claimed: boolean;
}

export interface LadderView {
  label: string;
  counter: number;
  tiers: LadderTierView[];
}

export interface EventView {
  id: string;
  title: string;
  text: string;
  kind: string;
  /** A picture under /public, or null. */
  banner: string | null;
  /** "ended": over, with a ladder tier the player can still claim until `claimUntil`. */
  status: "active" | "upcoming" | "ended";
  /** Unix seconds. */
  startsAt: number;
  endsAt: number;
  /** When ladder claims close (unix s), for an event that keeps them open after its end; else null. */
  claimUntil: number | null;
  /** Why the player cannot take part (Town Hall too low, guided start not done), in words; null when they can. */
  locked: string | null;
  calendar: CalendarView | null;
  ladder: LadderView | null;
  /**
   * For an event that pays Krallen: her level now (0 for none), the top an
   * event raises her to, and when her loot aura runs out (unix s, 0 for none;
   * absent from an older server). `startLevel` is her level when the hunt
   * began, `minimum` the loot below which its end takes a level (0: none),
   * `penalty` what its end took; all absent from an older server.
   */
  krallen: {
    level: number;
    maxLevel: number;
    auraUntil?: number;
    startLevel?: number;
    minimum?: number;
    penalty?: { from: number; to: number } | null;
  } | null;
}

export interface EventsBody extends ApiEnvelope {
  error: 0;
  /** The server's clock (unix s), so countdowns do not trust the device's. */
  now: number;
  events: EventView[];
  /** The last "What's new" release the player saw, or null. */
  whatsNewSeen: string | null;
  /**
   * The player's "New to Map Room 2" card (Frontier Pass), or null when their
   * 10 days are not running. It stays all 10 days, rewards used or not.
   * Absent from an older server.
   */
  mr2Welcome?: Mr2WelcomeStatus | null;
}

/**
 * "New to Map Room 2", the Frontier Pass (server `services/events/mr2Welcome.ts`):
 * 10 days with 7 sets, a set being a cheap wild camp takeover and a free
 * Regular kit; at most one of each a day (UTC midnight reset).
 */
export interface Mr2WelcomeStatus {
  /** Unix seconds. */
  startsAt: number;
  endsAt: number;
  /** Whole days left, rounded up. */
  daysLeft: number;
  /** How many of each reward the pass gives (7). */
  sets: number;
  /** The cheap takeover can be used now. */
  takeover: boolean;
  /** The free Regular kit can be used now. */
  kit: boolean;
  /** Cheap takeovers left of `sets`. */
  takeoverLeft: number;
  /** Free kits left of `sets`. */
  kitLeft: number;
  /** Today's takeover is used. */
  takeoverToday: boolean;
  /** Today's kit is used. */
  kitToday: boolean;
  /** The next daily reset (unix seconds): a reward used today is back then, if any are left. */
  nextDayAt: number;
  /** When each takeover was used (unix seconds), where known. */
  takeoverUses: number[];
  /** When each kit was used (unix seconds), where known. */
  kitUses: number[];
}

export interface CalendarClaimReport {
  event: string;
  day: number;
  granted: GrantedReward[];
  nextAt: number | null;
}

export interface LadderClaimReport {
  event: string;
  tier: number;
  granted: GrantedReward[];
}

export const getEvents = (): Promise<EventsBody> => get<EventsBody>("/api/:apiVersion/bm/events");

export const markWhatsNewSeen = (version: string): Promise<ApiEnvelope> =>
  post<ApiEnvelope>("/api/:apiVersion/bm/whatsnew/seen", { version });

const EVENTS_PATH = "/api/:apiVersion/bm/yard/events";

/**
 * Today's calendar reward. Refusals: 400 `unknownEvent`; 409 `eventNotActive`,
 * `claimedToday { nextAt }`, `calendarDone`.
 */
export const claimCalendar = (event: string): Promise<YardResponse<CalendarClaimReport>> =>
  post<YardResponse<CalendarClaimReport>>(`${EVENTS_PATH}/calendar/claim`, { event });

/**
 * One ladder tier, while the event is on or, for one with claim days, until
 * its `claimUntil`. Refusals: 400 `unknownEvent`, `unknownTier`; 409
 * `eventNotActive`, `tierClaimed`, `tierLocked { have, need }`.
 */
export const claimLadderTier = (event: string, tier: number): Promise<YardResponse<LadderClaimReport>> =>
  post<YardResponse<LadderClaimReport>>(`${EVENTS_PATH}/ladder/claim`, { event, tier });

/** The calls the Events page makes, so tests can hand it stand-ins. */
export interface EventsApi {
  list: typeof getEvents;
  claimCalendar: typeof claimCalendar;
  claimTier: typeof claimLadderTier;
}

export const eventsApi: EventsApi = { list: getEvents, claimCalendar, claimTier: claimLadderTier };

export const EventsKey = {
  calendar: (event: string): string => actionKey("events", `calendar-${event}`),
  tier: (event: string, tier: number): string => actionKey("events", `tier-${event}-${tier}`),
} as const;

export interface EventsActions {
  claimCalendar(event: string): Promise<YardActionResult<CalendarClaimReport>>;
  claimTier(event: string, tier: number): Promise<YardActionResult<LadderClaimReport>>;
}

/** The claims through the store's one-at-a-time queue, which merges each answer. */
export const eventsActions = (store: Pick<YardStore, "run">, api: EventsApi = eventsApi): EventsActions => ({
  claimCalendar: (event) => store.run({ key: EventsKey.calendar(event), send: () => api.claimCalendar(event) }),
  claimTier: (event, tier) => store.run({ key: EventsKey.tier(event, tier), send: () => api.claimTier(event, tier) }),
});
