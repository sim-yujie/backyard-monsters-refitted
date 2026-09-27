import type { JsonObject } from "../../types/JsonObject.js";

/**
 * What an attack takes out of the attacker's yards
 * (`docs/design/yard-buildings.md` §4.6 "Attack entry and the attack save").
 *
 * An attack ends one of two ways, and each must spend the flung monsters
 * exactly once: the attacker's own save carrying `over`
 * (`controllers/base/save/handlers/monsterUpdateHandler.ts`), or the server
 * finishing an attack its attacker left (`services/base/finaliseAttack.ts`,
 * issue #138). Both take the final lock, and both call {@link takeFlung} on
 * the yards **as caught up now**, then {@link subtractHoused}: the client's
 * `monsters` blob is never written, so production that ran during the attack
 * stays, and a count the client sends can never add a monster.
 *
 * How many left:
 *
 * - With a fling log (the web client always sends one, `attackSave.ts`) the
 *   log's own count, the same figure the checkpoint replay uses. The log is
 *   the battle; the counts the client derived from its roster are not needed.
 * - Without one, the design's rule per yard: `flung = clamp(entryHoused −
 *   sent, 0, entryHoused)`, where `entryHoused` is what the yard housed when
 *   the attack began (stored in the attack session, `attackSession.ts`).
 *
 * Why the log is preferred when there is one: the roster the web client
 * attacks with comes from the map, read some time before the attack starts,
 * and the server catches production up at attack entry. `entryHoused − sent`
 * would then count as flung every monster hatched between the map read and
 * the attack. `entryHoused` still caps what each yard can give: a monster
 * hatched after the attack began was not in the roster, so it cannot have
 * been flung.
 */

/** Counts per monster id. */
export type Counts = Record<string, number>;

/** What each of the attacker's yards housed at attack entry, keyed by base id. */
export type EntryHoused = Record<string, Counts>;

/** One of the attacker's yards: its base id and what it houses now. */
export interface RosterCell {
  baseid: string;
  housed: Counts;
}

/** Whole positive counts out of a `housed`-like map; anything else is dropped. */
export const countsOf = (raw: unknown): Counts => {
  const counts: Counts = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return counts;
  for (const [id, value] of Object.entries(raw as JsonObject)) {
    const count = Math.floor(Number(value));
    if (Number.isFinite(count) && count > 0) counts[id] = count;
  }
  return counts;
};

/**
 * What the client says left one yard: `clamp(entry − sent, 0, entry)` per
 * type. A sent count above the entry count is an increase and is ignored.
 */
export const claimedFlung = (entry: Counts, sent: Counts): Counts => {
  const flung: Counts = {};
  for (const [id, had] of Object.entries(entry)) {
    const left = Math.min(had, Math.max(0, had - (sent[id] ?? 0)));
    if (left > 0) flung[id] = left;
  }
  return flung;
};

/**
 * Takes `flung` out of the cells, first cell first, each cell giving at most
 * what it houses now and, when `caps` names it, what it housed at entry.
 *
 * @returns What each cell gives (only cells that give something), and what no
 *   cell could pay for.
 */
export const takeFlung = (
  cells: readonly RosterCell[],
  flung: Counts,
  caps?: EntryHoused
): { taken: Record<string, Counts>; unpaid: Counts } => {
  const left: Counts = { ...flung };
  const taken: Record<string, Counts> = {};

  for (const cell of cells) {
    const cap = caps?.[cell.baseid];
    for (const [id, have] of Object.entries(cell.housed)) {
      const owed = left[id] ?? 0;
      const can = Math.min(have, cap ? (cap[id] ?? 0) : have);
      const take = Math.min(owed, can);
      if (take <= 0) continue;
      (taken[cell.baseid] ??= {})[id] = take;
      left[id] = owed - take;
    }
  }

  const unpaid: Counts = {};
  for (const [id, count] of Object.entries(left)) if (count > 0) unpaid[id] = count;
  return { taken, unpaid };
};

/**
 * A copy of `monsters` with `taken` removed from `housed`, never below 0. A
 * type taken to 0 keeps its key, as the client writes it (`monsterUpdateOf`).
 */
export const subtractHoused = (monsters: JsonObject | null | undefined, taken: Counts | undefined): JsonObject => {
  const stored = monsters?.housed;
  const housed: JsonObject = stored && typeof stored === "object" && !Array.isArray(stored) ? { ...stored } : {};
  for (const [id, count] of Object.entries(taken ?? {})) {
    const have = Number(housed[id]);
    if (!Number.isFinite(have)) continue;
    housed[id] = Math.max(0, have - count);
  }
  return { ...(monsters ?? {}), housed };
};

/** What the attack save needs to settle the attacker's yards. */
export interface SaveSettlement {
  /** The attacker's yards as caught up now, in the order the save listed them. */
  cells: readonly RosterCell[];
  /** `housed` of each yard as the client sent it, by base id. */
  sent: Readonly<Record<string, Counts>>;
  /** From the attack session; absent for a session minted before it existed. */
  entryHoused?: EntryHoused;
  /** Monsters flung per the save's fling log, or null when it has none. */
  logged: Counts | null;
}

/**
 * What leaves each yard on the attack save (see the file comment for the rule).
 *
 * @returns Per base id, what to subtract from its caught-up `housed`.
 */
export const flungPerYard = ({ cells, sent, entryHoused, logged }: SaveSettlement): Record<string, Counts> => {
  if (logged) return takeFlung(cells, logged, entryHoused).taken;

  const taken: Record<string, Counts> = {};
  for (const cell of cells) {
    // A yard the save says nothing about gave nothing; one the session did
    // not record is measured against what it holds now.
    const told = sent[cell.baseid];
    if (!told) continue;
    const entry = entryHoused?.[cell.baseid] ?? cell.housed;
    const claim = claimedFlung(entry, told);
    const { taken: one } = takeFlung([cell], claim);
    if (one[cell.baseid]) taken[cell.baseid] = one[cell.baseid]!;
  }
  return taken;
};
