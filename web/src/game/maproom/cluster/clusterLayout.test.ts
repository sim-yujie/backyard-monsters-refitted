import { describe, expect, it } from "vitest";
import { ClusterLayout, TOUCH_TARGET, tokenSize, type LayoutView, type Project } from "./clusterLayout";
import type { ClusterGroup, WorldToken } from "./clusterRules";

/** Map pin clustering: placing the tokens on the screen (`clusterLayout.ts`). */

let nextKey = 0;
const token = (kind: WorldToken["kind"], group: ClusterGroup, x: number, y: number, count = 1): WorldToken => ({
  kind,
  group,
  cells: Array.from({ length: count }, () => nextKey++),
  wx: x,
  wy: y,
  minX: x,
  minY: y,
  maxX: x,
  maxY: y,
  aid: 0,
});

/** Map pixels are canvas pixels. */
const flat: Project = (wx, wy, out) => {
  out.x = wx;
  out.y = wy;
  return true;
};

const view = (over: Partial<LayoutView> = {}): LayoutView => ({ width: 800, height: 600, touch: false, zoom: 0.26, obstacles: [], ...over });

describe("ClusterLayout", () => {
  it("places every token at its projected point", () => {
    const layout = new ClusterLayout();
    const shown = layout.layOut([token("crest", "you", 100, 100), token("plaque", "alliance", 400, 300, 5)], flat, view());
    expect(shown.map((s) => [s.x, s.y, s.count])).toEqual(
      expect.arrayContaining([
        [100, 100, 1],
        [400, 300, 5],
      ]),
    );
  });

  it("drops tokens cut by the screen edge or under the HUD", () => {
    const layout = new ClusterLayout();
    const hud = { left: 0, top: 0, right: 800, bottom: 60 };
    const shown = layout.layOut(
      [token("crest", "you", 5, 300), token("crest", "you", 400, 62), token("crest", "you", 400, 300)],
      flat,
      view({ obstacles: [hud] }),
    );
    expect(shown.map((s) => s.y)).toEqual([300]);
  });

  it("merges plaques of one kind that overlap on the screen, keeping the sum and the box", () => {
    const layout = new ClusterLayout();
    const a = token("plaque", "alliance", 300, 300, 4);
    const b = token("plaque", "alliance", 310, 304, 6);
    b.maxX = 900;
    const shown = layout.layOut([a, b, token("plaque", "other", 305, 302, 3)], flat, view());
    const alliance = shown.filter((s) => s.group === "alliance");
    expect(alliance).toHaveLength(1);
    expect(alliance[0]!.count).toBe(10);
    expect(alliance[0]!.maxX).toBe(900);
    // Neutral plaques never merge with alliance ones.
    expect(shown.filter((s) => s.group === "other")).toHaveLength(1);
  });

  it("never merges crests, and moves a crest no more than 10 px off its outpost", () => {
    const layout = new ClusterLayout();
    const shown = layout.layOut([token("crest", "hostile", 300, 300), token("crest", "you", 302, 301)], flat, view());
    expect(shown).toHaveLength(2);
    const own = shown.find((s) => s.group === "you")!;
    const hostile = shown.find((s) => s.group === "hostile")!;
    // The more important hostile crest stays put; the own one steps aside, at most 10 px.
    expect([hostile.x, hostile.y]).toEqual([300, 300]);
    expect(Math.hypot(own.x - 302, own.y - 301)).toBeLessThanOrEqual(10.0001);
  });

  it("pushes a plaque out from under a crest", () => {
    const layout = new ClusterLayout();
    const shown = layout.layOut([token("plaque", "alliance", 300, 310, 9), token("crest", "home", 300, 300)], flat, view());
    const home = shown.find((s) => s.group === "home")!;
    const plaque = shown.find((s) => s.group === "alliance")!;
    expect([home.x, home.y]).toEqual([300, 300]);
    const apartX = Math.abs(plaque.x - home.x) >= plaque.hw + home.hw;
    const apartY = Math.abs(plaque.y - home.y) >= plaque.hh + home.hh;
    expect(apartX || apartY).toBe(true);
  });

  it("hits the most important token, with a 44 px target on touch screens", () => {
    const layout = new ClusterLayout();
    layout.layOut([token("crest", "you", 200, 200), token("plaque", "alliance", 500, 300, 3)], flat, view({ touch: true }));
    expect(layout.hit(200, 200 + TOUCH_TARGET / 2 - 1, true)?.group).toBe("you");
    expect(layout.hit(500, 300, true)?.group).toBe("alliance");
    expect(layout.hit(650, 500, true)).toBeNull();
  });

  it("reuses its tokens: laying out again allocates no new ones", () => {
    const layout = new ClusterLayout();
    const tokens = [token("crest", "you", 200, 200), token("plaque", "alliance", 500, 300, 3)];
    const first = [...layout.layOut(tokens, flat, view())];
    const second = layout.layOut(tokens, flat, view());
    expect(second.every((s) => first.includes(s))).toBe(true);
  });
});

describe("tokenSize", () => {
  it("makes the home crest bigger than an own crest and far crests smaller", () => {
    expect(tokenSize("crest", "home", 1, false, 0.26).hw).toBeGreaterThan(tokenSize("crest", "you", 1, false, 0.26).hw);
    expect(tokenSize("crest", "you", 1, false, 0.14).hw).toBeLessThan(tokenSize("crest", "you", 1, false, 0.26).hw);
  });

  it("widens a plaque with its digits", () => {
    expect(tokenSize("plaque", "alliance", 120, false, 0.26).hw).toBeGreaterThan(tokenSize("plaque", "alliance", 7, false, 0.26).hw);
  });
});
