import { get, post } from "./http";
import type { ApiEnvelope, YardResponse } from "./types";
import {
  readCheckin,
  readWeekendState,
  setWeekend,
  setWeekendCheckin,
  type WeekendCheckin,
  type WeekendState,
} from "@/game/weekend";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";

/**
 * `GET /api/:apiVersion/bm/weekend`: the weekend event on now and the next
 * (`server/src/controllers/events/routes.ts`), and the player's check-in for
 * the one on now. The answer also sets the client's weekend state and server
 * clock (`game/weekend.ts`).
 */
export const refreshWeekend = async (): Promise<WeekendState> => {
  const body = await get<ApiEnvelope & { now?: number; checkin?: unknown }>("/api/:apiVersion/bm/weekend");
  const state = readWeekendState(body);
  setWeekend(state, typeof body.now === "number" ? body.now : undefined);
  if (body.checkin !== undefined || state.active === null) setWeekendCheckin(readCheckin(body.checkin));
  return state;
};

/** What a check-in answers (`server/src/controllers/yard/weekendCheckin.ts`). */
export interface WeekendCheckinReport {
  readonly paid: number;
  readonly checkin: unknown;
}

/**
 * `POST /api/:apiVersion/bm/yard/events/weekend/checkin`: today's check-in,
 * 50 Glimmers once per event day. Refusals: 409 `noWeekend`,
 * `checkedInToday { checkin, nextAt }`.
 */
export const postWeekendCheckin = (): Promise<YardResponse<WeekendCheckinReport>> =>
  post<YardResponse<WeekendCheckinReport>>("/api/:apiVersion/bm/yard/events/weekend/checkin", {});

/** The store queue's key for a check-in. */
export const WEEKEND_CHECKIN_KEY = actionKey("events", "weekend-checkin");

/**
 * Checks in through the yard store's queue (one at a time; the answer's
 * Glimmers reach the purse and its "+50"), then takes the new check-in
 * state, a refusal's included (another tab got there first).
 */
export const checkInWeekend = async (
  store: Pick<YardStore, "run">,
  send: () => Promise<YardResponse<WeekendCheckinReport>> = postWeekendCheckin,
): Promise<YardActionResult<WeekendCheckinReport>> => {
  const result = await store.run({ key: WEEKEND_CHECKIN_KEY, send });
  const raw = result.ok ? result.report.checkin : result.refusal.detail["checkin"];
  const checkin: WeekendCheckin | null = readCheckin(raw);
  if (checkin) setWeekendCheckin(checkin);
  return result;
};

/**
 * {@link checkInWeekend} for a button: null when it went through, or today
 * was already checked in (another tab: the button just turns to done), else
 * the refusal's sentence to show under it.
 */
export const checkInWeekendMessage = async (
  store: Pick<YardStore, "run">,
  send?: () => Promise<YardResponse<WeekendCheckinReport>>,
): Promise<string | null> => {
  const result = await checkInWeekend(store, send);
  return result.ok || result.refusal.reason === "checkedInToday" ? null : result.refusal.message;
};
