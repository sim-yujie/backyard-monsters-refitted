// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { MapCell, PlayerCell } from "@/api/types";
import type { ReachAnswer, RangeSource } from "@/game/maproom/attackRange";
import { HoverCard, hoverContentFor } from "./HoverCard";

/**
 * The hover card (#176): the map carries no names, so this is where a camp's
 * tribe and level and a yard's owner are read, with how the cell stands
 * against the player's range (#177).
 */

const yard: RangeSource = { col: 241, row: 207, kind: "main", flinger: 4, reach: 10 };
const inRange = (steps: number): ReachAnswer => ({ inRange: true, steps, source: yard });
const outOfRange = (steps: number): ReachAnswer => ({ inRange: false, steps, source: yard });
const noFlinger: ReachAnswer = { inRange: false, steps: Infinity, source: null };

const camp = { uid: 0, b: 1, i: 150, bid: "1", n: "Legionnaire", l: 34, dm: 0, d: 0 } as MapCell;

const player = (overrides: Partial<PlayerCell> = {}): MapCell =>
  ({
    uid: 7,
    b: 2,
    i: 150,
    bid: "2",
    aid: null,
    n: "Bramblefoot",
    l: 24,
    v: 0,
    f: 1,
    c: 1,
    dm: 0,
    d: 0,
    lo: 0,
    p: 0,
    mine: 0,
    pic_square: null,
    pi: 0,
    fr: 0,
    ...overrides,
  }) as PlayerCell;

describe("hoverContentFor", () => {
  it("names a camp by tribe and level, with its distance", () => {
    expect(hoverContentFor(camp, inRange(3))).toMatchObject({
      title: "Legionnaire camp · Level 34",
      detail: "In range · 3 cells away · click for more",
      warn: false,
      ring: "#b85c38",
    });
    expect(hoverContentFor(camp, inRange(3))?.picture).toContain("tribes/legionnaire-256.png");
  });

  it("warns how far out of range a cell is", () => {
    expect(hoverContentFor(camp, outOfRange(2))).toMatchObject({
      detail: "Out of range · 2 cells too far",
      warn: true,
    });
    expect(hoverContentFor(camp, outOfRange(1))?.detail).toBe("Out of range · 1 cell too far");
  });

  it("names a player's yard by owner, and the player's own as theirs", () => {
    expect(hoverContentFor(player(), inRange(4))?.title).toBe("Bramblefoot · Level 24");
    expect(hoverContentFor(player(), inRange(4))?.picture).toContain("avatars/");
    const own = hoverContentFor(player({ mine: 1, l: 12 }), inRange(0));
    expect(own).toMatchObject({ title: "Your yard · Level 12", detail: "Click for more" });
    expect(hoverContentFor(player({ mine: 1, b: 3 }), inRange(0))?.title).toBe(
      "Your outpost · Level 24",
    );
  });

  it("leaves the range out when nothing of the player's has a Flinger", () => {
    expect(hoverContentFor(camp, noFlinger)?.detail).toBe("Click for more");
  });

  it("shows nothing for water or a zone still loading", () => {
    expect(hoverContentFor({ i: 50 } as MapCell, inRange(1))).toBeNull();
    expect(hoverContentFor(undefined, inRange(1))).toBeNull();
  });
});

describe("HoverCard", () => {
  it("sits right of the cell, or left of it at the screen's edge", () => {
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { value: 1000 });
    const card = new HoverCard().mount(host);
    Object.defineProperty(card.element, "offsetWidth", { value: 200 });
    Object.defineProperty(card.element, "offsetHeight", { value: 60 });
    const content = hoverContentFor(camp, inRange(3))!;

    card.show(content, { left: 100, right: 190, middle: 300 });
    expect(card.element.hidden).toBe(false);
    expect(card.element.style.transform).toBe("translate(200px, 270px)");

    card.show(content, { left: 800, right: 890, middle: 300 });
    expect(card.element.style.transform).toBe("translate(590px, 270px)");

    card.hide();
    expect(card.element.hidden).toBe(true);
  });
});
