import { post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The in-game check (#273): "How many of these are in the picture?", asked by
 * the server when it sees bot-like play
 * (`server/src/services/user/botChallenge.ts`). While it waits the player
 * counts as away and can be attacked.
 *
 *   POST /api/:apiVersion/bm/presence/check          the check waiting, made if none yet
 *   POST /api/:apiVersion/bm/presence/check/answer   challenge, option: the number tapped, 1-9
 *   POST /api/:apiVersion/bm/presence/check/dev      DEV only, a local server: ask for one now
 *
 * The server draws the picture and keeps the answer: the client gets the
 * picture and a reference portrait as image bytes, the monster's name and an
 * opaque id; no monster id, position or count.
 */
export const CHECK_PATH = "/api/:apiVersion/bm/presence/check";
export const CHECK_ANSWER_PATH = "/api/:apiVersion/bm/presence/check/answer";
export const CHECK_DEV_PATH = "/api/:apiVersion/bm/presence/check/dev";

/** The answer buttons run from 1 to this (the server's `CHALLENGE_ANSWER_MAX`). */
export const BOT_CHECK_ANSWER_MAX = 9;

export interface BotCheckChallenge {
  readonly id: string;
  /** "How many of these are in the picture?" */
  readonly prompt: string;
  /** The monster to count, by name. */
  readonly name: string;
  /** Its portrait, a `data:` image URL. */
  readonly reference: string;
  /** The picture to count in, a `data:` image URL. */
  readonly picture: string;
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

/** `option` is the number tapped, as a string. */
export const answerBotCheck = (challenge: string, option: string): Promise<BotCheckAnswer> =>
  post<BotCheckAnswer>(CHECK_ANSWER_PATH, { challenge, option });

/** DEV only; a server that is not local answers 404. */
export const forceBotCheck = (): Promise<BotCheckAnswer> => post<BotCheckAnswer>(CHECK_DEV_PATH);
