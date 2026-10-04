import { post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The in-game check (#273): "Quick check: tap the Pokey", asked by the server
 * when it sees bot-like play (`server/src/services/user/botChallenge.ts`).
 * While it waits the player counts as away and can be attacked.
 *
 *   POST /api/:apiVersion/bm/presence/check          the check waiting, made if none yet
 *   POST /api/:apiVersion/bm/presence/check/answer   challenge, option: one tap
 *   POST /api/:apiVersion/bm/presence/check/dev      DEV only, a local server: ask for one now
 *
 * The server keeps the answer: the client gets opaque ids and the monsters to
 * draw, in the order to draw them.
 */
export const CHECK_PATH = "/api/:apiVersion/bm/presence/check";
export const CHECK_ANSWER_PATH = "/api/:apiVersion/bm/presence/check/answer";
export const CHECK_DEV_PATH = "/api/:apiVersion/bm/presence/check/dev";

/** One portrait to tap. */
export interface BotCheckOption {
  /** Means nothing outside this check. */
  readonly id: string;
  /** The monster to draw, e.g. `C1`. */
  readonly monster: string;
}

export interface BotCheckChallenge {
  readonly id: string;
  /** "Tap the Pokey". */
  readonly prompt: string;
  readonly options: readonly BotCheckOption[];
}

/** What the three routes answer. */
export interface BotCheckAnswer extends ApiEnvelope {
  /** The server's clock, unix seconds. */
  readonly now?: number;
  readonly checkPending?: boolean;
  /** The check to show, while one waits. */
  readonly challenge?: BotCheckChallenge;
  /** After too many wrong answers: when the next check comes, unix seconds. */
  readonly cooldownUntil?: number;
  /** The answer route only: the tap was right. */
  readonly solved?: boolean;
}

export const fetchBotCheck = (): Promise<BotCheckAnswer> => post<BotCheckAnswer>(CHECK_PATH);

export const answerBotCheck = (challenge: string, option: string): Promise<BotCheckAnswer> =>
  post<BotCheckAnswer>(CHECK_ANSWER_PATH, { challenge, option });

/** DEV only; a server that is not local answers 404. */
export const forceBotCheck = (): Promise<BotCheckAnswer> => post<BotCheckAnswer>(CHECK_DEV_PATH);
