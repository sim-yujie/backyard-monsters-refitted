import { describe, expect, it } from "vitest";
import { hasSnowContact } from "./snowContact";

/** Christmas: a dark patch on the snow under every building but a wall block (neon, 28 Nov 2026). */
describe("hasSnowContact", () => {
  it("is on for buildings and traps, off for wall blocks", () => {
    expect(hasSnowContact({ type: 1 })).toBe(true);
    expect(hasSnowContact({ type: 24 })).toBe(true);
    expect(hasSnowContact({ type: 17 })).toBe(false);
    expect(hasSnowContact({ type: 18 })).toBe(false);
  });
});
