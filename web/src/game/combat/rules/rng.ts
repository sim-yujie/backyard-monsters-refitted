/**
 * The battle's one source of randomness.
 *
 * The Flash client calls the platform's random number generator from seven
 * places in the combat path, and every one of them changes where a creep ends
 * up: the spawn angle and radius (`client/scripts/ATTACK.as:529-530`,
 * `:546-547`), the pathing scatter and jiggle
 * (`client/scripts/com/monsters/pathing/PATHING.as:454`, `:469`, `:496`), the
 * storage loot pick (`client/scripts/BSTORAGE.as:59`), the burrow side
 * (`client/scripts/com/monsters/monsters/MonsterBase.as:1097-1114`), the flyer
 * ring (`:1139-1154`) and the bunker interceptor pick
 * (`client/scripts/HOUSINGBUNKER.as:444-451`).
 *
 * The engine replaces all of them with draws from this generator, seeded from
 * the attack session's seed, so the Wild Monster Baiter, the web client's
 * renderer and the server's replay produce the same battle from the same fling
 * log (`docs/design/server-combat.md` §3.4 rule 2).
 *
 * ## Why mulberry32
 *
 * It is 32-bit integer arithmetic end to end — `Math.imul`, XOR and unsigned
 * shifts — so every engine that runs the bytes computes bit-identical values.
 * Anything built on floating-point state would be at the mercy of how a runtime
 * rounds, which is the one thing a cross-runtime digest cannot survive. It has
 * a period of 2^32, which is far more draws than a five-minute battle makes.
 *
 * ## The rule the engine follows
 *
 * Draws are ordered, not addressed: the same battle must make the same draws in
 * the same sequence. Anything that consumes a number does so at a fixed point
 * in the tick, over a fixed iteration order (§3.4 rule 4). Nothing decorative —
 * sound, particles, frame offsets (`CreepBase.as:125`, `:945-955`) — draws at
 * all, because the engine does not simulate it.
 */

/** A seeded, resumable stream of pseudo-random numbers. */
export interface Rng {
  /** The next raw 32-bit unsigned integer. */
  next(): number;
  /** The next value in `[0, 1)`, which is what the client's calls returned. */
  float(): number;
  /** The next integer in `[0, bound)`; 0 for a bound of 1 or less. */
  int(bound: number): number;
  /** The internal state, so a checkpoint digest can include it. */
  state(): number;
  /** How many numbers have been drawn, which is a cheap divergence tripwire. */
  count(): number;
}

/** 2^32, the divisor that turns a `uint32` into a float in `[0, 1)`. */
const UINT32 = 4294967296;

/**
 * A mulberry32 generator seeded with `seed`.
 *
 * The seed is taken modulo 2^32; a non-finite or fractional seed is floored and
 * wrapped rather than rejected, because the session seed arrives off the wire
 * and a battle that threw on a bad one would be worse than a battle that ran on
 * a well-defined substitute. A seed of 0 is a legal state, not an error.
 */
export const mulberry32 = (seed: number): Rng => {
  let state = Math.floor(Number.isFinite(seed) ? seed : 0) >>> 0;
  let drawn = 0;

  const next = (): number => {
    drawn += 1;
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    next,
    float: () => next() / UINT32,
    int: (bound: number) => (bound > 1 ? next() % Math.floor(bound) : 0),
    state: () => state,
    count: () => drawn,
  };
};

/**
 * A seed derived from a string, for a fixture or a test that has no session.
 *
 * FNV-1a over the UTF-16 code units. It is not a hash anyone depends on; it
 * exists so a golden fixture can name its seed in words and still be a number.
 */
export const seedFrom = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};
