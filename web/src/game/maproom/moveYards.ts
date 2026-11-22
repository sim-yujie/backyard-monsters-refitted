import { isPlayerCell, type MapCell } from "@/api/types";
import { formatCountdown } from "@/ui/format";

/**
 * Moving between the player's own yards on Map Room 2 (outposts WP7, #186):
 * "Move main yard here" on an own outpost, and reading an own cell's monsters
 * (the yard card, the relocate warning). Moving monsters between yards is the
 * map's move mode since beta 9 (`transferPlan.ts`, `ui/maproom/TransferMode.ts`).
 * Pure: the texts, the prices and the monster sums. The server checks all of
 * it again (`migrateBase.ts`, `transferBatch.ts` and `transferRules.ts`).
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

