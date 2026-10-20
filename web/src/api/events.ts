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
  | { readonly kind: "decoration"; readonly type: number; readonly count: number };

/** One reward as a claim paid it (server `services/events/grant.ts`). */
export type GrantedReward =
  | { kind: "resources"; amounts: EventResources; credited: EventResources; overflow: EventResources }
  | { kind: "shiny"; amount: number }
  | { kind: "shopItem"; item: string; endsAt: number }
  | { kind: "speedup"; item: string; count: number; held: number }
  | { kind: "decoration"; type: number; count: number; stored: number };

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
  status: "active" | "upcoming";
  /** Unix seconds. */
  startsAt: number;
  endsAt: number;
  calendar: CalendarView | null;
  ladder: LadderView | null;
}

export interface EventsBody extends ApiEnvelope {
  error: 0;
  /** The server's clock (unix s), so countdowns do not trust the device's. */
  now: number;
  events: EventView[];
  /** The last "What's new" release the player saw, or null. */
  whatsNewSeen: string | null;
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
 * One ladder tier. Refusals: 400 `unknownEvent`, `unknownTier`; 409
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
