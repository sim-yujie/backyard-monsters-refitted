import { get } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The Brukkarg attack event on now (beta 10: Creature Carnage, Brukkarg War's
 * yards; server `services/events/yards/`).
 *
 *   GET /api/:apiVersion/bm/events/yards → { now, event: EventYards | null }
 *
 * The attack itself is an ordinary `wmattack` load of the yard's base id
 * (`"901"`-`"915"`) with `mapversion: 1`, fought as a Map Room 1 tribe; its
 * save answers {@link EventYardLanded} as `eventyard`.
 */

export type YardEventKey = "carnage" | "brukwar";

export interface EventYardView {
  readonly baseid: string;
  /** 1-based place in the attack order. */
  readonly index: number;
  readonly destroyed: boolean;
  /** Damage the last attack left, 0-100; 0 once repaired. */
  readonly damage: number;
  /** When a damaged yard is whole again (unix s), 0 for none. */
  readonly repairsAt: number;
  readonly next: boolean;
  /** Brukkarg War: waves still to beat before it opens. */
  readonly wavesNeeded: number;
  /** The copy of the player's own yard. */
  readonly copy: boolean;
}

export interface YardPrizeView {
  readonly yards: number;
  readonly glimmers?: number;
  readonly decoration?: number;
  readonly spurtz?: 1 | 2 | 3;
}

export interface EventYards {
  readonly event: YardEventKey;
  readonly runId: string;
  readonly endsAt: number;
  readonly yards: readonly EventYardView[];
  readonly beaten: number;
  /** Why the player cannot take part ("For Town Hall 2 to 4."), or null. */
  readonly locked: string | null;
  readonly waves?: number;
  readonly prizes: readonly YardPrizeView[];
}

/** What the landing says on the attack save (`eventyard`). */
export interface EventYardLanded {
  readonly event: YardEventKey;
  readonly baseid: string;
  /** The Town Hall fell. */
  readonly won: boolean;
  readonly damage: number;
  readonly beaten: number;
  readonly total: number;
  readonly prizes: readonly YardPrizeView[];
}

export const fetchEventYards = async (): Promise<{ now: number; event: EventYards | null }> => {
  const body = await get<ApiEnvelope & { now?: number; event?: EventYards | null }>("/api/:apiVersion/bm/events/yards");
  return { now: typeof body.now === "number" ? body.now : Math.floor(Date.now() / 1000), event: body.event ?? null };
};

/** The landing's `eventyard`, or null for any other save. */
export const eventYardLandedOf = (response: unknown): EventYardLanded | null => {
  const value = (response as { eventyard?: unknown } | null)?.eventyard;
  if (!value || typeof value !== "object") return null;
  const landed = value as Partial<EventYardLanded>;
  return typeof landed.won === "boolean" && typeof landed.beaten === "number" && Array.isArray(landed.prizes)
    ? (landed as EventYardLanded)
    : null;
};

/** The tribe's name for any event yard. */
export const BRUKKARG = "Brukkarg";

/** Whether a base id is a Brukkarg event yard. */
export const isEventYardId = (baseid: unknown): boolean => {
  const id = Number(baseid);
  return Number.isInteger(id) && id >= 901 && id <= 915;
};
