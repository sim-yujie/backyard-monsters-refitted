import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import type { EventReward, GrantedReward } from "./events";
import { post } from "./http";
import type { YardResponse } from "./types";

/**
 * The quest window's routes (beta 6; server `controllers/yard/questsActions.ts`).
 * All are yard actions on the main yard; an outpost or the Inferno is refused.
 *
 *   POST /api/:apiVersion/bm/yard/quests/state         {}               the window's read
 *   POST /api/:apiVersion/bm/yard/quests/login/claim   {}               today's login card day
 *   POST /api/:apiVersion/bm/yard/quests/claim         { period, slot } one finished quest
 *   POST /api/:apiVersion/bm/yard/quests/bonus/claim   { period }       the all-done bonus
 *   POST /api/:apiVersion/bm/yard/quests/swap          { slot }         the free daily swap
 *
 * Every answer carries the yard state (the store merges what a claim paid)
 * and `questsClaimable`, the button's red number.
 */

const QUESTS_PATH = "/api/:apiVersion/bm/yard/quests";

export type QuestPeriod = "daily" | "weekly";

/** One quest as the window shows it (server `services/quests/view.ts`). */
export interface QuestView {
  slot: number;
  /** The kind's id: `hatchMonster`, `destroyTribe`, `weeklyFights`, … */
  kind: string;
  /** A monster id (`C2`), a tribe (`kozu`) or a building type (`"20"`). */
  variant?: string;
  need: number;
  have: number;
  claimed: boolean;
  /** Finished and not claimed: the Claim button shows. */
  ready: boolean;
  rewards: EventReward[];
}

export interface QuestBonusView {
  shiny: number;
  ready: boolean;
  claimed: boolean;
}

export interface QuestSetView {
  quests: QuestView[];
  bonus: QuestBonusView;
}

export interface QuestsView {
  /** The server's clock, unix s. */
  now: number;
  /** The next 00:00 UTC: the daily quests and the login day turn over. */
  nextDayAt: number;
  /** The next Monday 00:00 UTC: the weekly quests turn over. */
  nextWeekAt: number;
  /** Everything waiting for a Claim tap: the red number. */
  claimable: number;
  login: {
    /** Today's day on the card, 1-7. */
    day: number;
    claimedToday: boolean;
    /** Days claimed on the card shown. */
    onCard: number;
    /** Shiny per day, day 1 first. */
    shiny: number[];
  };
  daily: QuestSetView & { swapsLeft: number };
  weekly: QuestSetView;
}

export interface QuestsReport {
  quests: QuestsView;
  /** What a claim paid (resources after the storage cap). */
  granted?: GrantedReward[];
  /** The login day claimed, 1-7. */
  day?: number;
}

export const questsState = (): Promise<YardResponse<QuestsReport>> =>
  post<YardResponse<QuestsReport>>(`${QUESTS_PATH}/state`, {});

/** Refusal: 409 `claimedToday { nextAt }`. */
export const claimLogin = (): Promise<YardResponse<QuestsReport>> =>
  post<YardResponse<QuestsReport>>(`${QUESTS_PATH}/login/claim`, {});

/** Refusals: 409 `noSuchQuest`, `notDone`, `claimed`. */
export const claimQuest = (period: QuestPeriod, slot: number): Promise<YardResponse<QuestsReport>> =>
  post<YardResponse<QuestsReport>>(`${QUESTS_PATH}/claim`, { period, slot });

/** Refusals: 409 `bonusNotReady`, `bonusClaimed`. */
export const claimQuestBonus = (period: QuestPeriod): Promise<YardResponse<QuestsReport>> =>
  post<YardResponse<QuestsReport>>(`${QUESTS_PATH}/bonus/claim`, { period });

/** Refusals: 409 `noSwapsLeft`, `cannotSwap`, `nothingToSwapTo`, `noSuchQuest`. */
export const swapQuest = (slot: number): Promise<YardResponse<QuestsReport>> =>
  post<YardResponse<QuestsReport>>(`${QUESTS_PATH}/swap`, { slot });

/** The calls, so tests can hand in stand-ins. */
export interface QuestsApi {
  state: typeof questsState;
  claimLogin: typeof claimLogin;
  claim: typeof claimQuest;
  claimBonus: typeof claimQuestBonus;
  swap: typeof swapQuest;
}

export const questsApi: QuestsApi = {
  state: questsState,
  claimLogin,
  claim: claimQuest,
  claimBonus: claimQuestBonus,
  swap: swapQuest,
};

export const QuestsKey = {
  STATE: actionKey("quests", "state"),
  LOGIN: actionKey("quests", "login"),
  claim: (period: QuestPeriod, slot: number): string => actionKey("quests", `${period}:${slot}`),
  bonus: (period: QuestPeriod): string => actionKey("quests", `bonus:${period}`),
  swap: (slot: number): string => actionKey("quests", `swap:${slot}`),
} as const;

export interface QuestsActions {
  state(): Promise<YardActionResult<QuestsReport>>;
  claimLogin(): Promise<YardActionResult<QuestsReport>>;
  claim(period: QuestPeriod, slot: number): Promise<YardActionResult<QuestsReport>>;
  claimBonus(period: QuestPeriod): Promise<YardActionResult<QuestsReport>>;
  swap(slot: number): Promise<YardActionResult<QuestsReport>>;
}

/** The routes through the store's one-at-a-time queue, which merges each answer. */
export const questsActions = (store: Pick<YardStore, "run">, api: QuestsApi = questsApi): QuestsActions => ({
  state: () => store.run({ key: QuestsKey.STATE, send: () => api.state() }),
  claimLogin: () => store.run({ key: QuestsKey.LOGIN, send: () => api.claimLogin() }),
  claim: (period, slot) => store.run({ key: QuestsKey.claim(period, slot), send: () => api.claim(period, slot) }),
  claimBonus: (period) => store.run({ key: QuestsKey.bonus(period), send: () => api.claimBonus(period) }),
  swap: (slot) => store.run({ key: QuestsKey.swap(slot), send: () => api.swap(slot) }),
});
