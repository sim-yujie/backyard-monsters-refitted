import { ATTACK_CHAMPION_PROPS, ATTACK_MONSTER_PROPS, type StatLadder } from "./attackStats";

/**
 * This page's attack-stats stamp (beta 10, owner's pick B+, 27 Nov 2026).
 *
 * An attack start sends it as `stats` beside the battle-rules stamp
 * (`api/rulesStamp.ts`). The rules version leaves out the training,
 * hatching and feeding ladders the attack load still declares
 * (`attackStats.ts`), so a release that changes only those would let an old
 * page through to the server's stat check; with this the server refuses it
 * with "New version" first (`server/src/services/base/combat/rulesStamp.ts`,
 * `requirePageStats`).
 *
 * The functions below are a copy of
 * `server/src/game-data/stats/attackStatsVersion.ts`; `serverCopies.test.ts`
 * checks both give the same string for the same table.
 */

/** One block of props, keyed by stat name. */
type PropBlock = Readonly<Record<string, StatLadder | undefined>>;

/** The attack-stat table as an attack start declares it. */
export interface AttackStatTable {
  readonly monsters: Readonly<Record<string, PropBlock>>;
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

/** This page's attack-stats version, sent as `stats` on an attack start. */
export const ATTACK_STATS_STAMP: string = attackStatsVersionOf({
  monsters: ATTACK_MONSTER_PROPS,
  champions: ATTACK_CHAMPION_PROPS,
});
