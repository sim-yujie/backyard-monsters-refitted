import { describe, expect, it } from "vitest";
import {
  BIG_LABEL_LATE_MERGE_TICKS,
  BIG_LABEL_MERGE_TICKS,
  BIG_LABEL_PER_TARGET,
  BIG_LABEL_TICKS,
  BIG_LUNGE_PX,
  SLOW_MO_EASE_SECONDS,
  SLOW_MO_RATE,
  SLOW_MO_SECONDS,
  bigLabelPlan,
  bigLabelPose,
  bigLabelSide,
  bigLabelSize,
  bigLabelSpread,
  bigLungeOffset,
  nextSwingGap,
  reduceEffects,
  setReduceEffects,
  slowMoSeconds,
  squashScale,
  windUpFrame,
} from "./juice";
import { attackRow, spriteFor } from "./monsterSprites";

const memoryStore = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
};

describe("the juiced wind-up", () => {
  // A Pokey: five attack frames at 4 ticks, strike on the third, a swing every 60.
  it("plays the frames before the strike into the next blow", () => {
    expect(windUpFrame(30, 60, 2, 5, 4)).toBeNull();
    expect(windUpFrame(44, 60, 2, 5, 4)).toBe(0);
    expect(windUpFrame(51, 60, 2, 5, 4)).toBe(0);
    expect(windUpFrame(52, 60, 2, 5, 4)).toBe(1);
    expect(windUpFrame(59, 60, 2, 5, 4)).toBe(1);
  });

  it("holds the last wind-up frame for a late blow, then stands", () => {
    expect(windUpFrame(70, 60, 2, 5, 4)).toBe(1);
    expect(windUpFrame(95, 60, 2, 5, 4)).toBeNull();
  });

  it("skips the wind-up when the swing is too quick to fit one", () => {
    // Vorg-like: a swing every 10 ticks leaves no room after the follow-through.
    expect(windUpFrame(9, 10, 2, 5, 4)).toBeNull();
  });

  it("fits Gorgo's five crouch frames exactly into its 56-tick swing", () => {
    expect(windUpFrame(16, 56, 5, 7, 8)).toBe(0);
    expect(windUpFrame(55, 56, 5, 7, 8)).toBe(4);
  });

  it("learns the real gap between blows, and ignores a pause", () => {
    expect(nextSwingGap(45, 60)).toBe(45);
    expect(nextSwingGap(Number.POSITIVE_INFINITY, 60)).toBe(60);
    expect(nextSwingGap(400, 60)).toBe(60);
  });

  it("drives the attack row only when asked, so the old look is unchanged", () => {
    const pokey = spriteFor("C1");
    if (!pokey) throw new Error("no Pokey sheet");
    const first = pokey.animations.attack?.first ?? 0;
    const idle = pokey.animations.idle?.first ?? 0;
    expect(attackRow(pokey, 50, 0)).toBe(idle);
    expect(attackRow(pokey, 50, 0, { period: 60 })).toBe(first);
    expect(attackRow(pokey, 0, 0, { period: 60 })).toBe(first + 2);
  });
});

describe("the juiced lunge, squash and numbers", () => {
  it("snaps out to its full reach and comes home", () => {
    expect(bigLungeOffset(-1)).toBe(0);
    expect(bigLungeOffset(2)).toBeCloseTo(BIG_LUNGE_PX);
    expect(bigLungeOffset(10)).toBe(0);
  });

  it("stretches on the strike and squats while winding up", () => {
    const strike = squashScale(0, null, 2);
    expect(strike.y).toBeGreaterThan(1);
    expect(strike.x).toBeLessThan(1);
    const squat = squashScale(Number.POSITIVE_INFINITY, 1, 2);
    expect(squat.y).toBeLessThan(1);
    expect(squashScale(Number.POSITIVE_INFINITY, null, 2)).toEqual({ x: 1, y: 1 });
  });

  it("pops a number in big, settles it, and fades it out", () => {
    expect(bigLabelPose(0, 6).scale).toBeGreaterThan(1.5);
    expect(bigLabelPose(20, 6).scale).toBeCloseTo(1);
    expect(bigLabelPose(BIG_LABEL_TICKS, 6).alpha).toBe(0);
    expect(bigLabelPose(BIG_LABEL_TICKS, 6).dx).toBe(6);
  });
});

describe("many hits on one target", () => {
  it("adds a hit into a fresh number, starts one while there is room, else drops it", () => {
    expect(bigLabelPlan(null, 0)).toBe("new");
    expect(bigLabelPlan(BIG_LABEL_MERGE_TICKS - 1, 1)).toBe("merge");
    expect(bigLabelPlan(BIG_LABEL_MERGE_TICKS, 1)).toBe("new");
    // All places taken: the newest still counts up a while longer.
    expect(bigLabelPlan(BIG_LABEL_MERGE_TICKS, BIG_LABEL_PER_TARGET)).toBe("merge");
    expect(bigLabelPlan(BIG_LABEL_LATE_MERGE_TICKS, BIG_LABEL_PER_TARGET)).toBe("drop");
    // A heal on a creep showing only damage has nothing of its kind to join.
    expect(bigLabelPlan(null, BIG_LABEL_PER_TARGET)).toBe("drop");
  });

  it("puts each number in the first free place: middle, right, left", () => {
    expect(bigLabelSide([])).toBe(0);
    expect(bigLabelSide([0])).toBe(1);
    expect(bigLabelSide([0, 1])).toBe(-1);
    expect(bigLabelSide([1, -1])).toBe(0);
  });

  it("spreads the places by a whole number's width, wider for longer and bigger", () => {
    expect(bigLabelSpread(0, 3, 20)).toBe(0);
    expect(bigLabelSpread(1, 2, 20)).toBe(-bigLabelSpread(-1, 2, 20));
    expect(bigLabelSpread(1, 3, 20)).toBeGreaterThan(bigLabelSpread(1, 2, 20));
    expect(bigLabelSpread(1, 2, 26)).toBeGreaterThan(bigLabelSpread(1, 2, 20));
    // Clears the neighbour's half and this one's half, at rest.
    expect(bigLabelSpread(1, 2, 20)).toBeGreaterThanOrEqual(2 * 20 * 0.6);
  });

  it("grows the type with the sum, up to a cap", () => {
    expect(bigLabelSize(1)).toBe(bigLabelSize(0));
    expect(bigLabelSize(500)).toBeGreaterThan(bigLabelSize(20));
    expect(bigLabelSize(1e9)).toBe(bigLabelSize(1e6));
  });

  it("swells a number again for a moment when a hit is added into it", () => {
    const settled = bigLabelPose(30, 0).scale;
    expect(bigLabelPose(30, 0, 0).scale).toBeGreaterThan(settled * 1.2);
    expect(bigLabelPose(30, 0, 8).scale).toBeCloseTo(settled);
  });
});

describe("slow motion at the end", () => {
  it("runs a quarter speed, then eases back to full", () => {
    expect(slowMoSeconds(0)).toBe(0);
    expect(slowMoSeconds(1)).toBeCloseTo(SLOW_MO_RATE);
    const eased = SLOW_MO_SECONDS * SLOW_MO_RATE + (SLOW_MO_EASE_SECONDS * (1 + SLOW_MO_RATE)) / 2;
    expect(slowMoSeconds(SLOW_MO_SECONDS + SLOW_MO_EASE_SECONDS)).toBeCloseTo(eased);
    expect(slowMoSeconds(SLOW_MO_SECONDS + SLOW_MO_EASE_SECONDS + 1)).toBeCloseTo(eased + 1);
  });
});

describe("the Reduce effects setting", () => {
  it("is off until turned on, and remembers the choice", () => {
    const store = memoryStore();
    expect(reduceEffects(store)).toBe(false);
    setReduceEffects(true, store);
    expect(reduceEffects(store)).toBe(true);
    setReduceEffects(false, store);
    expect(reduceEffects(store)).toBe(false);
  });

  it("falls back to off where storage cannot be read", () => {
    expect(reduceEffects(null)).toBe(false);
  });
});
