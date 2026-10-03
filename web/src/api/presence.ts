import { post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * `POST /api/:apiVersion/bm/presence` (#242): refreshes the player's "online"
 * key on the server for two minutes, so nobody can attack their main yard
 * while they sit in the game. Carries nothing and answers `{ error: 0 }`.
 */
export const PRESENCE_PATH = "/api/:apiVersion/bm/presence";

export const sendPresence = (): Promise<ApiEnvelope> => post<ApiEnvelope>(PRESENCE_PATH);
