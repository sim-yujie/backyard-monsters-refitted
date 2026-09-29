import { isPlayerCell, type MapCell } from "@/api/types";
import { formatCountdown } from "@/ui/format";

/**
 * Moving between the player's own yards on Map Room 2 (outposts WP7, #186):
 * "Move main yard here" on an own outpost, and "Move monsters" between any
 * two of the player's yards. Pure: the texts, the prices, and the monster
 * sums the two dialogs show and send. The server checks all of it again
 * (`migrateBase.ts`, `transferMonsters.ts` and `transferRules.ts`).
 */

/* ── Move main yard here (`PopupRelocateMe.as`) ───────────────────────── */

/**
 * The price, charged by the server whatever the client sends
 * (`server/src/services/maproom/v2/relocateRules.ts`, `PopupRelocateMe.as:65-66`):
 * 30,000,000 of each resource or 1,500 Shiny, then a day before the next move.
 */
export const RELOCATE_PRICE = {
  resources: 30_000_000,
  shiny: 1_500,
  cooldownSeconds: 24 * 60 * 60,
} as const;

/** Flash's words (`english.json`), kept as the owner decided (2026-09-28). */
export const RELOCATE_TEXT = {
  button: "Move main yard here",
  title: "Move Main Yard Here",
  lead: "Relocate your main yard to this location.",
  warning:
    "Relocating your yard to this outpost will destroy the outpost and all buildings on it. " +
    "Wild Monsters will claim your old main yard location.",
  lost: "The monsters living here are lost with the outpost:",
  noneLost: "No monsters live here, so none are lost.",
  instant: "Keep your resources and relocate instantly!",
  useResources: "Use Resources",
  notEnoughResources: "You don't have enough resources to relocate.",
  notEnoughShiny: "You do not have enough Shiny.",
  busy: "Relocating Main Yard...",
  problem: "There was a problem relocating your yard: ",
} as const;

/** "Use 1,500 Shiny" (`btn_useshiny`). */
export const useShinyText = (shiny: number): string => `Use ${shiny.toLocaleString("en-GB")} Shiny`;

/** Flash's `movebase_warning`: "You have already moved your main yard. Try again in 5h 3m". */
export const cooldownText = (cantMoveTill: number, now: number): string =>
  `You have already moved your main yard. Try again in ${formatCountdown(Math.max(1, cantMoveTill - now))}`;

/** One monster type and how many. */
export interface MonsterCount {
  readonly id: string;
  readonly count: number;
}

/** A yard's housed monsters from its map cell (`m.housed`), for the player's own cells only. */
export const housedOf = (payload: MapCell | undefined): Record<string, number> => {
  if (!payload || !isPlayerCell(payload)) return {};
  const housed = payload.m?.["housed"];
  const counts: Record<string, number> = {};
  if (typeof housed !== "object" || housed === null) return counts;
  for (const [id, raw] of Object.entries(housed as Record<string, unknown>)) {
    const count = Math.floor(Number(raw));
    if (Number.isFinite(count) && count > 0) counts[id] = count;
  }
  return counts;
};

/** A yard's housing capacity from its map cell (`m.space`, which the server's catch-up keeps). */
export const spaceOf = (payload: MapCell | undefined): number => {
  if (!payload || !isPlayerCell(payload)) return 0;
  const space = Number(payload.m?.["space"]);
  return Number.isFinite(space) && space > 0 ? space : 0;
};

/** The housed monsters as a list, in roster order (`C1`, `C2`, ... `C19`, then the rest). */
export const countsList = (housed: Readonly<Record<string, number>>): MonsterCount[] =>
  Object.entries(housed)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => rosterOrder(a.id) - rosterOrder(b.id) || a.id.localeCompare(b.id));

const rosterOrder = (id: string): number => {
  const match = /^C(\d+)$/.exec(id);
  return match ? Number(match[1]) : 1_000;
};

/** Whether the player's purse covers the move either way. */
export const relocateAffordable = (
  resources: Readonly<Record<string, number | undefined>> | null | undefined,
  credits: number | undefined,
): { resources: boolean; shiny: boolean } => ({
  resources: ["r1", "r2", "r3", "r4"].every(
    (key) => Number(resources?.[key] ?? 0) >= RELOCATE_PRICE.resources,
  ),
  shiny: Number(credits ?? 0) >= RELOCATE_PRICE.shiny,
});

/* ── Move monsters (`PopupMonstersA.as`, `PopupMonstersB.as`, `MapRoom.as:694-936`) ── */

export const TRANSFER_TEXT = {
  button: "Move monsters",
  title: "Move Monsters",
  lead: "Pick the monsters, then where they go.",
  from: "From",
  to: "To",
  go: "Transfer",
  busy: "Moving monsters...",
  done: "All monsters successfully transferred.",
  none: "No monsters to transfer.",
  noHousing: "You don't have any Monster Housing at this Outpost.",
  problem: "There was a problem with the transfer: ",
  noOutposts: "You need an outpost to move monsters to.",
} as const;

/** Flash's `newmap_tr_space`: some went, and the rest had no room. */
export const partlyMovedText = (moved: number): string =>
  `${moved} monsters successfully transferred.  There was not enough space for all the monsters.`;

/** One end of a transfer: a yard, what it houses and how much room it has. */
export interface TransferYard {
  readonly baseid: string;
  readonly housed: Readonly<Record<string, number>>;
  /** Its housing capacity (`m.space`, which the server keeps). */
  readonly space: number;
}

/** The room a yard has left: its space less every housed monster's size (`MapRoom.as:811-814`). */
export const freeSpace = (yard: TransferYard, sizeOf: (id: string) => number): number =>
  Object.entries(yard.housed).reduce(
    (left, [id, count]) => left - count * sizeOf(id),
    yard.space,
  );

/**
 * The picked counts cut down to what the source has and the target can
 * house, in roster order, as Flash cut them as it sent them
 * (`MapRoom.as:819-849`): each type moves while room is left, the last only as
 * many as fit.
 */
export const clampTransfer = (
  picked: Readonly<Record<string, number>>,
  from: TransferYard,
  to: TransferYard,
  sizeOf: (id: string) => number,
): Record<string, number> => {
  let room = Math.max(0, freeSpace(to, sizeOf));
  const moved: Record<string, number> = {};
  for (const { id } of countsList(from.housed)) {
    const want = Math.min(Math.max(0, Math.floor(picked[id] ?? 0)), from.housed[id] ?? 0);
    if (want <= 0) continue;
    const size = sizeOf(id);
    const fits = size > 0 ? Math.min(want, Math.floor(room / size)) : want;
    if (fits <= 0) continue;
    moved[id] = fits;
    room -= fits * size;
  }
  return moved;
};

/**
 * The most of one type that can move now, with the other picks as they are:
 * what the source has, and what the room left after the others holds.
 */
export const maxOf = (
  id: string,
  picked: Readonly<Record<string, number>>,
  from: TransferYard,
  to: TransferYard,
  sizeOf: (id: string) => number,
): number => {
  const others = Object.entries(picked).reduce(
    (used, [other, count]) => (other === id ? used : used + count * sizeOf(other)),
    0,
  );
  const room = Math.max(0, freeSpace(to, sizeOf) - others);
  const size = sizeOf(id);
  const fits = size > 0 ? Math.floor(room / size) : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(from.housed[id] ?? 0, fits));
};

/**
 * The two rosters the server takes (`transferassets`, `monsters`): each yard's
 * whole `housed` after the move, source first (`MapRoom.as:856-888`).
 */
export const transferBlobs = (
  from: TransferYard,
  to: TransferYard,
  moved: Readonly<Record<string, number>>,
): [{ housed: Record<string, number> }, { housed: Record<string, number> }] => {
  const source: Record<string, number> = { ...from.housed };
  const target: Record<string, number> = { ...to.housed };
  for (const [id, count] of Object.entries(moved)) {
    if (count <= 0) continue;
    source[id] = (source[id] ?? 0) - count;
    if (source[id] <= 0) delete source[id];
    target[id] = (target[id] ?? 0) + count;
  }
  return [{ housed: source }, { housed: target }];
};

/** How many monsters a pick moves in all. */
export const totalOf = (counts: Readonly<Record<string, number>>): number =>
  Object.values(counts).reduce((sum, count) => sum + Math.max(0, count), 0);
