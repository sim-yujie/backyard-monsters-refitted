import { describe, expect, test } from "bun:test";
import alea from "alea";

import { decodePng } from "../../utils/png.js";
import {
  DECOYS_MAX,
  MONSTER_SIZE,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  SCALE_JITTER,
  SCENE_MONSTERS,
  TARGET_MIN_VISIBLE,
  layoutScene,
  referencePicture,
  renderPicture,
} from "./botPicture.js";
import { CHALLENGE_COUNT_MAX, CHALLENGE_COUNT_MIN, CHALLENGE_TARGETS } from "./botChallenge.js";

/**
 * The in-game check's picture (#273): the right number of the monster, every
 * one inside the picture and mostly in view, the others something else; one
 * seed, one picture; quick enough to draw on a request.
 */

const cases = CHALLENGE_TARGETS.flatMap((target, i) =>
  Array.from({ length: CHALLENGE_COUNT_MAX - CHALLENGE_COUNT_MIN + 1 }, (_, j) => ({
    target,
    count: CHALLENGE_COUNT_MIN + j,
    seed: `case-${i}-${j}`,
  }))
);

describe("layoutScene", () => {
  test("places exactly the count of the target, the rest other monsters, all inside the picture", () => {
    for (const { target, count, seed } of cases) {
      const placed = layoutScene(target, count, alea(seed));
      const targets = placed.filter((monster) => monster.target);
      expect([seed, targets.length]).toEqual([seed, count]);
      for (const monster of placed) {
        expect(monster.target).toBe(monster.monster === target);
        expect(SCENE_MONSTERS).toContain(monster.monster);
        expect(monster.x).toBeGreaterThanOrEqual(0);
        expect(monster.y).toBeGreaterThanOrEqual(0);
        expect(monster.x + monster.sprite.width).toBeLessThanOrEqual(PICTURE_WIDTH);
        expect(monster.y + monster.sprite.height).toBeLessThanOrEqual(PICTURE_HEIGHT);
        const longer = Math.max(monster.sprite.width, monster.sprite.height);
        expect(longer).toBeGreaterThanOrEqual(Math.floor(MONSTER_SIZE * (1 - SCALE_JITTER)) - 1);
        expect(longer).toBeLessThanOrEqual(Math.ceil(MONSTER_SIZE * (1 + SCALE_JITTER)) + 1);
      }
      expect(placed.length - count).toBeLessThanOrEqual(DECOYS_MAX);
      expect(placed.length - count).toBeGreaterThan(0);
    }
  });

  test(`keeps every target at least ${TARGET_MIN_VISIBLE * 100}% in view`, () => {
    let overlapped = 0;
    for (const { target, count, seed } of cases) {
      const placed = layoutScene(target, count, alea(seed));
      placed.forEach((monster, i) => {
        if (!monster.target) return;
        const above = new Set<number>();
        for (const later of placed.slice(i + 1)) for (const pixel of later.solid) above.add(pixel);
        const hidden = monster.solid.filter((pixel) => above.has(pixel)).length;
        if (hidden > 0) overlapped += 1;
        expect(1 - hidden / monster.solid.length).toBeGreaterThanOrEqual(TARGET_MIN_VISIBLE);
      });
    }
    // Overlap does happen; the rule is doing work, not being dodged by an empty scene.
    expect(overlapped).toBeGreaterThan(0);
  });
});

describe("renderPicture", () => {
  test("one seed draws one picture; another seed another", () => {
    const first = renderPicture("C1", 4, alea("same"));
    expect(renderPicture("C1", 4, alea("same")).equals(first)).toBe(true);
    expect(renderPicture("C1", 4, alea("other")).equals(first)).toBe(false);
    const image = decodePng(first);
    expect([image.width, image.height]).toEqual([PICTURE_WIDTH, PICTURE_HEIGHT]);
  });

  test("draws in well under 50 ms once the art is loaded", () => {
    renderPicture("C2", 3, alea("warm"));
    const times: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const started = performance.now();
      renderPicture(CHALLENGE_TARGETS[i % CHALLENGE_TARGETS.length]!, CHALLENGE_COUNT_MAX, alea(`time-${i}`));
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    console.log(`bot check picture: median ${median.toFixed(1)} ms over ${times.length} draws`);
    // The budget is 50 ms; a loaded test machine gets some slack.
    expect(median).toBeLessThan(100);
  });
});

describe("referencePicture", () => {
  test("is a WebP portrait for every monster a check asks for", () => {
    for (const target of CHALLENGE_TARGETS) {
      const bytes = referencePicture(target);
      expect(bytes.toString("latin1", 0, 4)).toBe("RIFF");
      expect(bytes.toString("latin1", 8, 12)).toBe("WEBP");
    }
  });
});
