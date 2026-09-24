/**
 * The checkpoint digest: the proof that two runtimes ran the same battle.
 *
 * `docs/design/server-combat.md` §3.4 rule 5 asks for a hash of every creep's
 * position and health and every building's health at fixed intervals, committed
 * with each golden fixture and asserted under Vitest on Node and under
 * `bun:test` on Bun. A mismatch at checkpoint *n* says the divergence happened
 * between *n-1* and *n*, which is the difference between a bug you can find and
 * a bug you can only stare at.
 *
 * ## Why the raw bits
 *
 * Every number the engine produces comes out of `+`, `-`, `*`, `/` and
 * `Math.sqrt` over IEEE 754 doubles. All five are exactly specified: the same
 * inputs give the same bits on every conforming runtime. The engine uses no
 * transcendental function for exactly this reason (§3.4 rule 3). So the digest
 * hashes the bits rather than a rounded decimal: rounding would hide a
 * divergence in the low bits that would go on to move a creep into or out of a
 * tower's range fifty ticks later.
 *
 * `NaN` is folded to one canonical bit pattern, because a signalling and a
 * quiet `NaN` are the same value to the engine and different bits to the hash.
 * Negative zero is folded to positive zero for the same reason.
 *
 * ## The hash
 *
 * Two independent FNV-1a 32-bit streams over the same byte sequence with
 * different offset bases, printed as 16 hex characters. FNV-1a is four lines
 * long, has no lookup table and no dependency, and 64 bits is far past what a
 * few thousand checkpoints need. It is not a security hash and nothing here
 * pretends otherwise.
 */

/** FNV-1a's 32-bit prime. */
const PRIME = 0x01000193;

/** The standard offset basis, and a second one so the two streams differ. */
const BASIS_A = 0x811c9dc5;
const BASIS_B = 0x7fffffff;

/** Scratch used to read a double's bits; never escapes this module. */
const SCRATCH = new DataView(new ArrayBuffer(8));

/** Accumulates values and hands back a hex digest. */
export interface Digest {
  /** Fold one number in, bits and all. */
  push(value: number): void;
  /** Fold in a whole sequence, in the order it is given. */
  pushAll(values: Iterable<number>): void;
  /** 16 lowercase hex characters. */
  hex(): string;
}

const foldByte = (state: number, byte: number): number => Math.imul(state ^ byte, PRIME);

export const createDigest = (): Digest => {
  let a = BASIS_A;
  let b = BASIS_B;

  const push = (value: number): void => {
    // One `NaN`, one zero: the engine treats each as a single value and the
    // hash must agree, or a digest would depend on how a subtraction signed it.
    const normalised = Number.isNaN(value) ? 0x7ff8000000000000 : value === 0 ? 0 : value;
    SCRATCH.setFloat64(0, normalised, true);
    for (let offset = 0; offset < 8; offset += 1) {
      const byte = SCRATCH.getUint8(offset);
      a = foldByte(a, byte);
      b = foldByte(b, byte ^ 0xff);
    }
  };

  return {
    push,
    pushAll: (values: Iterable<number>) => {
      for (const value of values) push(value);
    },
    hex: () =>
      (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0"),
  };
};

/** The digest of one sequence, for a caller with nothing to accumulate. */
export const digestOf = (values: Iterable<number>): string => {
  const digest = createDigest();
  digest.pushAll(values);
  return digest.hex();
};
