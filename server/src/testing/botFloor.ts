import { afterAll, beforeAll } from "bun:test";

/**
 * For a test suite written for bots on levels 15-24, from before the floor
 * rose to 25 (owner 3 Nov 2026): sets `BOTS_FLOOR_LEVEL` to `level` for the
 * suite, then puts it back. Call it inside the suite's `describe`. The
 * floor's own rules are tested at the default, 25.
 */
export const useBotFloor = (level: number): void => {
  let before: string | undefined;
  beforeAll(() => {
    before = process.env.BOTS_FLOOR_LEVEL;
    process.env.BOTS_FLOOR_LEVEL = String(level);
  });
  afterAll(() => {
    if (before === undefined) delete process.env.BOTS_FLOOR_LEVEL;
    else process.env.BOTS_FLOOR_LEVEL = before;
  });
};
