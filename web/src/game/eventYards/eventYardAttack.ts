import type { BaseLoadResponse } from "@/api/types";
import { BRUKKARG, type EventYardLanded, type YardEventKey } from "@/api/eventYards";
import { mainYardRoster } from "@/game/attack/attackEntry";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { flingerState, readOwn } from "@/game/maproom1/mr1Model";

/**
 * Attacking a Brukkarg event yard from its Events card (beta 10): the yard,
 * `"901"`-`"915"`, is loaded with `wmattack` and `mapversion: 1`, as a Map
 * Room 1 tribe is, and fought from the main yard's housing alone, whatever
 * the player's Map Room (server `services/events/yards/eventYardAttack.ts`).
 *
 * The card cannot reach the yard scene, so the own-yard plugin
 * (`game/yard/plugins/eventYards.ts`) hands it a starter while the yard is
 * open, and the attack's result comes back the same way: the end panel keeps
 * the landing ({@link noteEventYardLanded}) and the yard shows its prizes
 * once the player is home ({@link takeEventYardLanded}).
 */

/** What an event yard attack carries on its target. */
export interface EventYardTarget {
  readonly event: YardEventKey;
  /** 1-based place in the attack order. */
  readonly index: number;
  readonly total: number;
}

/** Why the own yard cannot attack now, in the card's words, or null. */
export const attackBlocker = (save: BaseLoadResponse): string | null => {
  const flinger = flingerState(save);
  if (flinger.state === "none") return "Build a Flinger to attack.";
  if (flinger.state === "busy") return flinger.why === "damaged" ? "Repair your Flinger first." : "Your Flinger is being upgraded.";
  const own = readOwn(save);
  if (own.army.length === 0 && !own.champion) return "Hatch some monsters first.";
  return null;
};

/** The attack target for event yard `baseid`, or null with the reason. */
export const eventYardTarget = (
  save: BaseLoadResponse,
  baseid: string,
  yard: EventYardTarget,
): { target: AttackTarget | null; blocker: string | null } => {
  const blocker = attackBlocker(save);
  if (blocker) return { target: null, blocker };
  const flinger = flingerState(save);
  const level = flinger.state === "ready" ? flinger.level : 0;
  return {
    target: {
      baseid,
      kind: "wild",
      name: BRUKKARG,
      roster: mainYardRoster(save, level),
      mapversion: 1,
      eventYard: yard,
    },
    blocker: null,
  };
};

type Starter = (baseid: string, yard: EventYardTarget) => string | null;

let starter: Starter | null = null;

/** The own-yard plugin's way into the attack scene; null when no yard is open. */
export const setEventYardStarter = (next: Starter | null): void => {
  starter = next;
};

/** Starts the attack; returns a reason it cannot, or null once it is on its way. */
export const startEventYardAttack = (baseid: string, yard: EventYardTarget): string | null =>
  starter ? starter(baseid, yard) : "Open your yard to attack.";

let landed: EventYardLanded | null = null;

/** The end panel keeps the landing for the yard's prize pop-up. */
export const noteEventYardLanded = (value: EventYardLanded | null): void => {
  if (value) landed = value;
};

/** The landing waiting for the yard, taken once. */
export const takeEventYardLanded = (): EventYardLanded | null => {
  const value = landed;
  landed = null;
  return value;
};
