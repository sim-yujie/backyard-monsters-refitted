import { championStats } from "./championStats.js";
import { monsterStats } from "./monsterStats.js";

/**
 * The attack-stat table and its version (beta 10, owner's pick B+, 27 Nov 2026).
 *
 * An attack start carries every monster's and champion's whole `props` block
 * (`attackData`), and `validateAttack` compares it with this table. The
 * combat half of the table is in the battle rules, so a change to it changes
 * the rules version and an old page is refused by the rules stamp first
 * (`rulesStamp.ts`). The training and hatching ladders (`cTime`, `cResource`,
 * `hTime`, `hResource`) and the champion feeding keys are not: a release that
 * changes only them leaves the rules version alone. The stats version below
 * covers the WHOLE table, so the page sends it as `stats` beside `rules` and
 * an old page is refused with "New version" before its stats are compared.
 *
 * The web computes the same string from its copy, `web/src/game/attack/attackStats.ts`,
 * with `web/src/game/attack/attackStatsVersion.ts`, a copy of the function
 * below; `web/src/game/serverCopies.test.ts` checks the two agree.
 */

/** A prop ladder: one entry per level, numbers or (for a champion) strings. */
export type StatLadder = readonly number[] | readonly string[];

/** One block of props, keyed by stat name. */
export type PropBlock = Readonly<Record<string, StatLadder | undefined>>;

/** The attack-stat table as an attack start declares it. */
export interface AttackStatTable {
  /** Monster id (`C1`, `IC7`, ...) to its props. */
  readonly monsters: Readonly<Record<string, PropBlock>>;
  /** Champion type (`G1`, ...) to its `t` and props. */
  readonly champions: Readonly<Record<string, { readonly t: number; readonly props: PropBlock }>>;
}

/** JSON with every object's keys in name order, so the same table always reads the same. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * cyrb53 (a public-domain 53-bit string hash) with a seed. Not a security
 * hash: it only has to tell one table from another, the same in Bun and in
 * every browser, without the async Web Crypto API.
 */
const cyrb53 = (text: string, seed: number): string => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
};

/** The version of an attack-stat table: 16 hex, from two seeded 53-bit hashes of its canonical JSON. */
export const attackStatsVersionOf = (table: AttackStatTable): string => {
  const text = canonical(table);
  return `${cyrb53(text, 1).slice(-8)}${cyrb53(text, 2).slice(-8)}`;
};

/** The server's attack-stat table: what `validateAttack` checks an attack start against. */
export const CURRENT_ATTACK_STATS: AttackStatTable = {
  monsters: Object.fromEntries(Object.entries(monsterStats).map(([id, stat]) => [id, stat.props as unknown as PropBlock])),
  champions: Object.fromEntries(
    Object.entries(championStats).map(([id, stat]) => [id, { t: stat.t, props: stat.props as unknown as PropBlock }])
  ),
};

/** This server's attack-stats version: what a current page sends as `stats`. */
export const ATTACK_STATS_VERSION: string = attackStatsVersionOf(CURRENT_ATTACK_STATS);
