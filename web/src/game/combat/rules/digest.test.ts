import { describe, expect, it } from "vitest";
import { createDigest, digestOf } from "./digest.js";

/**
 * The checkpoint digest.
 *
 * It has one job: two runs that did the same thing must produce the same
 * string, and two runs that did anything different must not. The interesting
 * cases are the ones where "different" is invisible — a reordered pair, a
 * negative zero, a value that differs in its last bit — because those are
 * exactly the divergences a cross-runtime replay is looking for.
 */

describe("digest", () => {
  it("is 16 hex characters", () => {
    expect(digestOf([1, 2, 3])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same sequence", () => {
    expect(digestOf([1, 2, 3])).toBe(digestOf([1, 2, 3]));
  });

  it("depends on the order, because iteration order is a rule", () => {
    expect(digestOf([1, 2, 3])).not.toBe(digestOf([3, 2, 1]));
  });

  it("notices a change in the last bit of a double", () => {
    const one = 0.1 + 0.2;
    expect(digestOf([one])).not.toBe(digestOf([0.3]));
  });

  it("folds -0 into 0, which is the same value to the engine", () => {
    expect(digestOf([-0])).toBe(digestOf([0]));
  });

  it("gives every NaN one digest", () => {
    expect(digestOf([Number.NaN])).toBe(digestOf([Number.NaN * 2]));
  });

  it("separates the empty sequence from a zero", () => {
    expect(digestOf([])).not.toBe(digestOf([0]));
  });

  it("accumulates the same way it hashes in one go", () => {
    const stepwise = createDigest();
    stepwise.push(7);
    stepwise.pushAll([8, 9]);
    expect(stepwise.hex()).toBe(digestOf([7, 8, 9]));
  });
});
