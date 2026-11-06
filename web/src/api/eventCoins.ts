import { get } from "./http";
import type { ApiEnvelope } from "./types";
import { noteCoins } from "@/game/eventCoins";

/** This weekend's coins for the player: what each part pays and whether it was paid. */
export interface WeekendCoins {
  readonly key: string;
  readonly played: boolean;
  readonly boost: boolean;
  readonly coins: { readonly played: number; readonly boost: number };
}

export interface CoinsAnswer {
  readonly balance: number;
  /** Null when no weekend event runs. */
  readonly weekend: WeekendCoins | null;
}

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

/** Reads a `GET /bm/coins` body defensively; null for a body without a balance. */
export const readCoins = (body: unknown): CoinsAnswer | null => {
  if (!body || typeof body !== "object") return null;
  const raw = body as { balance?: unknown; weekend?: unknown };
  if (typeof raw.balance !== "number") return null;
  const w = raw.weekend as Partial<WeekendCoins> | null | undefined;
  const weekend: WeekendCoins | null =
    w && typeof w === "object" && typeof w.key === "string"
      ? {
          key: w.key,
          played: w.played === true,
          boost: w.boost === true,
          coins: { played: num(w.coins?.played, 25), boost: num(w.coins?.boost, 75) },
        }
      : null;
  return { balance: num(raw.balance, 0), weekend };
};

/**
 * `GET /api/:apiVersion/bm/coins` (`server/src/controllers/events/routes.ts`):
 * the event-coin purse and this weekend's two awards. The balance also goes
 * to the coin module, so a rise since the last one shows its "+N".
 */
export const fetchCoins = async (): Promise<CoinsAnswer | null> => {
  const answer = readCoins(await get<ApiEnvelope>("/api/:apiVersion/bm/coins"));
  if (answer) noteCoins(answer.balance);
  return answer;
};
