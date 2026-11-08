import { get } from "./http";
import type { ApiEnvelope } from "./types";
import { readWeekendState, setWeekend, type WeekendState } from "@/game/weekend";

/**
 * `GET /api/:apiVersion/bm/weekend`: the weekend event on now and the next
 * (`server/src/controllers/events/routes.ts`). The answer also sets the
 * client's weekend state and server clock (`game/weekend.ts`).
 */
export const refreshWeekend = async (): Promise<WeekendState> => {
  const body = await get<ApiEnvelope & { now?: number }>("/api/:apiVersion/bm/weekend");
  const state = readWeekendState(body);
  setWeekend(state, typeof body.now === "number" ? body.now : undefined);
  return state;
};
