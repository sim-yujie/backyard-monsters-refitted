import type { InfernoMapResponse, InfernoTribeView } from "@/api/inferno";
import { formatRespawn } from "@/game/maproom1/mr1Model";

/**
 * The Inferno map's Moloch tribes as its screen shows them (WP 2.9,
 * `docs/design/inferno.md` §2.7, §3.2): one row per tribe of
 * `GET /bm/inferno/map`, with Flash's names, its place on the map, whether
 * it can be attacked or lies wrecked until when, and the list's order.
 * Pure: the screen is `ui/inferno/InfernoMapScreen.ts`.
 *
 * Flash: `com/monsters/maproom_inferno/PlayerLayer.as` (which tribes, where),
 * `WildMonsterBase.as` (the marker and its Options card), `views/ListView.as`
 * and `views/WMListViewItem.as` (the list).
 */

/** The owner every Inferno tribe is named for: Moloch (`ai_descenttribe_name`, `TRIBES._infernotribes.d`). */
export const TRIBE_OWNER = "Moloch";

/** A tribe's picture on the map and in the list (`TRIBES._infernotribes.d.profilepic`). */
export const TRIBE_PORTRAIT = "/assets/monsters/tribe_moloch_50.jpg";

/** The map's background (`MapView.as:124`, `ui/inferno_maproom1.jpg`), Flash's own. */
export const INFERNO_MAP_ART = "/assets/ui/inferno_maproom1.jpg";

/** The map's size in Flash's pixels (`MapView._MAPSIZE`). */
export const INFERNO_MAP_SIZE = { width: 1600, height: 1200 } as const;

/** "Moloch's Minions": a tribe's name on the map (`inf_ai_tribe_mapview`). */
export const tribeMapName = (owner: string = TRIBE_OWNER): string => `${owner}'s Minions`;

/** "Moloch's Minions, Level 7": a tribe's name in the list (`inf_ai_tribe_listview`). */
export const tribeListName = (level: number, owner: string = TRIBE_OWNER): string => `${owner}'s Minions, Level ${level}`;

/**
 * The ten places a tribe can stand (`Obstruction.Slots`), x and y of each
 * slot's corner on the 1600 x 1200 map.
 */
const SLOTS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 350, y: 320 },
  { x: 170, y: 610 },
  { x: 670, y: 540 },
  { x: 145, y: 890 },
  { x: 570, y: 1000 },
  { x: 1060, y: 340 },
  { x: 1400, y: 1000 },
  { x: 1100, y: 600 },
  { x: 1500, y: 580 },
  { x: 1220, y: 800 },
];

/** Flash's map grid step (`PlayerLayer.divisor`). */
const DIVISOR = 90;

/**
 * Where a tribe stands on the map, in Flash's pixels: slot `baseid % 10`,
 * snapped to the 90 px grid and 130 px up, then 30 px in
 * (`PlayerLayer.setMapCoords`, `:317-327`, `:343-344`). The seven tribes of a
 * level band have seven base ids in a row, so they never share a slot.
 */
export const tribeSpot = (baseid: string): { readonly x: number; readonly y: number } => {
  const slot = SLOTS[((Math.trunc(Number(baseid)) % 10) + 10) % 10] ?? SLOTS[0]!;
  const mapX = Math.trunc(slot.x / DIVISOR);
  const mapY = Math.trunc((slot.y - 130) / DIVISOR);
  return { x: 30 + DIVISOR * mapX, y: 30 + DIVISOR * mapY };
};

/** What a tribe can be on the map. */
export const TribeState = {
  /** Standing: Attack is offered (`PlayerHandler.configure`, a wild base is always open). */
  ATTACKABLE: "attackable",
  /** Wrecked by the player's win, back at `respawnAt` (1 hour after it fell). */
  DESTROYED: "destroyed",
} as const;
export type TribeState = (typeof TribeState)[keyof typeof TribeState];

/** One tribe as the map and the list draw it. */
export interface TribeRow {
  readonly baseid: string;
  readonly level: number;
  /** "Moloch's Minions". */
  readonly name: string;
  /** "Moloch's Minions, Level 7". */
  readonly listName: string;
  readonly state: TribeState;
  /** When a wrecked tribe is back, unix seconds; null while it stands. */
  readonly respawnAt: number | null;
  /** The last attack's damage this tribe life, 0-100. */
  readonly damage: number;
  /** Where it stands on the map, Flash's pixels. */
  readonly spot: { readonly x: number; readonly y: number };
  /** Its place in the server's answer, the list's tie-break. */
  readonly order: number;
}

const rowOf = (view: InfernoTribeView, order: number, now: number): TribeRow => {
  const level = Math.max(1, Math.trunc(view.level) || 1);
  // A tribe whose comeback has passed stands again, before the next answer says so.
  const wrecked = view.destroyed === 1 && view.respawnat > now;
  return {
    baseid: String(view.baseid),
    level,
    name: tribeMapName(),
    listName: tribeListName(level),
    state: wrecked ? TribeState.DESTROYED : TribeState.ATTACKABLE,
    respawnAt: wrecked ? view.respawnat : null,
    damage: Math.max(0, Math.min(100, Math.trunc(view.damage) || 0)),
    spot: tribeSpot(String(view.baseid)),
    order,
  };
};

/** The map's tribes as rows, at `now` (unix seconds, the server's clock). */
export const tribeRows = (map: Pick<InfernoMapResponse, "tribes">, now: number): TribeRow[] =>
  (map.tribes ?? []).map((view, index) => rowOf(view, index, now));

/** Seconds until a wrecked tribe is back; null while it stands. */
export const respawnLeft = (row: TribeRow, now: number): number | null =>
  row.respawnAt === null ? null : Math.max(0, row.respawnAt - now);

/** "Back in 41:07" under a wrecked tribe. */
export const respawnText = (row: TribeRow, now: number): string => {
  const left = respawnLeft(row, now);
  return left === null ? "" : `Back in ${formatRespawn(left)}`;
};

/** Whether a wrecked tribe's comeback has come: the map asks the server again. */
export const respawnDue = (rows: readonly TribeRow[], now: number): boolean =>
  rows.some((row) => row.respawnAt !== null && row.respawnAt <= now);

/**
 * The list's orders. Flash's list sorts by level, last seen, name, wins or
 * status (`ListView.as:181-238`) and opens on wins (`MAPROOM_INFERNO._lastSort`
 * 3); every tribe has the same name, status and wins and is never seen, so
 * only level parts them and the opening order is the server's.
 */
export const TribeSort = {
  /** Flash's opening order: all tribes tie, so as the server lists them. */
  DEFAULT: "default",
  LEVEL: "level",
} as const;
export type TribeSort = (typeof TribeSort)[keyof typeof TribeSort];

/**
 * The rows in list order: standing tribes first, then the wrecked ones, each
 * part by `sort`. Level goes highest first, and lowest first `reversed`, as
 * a numeric column of Flash's did on its first and second press.
 */
export const sortTribeRows = (rows: readonly TribeRow[], sort: TribeSort, reversed = false): TribeRow[] =>
  [...rows].sort((a, b) => {
    const wrecked = Number(a.state === TribeState.DESTROYED) - Number(b.state === TribeState.DESTROYED);
    if (wrecked !== 0) return wrecked;
    if (sort === TribeSort.LEVEL && a.level !== b.level) return reversed ? a.level - b.level : b.level - a.level;
    return a.order - b.order;
  });

/** The server's clock now: its `currenttime` when the answer came, moved on by the time since. */
export const serverNow = (currenttime: number, receivedAtMs: number, nowMs: number): number =>
  Math.floor(currenttime + Math.max(0, nowMs - receivedAtMs) / 1000);

/* ── Attack ── */

/** Flash's word with nothing housed in the Inferno yard (`infmap_msg_nomonsters`). */
export const TRIBE_NO_MONSTERS = "You have no monsters in your housing, please produce some in your Incubator";

export const TRIBE_MAP_FAILED = "The Inferno map could not be loaded. Try again in a moment.";
export const TRIBE_MAP_OFFLINE = "Could not reach the server to load the Inferno map. Check your connection.";
export const TRIBE_START_FAILED = "The attack could not be started. Try again in a moment.";
export const TRIBE_START_OFFLINE = "Could not reach the server to start the attack. Check your connection.";

/**
 * The army panel's name in a tribe attack: Flash's Inferno word for the
 * flinger bar (`monster_limit`, `UI_TOP.as:239`), since the Housing Bunkers,
 * not a Flinger, set what one fling carries.
 */
export const ATTACK_FORCE = "Attack Force";

/**
 * What a refused tribe start says (`controllers/inferno/tribeAttack.ts`),
 * and whether the map should be asked again (the tribe moved on, or fell).
 */
export const tribeRefusal = (
  reason: string | null,
  respawnAt: number | null,
  now: number,
): { readonly text: string; readonly refresh: boolean } => {
  switch (reason) {
    case "noMonsters":
      return { text: TRIBE_NO_MONSTERS, refresh: false };
    case "tribeDestroyed":
      return {
        text:
          respawnAt !== null && respawnAt > now
            ? `${tribeMapName()} are wrecked. They are back in ${formatRespawn(respawnAt - now)}.`
            : `${tribeMapName()} are wrecked. They will be back soon.`,
        refresh: true,
      };
    case "notYourTribe":
    case "notInfernoTribe":
      return { text: "That tribe has moved on. The map shows the tribes facing you now.", refresh: true };
    case "underAttack":
      return { text: "Your Inferno yard is under attack. Try again when the attack is over.", refresh: false };
    case "noInfernoYard":
    case "infernoOff":
      return { text: "The Inferno map is not open to you.", refresh: false };
    default:
      return { text: TRIBE_START_FAILED, refresh: false };
  }
};
