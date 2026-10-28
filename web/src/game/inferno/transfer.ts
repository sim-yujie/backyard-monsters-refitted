import { isInfernoMonster, monsterEntry } from "@/game/monsters/monsterCatalogue";

/**
 * The Inferno monster transfer from the cave (`docs/design/inferno.md` §2.7,
 * WP 2.6; Flash's `INFERNO_ASCENSION_POPUP.as`): which Compound monsters the
 * dialog lists, and how many of each may still be picked before the main
 * yard's Housing is full. The server checks the same rules again
 * (`server/src/services/inferno/transfer.ts`).
 */

/** Flash's words (`english.json`, the key beside each). */
export const ASCEND_TEXT = {
  /** `ascdlg_title`. */
  title: "INFERNO MONSTER TRANSFER",
  /** `ascdlg_transfer_action`. */
  action: "Transfer Monsters To Your Backyard",
  /** `ascdlg_transfer_desc`, "re-enforcements" mended. */
  lead: "Need some reinforcements from your Inferno base? Choose monsters from your compound and send them up through the cavern.",
  /** `ascdlg_capacity_desc`. */
  capacity: "Housing Capacity",
  /** `ascdlg_transfer_btn`. */
  go: "Transfer Monsters",
  /** `ascent_tool_tip`. */
  free: "Bring some of your Inferno monsters up to your main yard. There is no cost for this.",
  /** Ours: an empty Compound, the load failing, the request on its way, done. */
  none: "There are no monsters in your Compound to bring up.",
  loading: "Loading…",
  problem: "There was a problem with the transfer: ",
  busy: "Sending them up…",
} as const;

/** "4 Inferno monsters came up to your yard." */
export const ascendedText = (count: number): string =>
  `${count} Inferno ${count === 1 ? "monster" : "monsters"} came up to your yard.`;

/** One Compound monster the dialog lists. */
export interface CompoundRow {
  readonly id: string;
  /** How many the Compound holds. */
  readonly count: number;
}

/**
 * The Compound's Inferno monsters, lowest number first, as Flash sorted them
 * (`monsterOrder.sort`, by the number after `IC`). Anything that is not an
 * Inferno monster, or not a whole count above 0, is left out.
 */
export const compoundRows = (housed: Readonly<Record<string, unknown>> | null | undefined): CompoundRow[] =>
  Object.entries(housed ?? {})
    .map(([id, raw]) => ({ id, count: Math.floor(Number(raw)) }))
    .filter(({ id, count }) => isInfernoMonster(id) && monsterEntry(id) !== undefined && count > 0)
    .sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));

/** Housing space the picked monsters take. */
export const pickedSpace = (picked: Readonly<Record<string, number>>, sizeOf: (id: string) => number): number =>
  Object.entries(picked).reduce((sum, [id, count]) => sum + count * sizeOf(id), 0);

/** The main yard's Housing as the dialog measures it. */
export interface HousingRoom {
  /** Space its housed monsters take now. */
  readonly used: number;
  readonly capacity: number;
}

/**
 * The most of `id` the player may pick, the other picks kept: what the
 * Compound holds, and no more than still fits in the Housing (Flash's `+`
 * was enabled while `used + queued + size <= capacity`, `Update`).
 */
export const maxPick = (
  id: string,
  picked: Readonly<Record<string, number>>,
  rows: readonly CompoundRow[],
  room: HousingRoom,
  sizeOf: (id: string) => number,
): number => {
  const have = rows.find((row) => row.id === id)?.count ?? 0;
  const size = sizeOf(id);
  const others = pickedSpace(picked, sizeOf) - (picked[id] ?? 0) * size;
  const free = room.capacity - room.used - others;
  const fits = size > 0 ? Math.floor(free / size) : have;
  return Math.max(0, Math.min(have, fits));
};

/**
 * The bar under "Housing Capacity" (`mcStorage`): the housed share, the
 * picked share after it, and Flash's label, "used / capacity (pct%)" with the
 * picks counted.
 */
export const housingBar = (
  room: HousingRoom,
  picked: number,
): { readonly stored: number; readonly queued: number; readonly label: string } => {
  const after = room.used + picked;
  const ratio = (value: number) => (room.capacity > 0 ? Math.min(Math.max(value / room.capacity, 0), 1) : 0);
  const stored = ratio(room.used);
  const percent = room.capacity > 0 ? Math.floor((after / room.capacity) * 100) : 0;
  return {
    stored,
    queued: Math.max(ratio(after) - stored, 0),
    label: `${after.toLocaleString("en-US")} / ${room.capacity.toLocaleString("en-US")} (${percent}%)`,
  };
};
