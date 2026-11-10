import { COSTS, maxLevel } from "../../game-data/buildingCosts.js";
import { isListed, LISTED_MONSTERS, monsterEntry } from "../../game-data/monsterCatalogue.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { STARTER_MONSTER } from "../yard/locker.js";
import { levelOf } from "../yardplanner/costs.js";

/**
 * What a trade request is for (owner, 10 Nov 2026: "im unclear what the
 * upgrade or monster is"). The asker picks the real thing from their own
 * main yard: a building's next level ("Town Hall L7") or one of their
 * unlocked monsters. Stored in `alliance_trade_request.reason` (16 chars) as
 * `b:<type>:<level>` or `m:<id>`; the window draws the building's picture or
 * the monster's portrait with its name.
 */

export type TradeFor =
  | { readonly kind: "building"; readonly type: number; readonly level: number }
  | { readonly kind: "monster"; readonly id: string };

/** The asker's choices: buildings' next levels, and unlocked monsters. */
export interface TradeChoices {
  readonly buildings: readonly { readonly type: number; readonly level: number }[];
  readonly monsters: readonly string[];
}

const BUILDING = /^b:(\d{1,4}):(\d{1,3})$/;
const MONSTER = /^m:([A-Z]{1,3}\d{1,3})$/;

/** The stored text as a {@link TradeFor}; anything else (old reasons, junk) is null. */
export const parseTradeFor = (raw: unknown): TradeFor | null => {
  if (typeof raw !== "string") return null;
  const building = BUILDING.exec(raw);
  if (building) return { kind: "building", type: Number(building[1]), level: Number(building[2]) };
  const monster = MONSTER.exec(raw);
  if (monster) return { kind: "monster", id: monster[1] };
  return null;
};

/** The stored text of a {@link TradeFor}. */
export const tradeForText = (value: TradeFor): string =>
  value.kind === "building" ? `b:${value.type}:${value.level}` : `m:${value.id}`;

/** "Town Hall L7" / "Bandito", for the chat line; null for an unknown one. */
export const tradeForName = (value: TradeFor | null): string | null => {
  if (!value) return null;
  if (value.kind === "monster") return monsterEntry(value.id)?.name ?? null;
  const name = COSTS[value.type]?.name;
  return name ? `${name} L${value.level}` : null;
};

/**
 * What a main yard can ask for: every building type below its top level, at
 * each next level its buildings would reach (two Snipers at L3 and L5 give
 * Sniper L4 and L6), and every unlocked monster (the Pokey always).
 */
export const tradeChoicesOf = (save: {
  readonly buildingdata?: unknown;
  readonly lockerdata?: unknown;
}): TradeChoices => {
  const seen = new Set<string>();
  const buildings: { type: number; level: number }[] = [];
  for (const raw of Object.values((save.buildingdata ?? {}) as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const building = raw as { t?: unknown };
    const type = Number(building.t);
    const level = levelOf(building as Parameters<typeof levelOf>[0]);
    if (!Number.isInteger(type) || type <= 0 || level <= 0) continue;
    if (level >= maxLevel(type, "main") || COSTS[type]?.kind === "decoration") continue;
    const key = `${type}:${level + 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    buildings.push({ type, level: level + 1 });
  }
  buildings.sort((a, b) => a.type - b.type || a.level - b.level);

  const locker = (save.lockerdata ?? {}) as JsonObject;
  const monsters = LISTED_MONSTERS.map((entry) => entry.id).filter((id) => {
    if (id === STARTER_MONSTER) return true;
    const entry = locker[id];
    return !!entry && typeof entry === "object" && Number((entry as JsonObject).t) === 2;
  });
  return { buildings, monsters };
};

/** Whether `value` is one of the asker's choices now. */
export const isTradeChoice = (value: TradeFor, choices: TradeChoices): boolean =>
  value.kind === "building"
    ? choices.buildings.some((b) => b.type === value.type && b.level === value.level)
    : isListed(value.id) && choices.monsters.includes(value.id);
