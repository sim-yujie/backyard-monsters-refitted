import { describe, expect, it } from "vitest";
import type { HelpMark } from "@/game/friends/helpModel";
import { jobBarScale } from "./YardJobBars";
import { helpMarkScale, SMALL_RADIUS, WRENCH_RADIUS, YardHelpMarks } from "./YardHelpMarks";
import type { Corners } from "./planner/marquee";

/**
 * The marks over a friend's yard (#374, beta 8): a ring, a big wrench and a
 * tag per building to speed up, today's small wrench for a repair only; a
 * tap on a wrench picks its building.
 */

const anchor = (id: number) => (id === 99 ? null : { x: id * 100, y: 50 });
const corners = (id: number): Corners | null =>
  id === 99
    ? null
    : [
        [id * 100 - 40, 80],
        [id * 100, 60],
        [id * 100 + 40, 80],
        [id * 100, 100],
      ];

const speedup = (id: number, saving: number | null = 1080): HelpMark => ({ id, kind: "speedup", saving });
const repair = (id: number): HelpMark => ({ id, kind: "repair", saving: null });

describe("YardHelpMarks", () => {
  it("draws one wrench per building, none for a building with no anchor", () => {
    const marks = new YardHelpMarks(anchor, corners);
    marks.set([speedup(1), speedup(2), speedup(99)]);
    expect(marks.drawn).toEqual([1, 2, 99]);
    expect(marks.root.children.filter((badge) => badge.visible)).toHaveLength(2);
    marks.set([]);
    expect(marks.active).toBe(false);
  });

  it("a speed-up gets a ground ring and a tag with its saving; a repair only, neither", () => {
    const marks = new YardHelpMarks(anchor, corners);
    marks.set([speedup(1, 1080), speedup(2, null), repair(3)]);
    expect(marks.ground.children).toHaveLength(2);
    expect(marks.tags).toEqual(
      new Map<number, string | null>([
        [1, "-18m"],
        [2, null],
        [3, null],
      ]),
    );
    // The ring sits at the footprint's middle, under the building.
    expect(marks.ground.children[0]!.position.x).toBe(100);
    expect(marks.ground.children[0]!.position.y).toBe(80);
  });

  it("a new saving rewrites the tag without drawing the marks again", () => {
    const marks = new YardHelpMarks(anchor, corners);
    marks.set([speedup(1, 1080)]);
    const ring = marks.ground.children[0];
    expect(marks.set([speedup(1, 1080 + 20)])).toBe(false);
    expect(marks.set([speedup(1, 600)])).toBe(true);
    expect(marks.tags.get(1)).toBe("-10m");
    expect(marks.ground.children[0]).toBe(ring);
  });

  it("pulses the ring and bobs the wrench, but not under reduced motion", () => {
    const moving = new YardHelpMarks(anchor, corners);
    moving.set([speedup(1)]);
    moving.update(0.7);
    const ring = moving.ground.children[0]!;
    expect(ring.alpha).toBeGreaterThan(0.6);
    const bob = (moving.root.children[0] as { children: { y: number }[] }).children[0]!;
    expect(bob.y).toBeLessThan(0);

    const still = new YardHelpMarks(anchor, corners, { reducedMotion: true });
    still.set([speedup(1)]);
    still.update(0.7);
    expect((still.root.children[0] as { children: { y: number }[] }).children[0]!.y).toBe(0);
  });

  it("picks the building whose wrench is tapped, at any zoom, wherever the bob is", () => {
    const marks = new YardHelpMarks(anchor, corners);
    marks.set([speedup(1), repair(2), speedup(99)]);
    marks.update(0.7);
    // The big disc's centre sits 32 world px over the anchor at zoom 1.
    expect(marks.pick(100, 50 - 32)).toBe(1);
    expect(marks.pick(100 + WRENCH_RADIUS - 1, 50 - 32)).toBe(1);
    expect(marks.pick(100, 50 + 5)).toBeNull();
    // The small one's, 20.
    expect(marks.pick(200, 30)).toBe(2);
    expect(marks.pick(200 + SMALL_RADIUS + 1, 30)).toBeNull();
    expect(marks.pick(9900, 30)).toBeNull();

    // Far out (a phone on its side): the big wrench keeps its full size on
    // screen, past the job bars' cap; the small repair wrench keeps theirs.
    marks.setZoom(0.25);
    const scale = helpMarkScale(0.25);
    expect(scale).toBe(4);
    expect(scale).toBeGreaterThan(jobBarScale(0.25));
    expect(marks.pick(100, 50 - 32 * scale)).toBe(1);
    expect(marks.pick(100 + (WRENCH_RADIUS - 1) * scale, 50 - 32 * scale)).toBe(1);
    expect(marks.pick(100 + (WRENCH_RADIUS + 1) * scale, 50 - 32 * scale)).toBeNull();
    const small = jobBarScale(0.25);
    expect(marks.pick(200, 50 - 20 * small)).toBe(2);
    expect(marks.pick(200 + (SMALL_RADIUS + 1) * small, 50 - 20 * small)).toBeNull();
    expect(marks.discs.find((disc) => disc.id === 1)?.radius).toBe(WRENCH_RADIUS * scale);
  });

  it("slides a big wrench down under the top column, and hides it once its building has gone under", () => {
    const marks = new YardHelpMarks(anchor, corners, { reducedMotion: true });
    marks.set([speedup(1), repair(2)]);
    // The disc reaches 22 + 32 + 5 = 59 px over the anchor (y 50): its top is at -9.
    marks.setViewTop(-20);
    marks.reposition();
    expect(marks.discs[0]).toMatchObject({ y: 50 - 32, visible: true });
    // The column's foot at y 30: the wrench stands just under it.
    marks.setViewTop(30);
    marks.reposition();
    expect(marks.discs[0]).toMatchObject({ y: 30 + 59 - 32, visible: true });
    expect(marks.discs[0]!.y - WRENCH_RADIUS - 5).toBeGreaterThanOrEqual(30);
    // Past the ring's lowest corner (y 100): gone with its building.
    marks.setViewTop(101);
    marks.reposition();
    expect(marks.discs[0]!.visible).toBe(false);
    expect(marks.pick(100, 101 + 59 - 32)).toBeNull();
    // The repair wrench is left where it is.
    expect(marks.pick(200, 30)).toBe(2);
    marks.setViewTop(null);
    marks.reposition();
    expect(marks.discs[0]).toMatchObject({ y: 50 - 32, visible: true });
  });

  it("draws each ring's front edge over the buildings, none for a repair", () => {
    const marks = new YardHelpMarks(anchor, corners);
    marks.set([speedup(1), repair(2)]);
    expect(marks.ground.children).toHaveLength(1);
    expect(marks.front.children).toHaveLength(1);
    marks.set([]);
    expect(marks.front.children).toHaveLength(0);
  });

  it("names the world box its big wrenches take: highest anchor to lowest ring; a repair is left out", () => {
    const marks = new YardHelpMarks(anchor, corners);
    expect(marks.worldBox()).toBeNull();
    marks.set([repair(2)]);
    expect(marks.worldBox()).toBeNull();
    marks.set([speedup(1), speedup(2), repair(3)]);
    expect(marks.worldBox()).toEqual({ left: 60, top: 50, right: 240, bottom: 100, footTop: 100, xs: [100, 200] });
  });
});
