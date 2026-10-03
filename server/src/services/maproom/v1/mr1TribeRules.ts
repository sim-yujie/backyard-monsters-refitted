import { TribeScale } from "../../../enums/Tribes.js";
import type { MR1TribeScaleConfig } from "./createMR1Tribes.js";
import { legionnaire } from "../../../game-data/tribes/v1/legionnaire.js";
import { kozu } from "../../../game-data/tribes/v1/kozu.js";
import { abunaki } from "../../../game-data/tribes/v1/abunaki.js";
import { dreadnaught } from "../../../game-data/tribes/v1/dreadnaught.js";
import { LOOT_GAIN_RATIO, RESOURCE_KEYS, type ResourceAmounts } from "../../../game-rules/combat/index.js";
import type { TribeData } from "../../../types/TribeData.js";
import type { SaveData } from "../../../types/EntityData.js";

/**
 * The rules of Map Room 1's four wild monster tribes, pure: which tribe bases
 * a player faces, when a wrecked one is back, and how much loot one tribe can
 * give (issue #161). `createMR1Tribes.ts` and the attack paths read and write
 * the rows; this decides.
 */

/** The four tribes, in the order Flash lays out their spots (`PlayerLayer.as:301-318`). */
export const MR1_TRIBE_TEMPLATES = [legionnaire, kozu, abunaki, dreadnaught] as const;

/** Tribe display names, in {@link MR1_TRIBE_TEMPLATES} order (`TRIBES.as:34-99`). */
export const MR1_TRIBE_NAMES = ["Legionnaire", "Kozu", "Abunakki", "Dreadnaut"] as const;

/** A wrecked tribe is back this long after it fell. */
export const MR1_TRIBE_RESPAWN_SECONDS = 10 * 60;

/** The difficulty tier a Town Hall level faces. */
export const mr1TribeScale = (townHallLevel: number, config: MR1TribeScaleConfig): TribeScale => {
  if (townHallLevel <= config[TribeScale.NEW].maxLevel) return TribeScale.NEW;
  if (townHallLevel <= config[TribeScale.TH3].maxLevel) return TribeScale.TH3;
  if (townHallLevel <= config[TribeScale.TH4].maxLevel) return TribeScale.TH4;
  if (townHallLevel <= config[TribeScale.TH5].maxLevel) return TribeScale.TH5;
  return TribeScale.HIGH;
};

/** One of the player's four tribes. */
export interface MR1TribeSlot {
  /** 0-3, in {@link MR1_TRIBE_TEMPLATES} order. */
  index: number;
  name: (typeof MR1_TRIBE_NAMES)[number];
  scale: TribeScale;
  template: SaveData;
}

/**
 * The four tribe bases a player faces now: one per tribe, at the tier of their
 * Town Hall.
 *
 * Flash put the one-monster tutorial camp (base 1) in the Legionnaire spot
 * until tutorial stage 205. There is no tutorial any more (no Flash client,
 * D1, and the web client has none), so web accounts never reach 205 and the
 * spot would stay the tutorial camp for ever. Every account gets the Town Hall
 * tier instead, whatever stage its save records (issue #132).
 */
export const currentMR1Tribes = (townHallLevel: number, config: MR1TribeScaleConfig): MR1TribeSlot[] => {
  const scale = mr1TribeScale(townHallLevel, config);

  return MR1_TRIBE_TEMPLATES.map((tribe, index) => ({
    index,
    name: MR1_TRIBE_NAMES[index]!,
    scale,
    template: tribe[scale],
  }));
};

/** The four tribes' levels next to the player's, in slot order: one below, level, one and two above. */
export const MR1_TRIBE_LEVEL_OFFSETS = [-1, 0, 1, 2] as const;

/**
 * The `wmstatus` entries opening Map Room 1 gives the four current tribes:
 * `[baseid, level, destroyed]`, each level set by the player's, `destroyed`
 * kept from the entry the player already has (`createMR1Tribes.ts`).
 */
export const mr1TribeStatuses = (
  townHallLevel: number,
  config: MR1TribeScaleConfig,
  playerLevel: number,
  wmstatus: readonly number[][] | null | undefined
): number[][] =>
  currentMR1Tribes(townHallLevel, config).map(({ index, template }) => {
    const baseid = Number(template.baseid);
    const known = wmstatus?.find((status) => status[0] === baseid);
    return [baseid, Math.max(1, Math.max(1, playerLevel) + MR1_TRIBE_LEVEL_OFFSETS[index]!), known ? known[2] || 0 : 0];
  });

/**
 * When a wrecked tribe is back, or 0 when it is standing. A tribe marked
 * destroyed with no time on it (rows written before the time was kept) is back
 * already.
 */
export const mr1TribeRespawnAt = (tribe: Pick<TribeData, "destroyed" | "destroyedAt"> | undefined): number => {
  if (!tribe?.destroyed) return 0;
  return (tribe.destroyedAt ?? 0) + MR1_TRIBE_RESPAWN_SECONDS;
};

/** Whether a wrecked tribe has come back by `now`. */
export const mr1TribeRespawned = (
  tribe: Pick<TribeData, "destroyed" | "destroyedAt">,
  now: number
): boolean => Boolean(tribe.destroyed) && now >= mr1TribeRespawnAt(tribe);

/** Stands a wrecked tribe back up: fresh health, its own monsters, nothing looted yet. */
export const respawnMR1Tribe = (tribe: TribeData): void => {
  tribe.destroyed = 0;
  tribe.destroyedAt = undefined;
  tribe.tribeHealthData = {};
  tribe.monsters = undefined;
  tribe.damage = undefined;
  tribe.looted = undefined;
};

/** The harvester types, whose `st` buffer holds resource 1-4. */
const HARVESTER_RESOURCE: Readonly<Record<number, (typeof RESOURCE_KEYS)[number]>> = {
  1: "r1",
  2: "r2",
  3: "r3",
  4: "r4",
};

/**
 * Everything a tribe base holds: its pool plus what sits in its harvesters.
 * Loot is damage to those buildings (`docs/design/server-combat.md` §2.4), so
 * a tribe cannot give more than this, before the low-level bonus.
 */
export const mr1TribePool = (template: Pick<SaveData, "resources" | "buildingdata">): ResourceAmounts => {
  const pool = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const resources = (template.resources ?? {}) as Record<string, unknown>;

  for (const key of RESOURCE_KEYS) {
    const held = Number(resources[key]);
    if (Number.isFinite(held) && held > 0) pool[key] += held;
  }

  for (const building of Object.values((template.buildingdata ?? {}) as Record<string, unknown>)) {
    if (!building || typeof building !== "object") continue;
    const { t, st } = building as { t?: unknown; st?: unknown };
    const key = HARVESTER_RESOURCE[Number(t)];
    const stored = Number(st);
    if (key && Number.isFinite(stored) && stored > 0) pool[key] += stored;
  }

  return pool;
};

/**
 * What an attack on a tribe may credit (issue #161): each resource the client
 * sent, whole and never negative, capped so everything taken from this tribe
 * since it last respawned stays within its pool times the low-level bonus
 * (`LOOT_GAIN_RATIO`, the same allowance the combat audit gives a gain over
 * a loss). A tribe does not refill between attacks, so a second attack on a
 * damaged tribe can only take what the first left.
 *
 * @param sent - The save's `attackloot`.
 * @param pool - {@link mr1TribePool} of the tribe attacked.
 * @param looted - What this tribe has already given since it respawned.
 * @returns The amounts to credit.
 */
export const creditableMR1Loot = (
  sent: unknown,
  pool: ResourceAmounts,
  looted: Partial<ResourceAmounts> | undefined
): ResourceAmounts => {
  const credit = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const amounts = (sent && typeof sent === "object" ? sent : {}) as Record<string, unknown>;

  for (const key of RESOURCE_KEYS) {
    const asked = Math.floor(Number(amounts[key]));
    if (!Number.isFinite(asked) || asked <= 0) continue;
    const left = Math.floor(pool[key] * LOOT_GAIN_RATIO) - Math.max(0, looted?.[key] ?? 0);
    credit[key] = Math.max(0, Math.min(asked, left));
  }

  return credit;
};
