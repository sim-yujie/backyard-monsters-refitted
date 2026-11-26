// @vitest-environment jsdom
// jsdom: a colour-matrix filter asks for a canvas when it is made.
import { describe, expect, it, vi } from "vitest";
import { Assets, RenderTexture, Sprite, Texture, type ColorMatrixFilter, type Renderer } from "pixi.js";
import { creepZIndex } from "@/game/attack/AttackBattleLayer";
import type { BaseLoadResponse } from "@/api/types";
import type { YardArtAtlas } from "./yardAtlas";
import { HIGHLIGHT_MATRIX, UPGRADE_FADE_ALPHA, YardBuildings } from "./YardBuildings";
import { readWork } from "./buildingWork";
import { litTint } from "./helpGlow";
import { rowOf } from "./buildingCosts";
import { artFor, readYard } from "./yardModel";
import { RETRY_DELAYS_MS, versionedArt } from "./retryLoad";

/**
 * The frame setter a battle turns a tower's gun with (issue #67), and the
 * rebuild of the gun strip when the damaged art brings its own.
 */

/** A Booby Trap and a Sniper Tower on an otherwise empty plot. */
const yardResponse = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 24, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 21, l: 1, X: 200, Y: 200 },
    },
    buildinghealthdata: {},
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

/** White squares for every glyph: enough to build sprites without a GPU. */
const fakeAtlas = (): YardArtAtlas => ({
  placeholder: Texture.WHITE,
  mushroom: Texture.WHITE,
  working: Texture.WHITE,
  destroy() {},
});

describe("YardBuildings.setAnimFrame", () => {
  it("puts a tower's gun strip on a cell before and after the strip arrives", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(yardResponse()), fakeAtlas());
    expect(buildings.animLayerCount(2)).toBe(1);
    expect(buildings.animLayerCount(1)).toBe(0);
    buildings.setAnimFrame(2, 0, 7);
    expect(buildings.animFrameOf(2, 0)).toBe(7);
    // A layer the building does not have is ignored.
    buildings.setAnimFrame(2, 3, 7);
    buildings.setAnimFrame(1, 0, 7);
    expect(buildings.animFrameOf(1, 0)).toBeNull();
    buildings.destroy();
  });

  it("rebuilds the gun strip from the damaged art and keeps the facing", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(yardResponse()), fakeAtlas());
    buildings.setAnimFrame(2, 0, 11);
    const before = buildings.tops.children.length;
    // Below half health the sniper swaps to its damaged picture, which ships a
    // damaged strip of its own.
    buildings.setDamage(2, 0.4);
    expect(buildings.animLayerCount(2)).toBe(1);
    expect(buildings.animFrameOf(2, 0)).toBe(11);
    expect(buildings.tops.children.length).toBe(before);
    buildings.destroy();
  });

  // The yard is shown again after every save change; a strip that started
  // over each time made the Inferno ICC's crystal blink to its dimmest cell
  // whenever one Incubator handed over to the next.
  it("keeps each strip's place when the yard is shown again", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(yardResponse()), fakeAtlas());
    buildings.setAnimFrame(2, 0, 9);
    buildings.show(readYard(yardResponse()), fakeAtlas());
    expect(buildings.animFrameOf(2, 0)).toBe(9);
    buildings.destroy();
  });
});

describe("YardBuildings: fortification overlays", () => {
  const fortified = (fort: number): BaseLoadResponse => {
    const response = yardResponse();
    (response.buildingdata as Record<string, Record<string, unknown>>)["2"]!.fort = fort;
    return response;
  };

  it("adds a back and a front picture for a fortified building only", () => {
    const plain = new YardBuildings();
    plain.show(readYard(yardResponse()), fakeAtlas());
    const base = plain.tops.children.length;
    plain.destroy();

    const buildings = new YardBuildings();
    buildings.show(readYard(fortified(2)), fakeAtlas());
    expect(buildings.tops.children.length).toBe(base + 2);
    buildings.destroy();
  });

  it("stands the back behind the building and the front after its strips", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(fortified(1)), fakeAtlas());
    const kids = buildings.tops.children;
    // Booby trap (1 sprite), then back, sniper top, its gun strip, front.
    expect(kids.length).toBe(5);
    buildings.setDamage(2, 0.4);
    expect(buildings.tops.children.length).toBe(5);
    buildings.destroy();
  });

  it("moves with the building in the planner", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(fortified(1)), fakeAtlas());
    const before = buildings.tops.children.map((one) => [one.x, one.y]);
    buildings.offsetBuilding(2, 10, 20);
    const after = buildings.tops.children.map((one) => [one.x, one.y]);
    expect(after.slice(1).every(([x, y], i) => x === before[i + 1]![0]! + 10 && y === before[i + 1]![1]! + 20)).toBe(true);
    buildings.destroy();
  });
});

describe("YardBuildings.pick before the art arrives (#39)", () => {
  it("takes a press on the footprint drawn meanwhile, and none where the picture will stand", () => {
    const yard = readYard(yardResponse());
    const sniper = yard.buildings.find((one) => one.id === 2)!;
    const buildings = new YardBuildings();
    buildings.show(yard, fakeAtlas());
    // No art is fetched here, so every building is still its placeholder.
    expect(buildings.placeholderCount).toBe(2);
    const { x, y, width, height } = sniper.box;
    expect(buildings.pick(x + width / 2, y + height / 2)?.id).toBe(2);
    // Above the footprint is where the tower's picture rises once it loads;
    // until then nothing is drawn there, so nothing is picked there.
    expect(buildings.pick(x + width / 2, y - 60)).toBeNull();
    buildings.destroy();
  });
});

/** The yard above with the Sniper Tower mid-upgrade, so it carries a countdown badge. */
const upgradingYard = () => {
  const response = yardResponse();
  response.buildingdata!["2"] = { id: 2, t: 21, l: 1, X: 200, Y: 200, cU: 600 };
  return readYard(response);
};

/** The countdown badge: the one sprite in the badge layer. */
const badgeOf = (buildings: YardBuildings) => buildings.markers.children[0]!;

describe("YardBuildings.crownOf", () => {
  it("is the top of the building's picture, not its countdown badge, and moves with it (#139, #230)", () => {
    const yard = upgradingYard();
    const sniper = yard.buildings.find((one) => one.id === 2)!;
    const art = artFor(sniper)!;
    const artTop = Math.min(
      sniper.worldY + art.top.y,
      ...art.anims.map((anim) => sniper.worldY + anim.y),
    );

    const buildings = new YardBuildings();
    buildings.show(yard, fakeAtlas());
    // The badge stands a fixed height over the footprint whatever the art
    // does, so counting it lifted the bar far above a low building.
    const badge = badgeOf(buildings);
    expect(badge.y - badge.height).toBeLessThan(sniper.box.y);
    const crown = buildings.crownOf(2)!;
    expect(crown).toBe(artTop);

    buildings.offsetBuilding(2, 0, -50);
    expect(buildings.crownOf(2)).toBe(crown - 50);
    expect(buildings.crownOf(99)).toBeNull();
    buildings.destroy();
  });

  it("is where the picture will stand before it arrives, so a redraw does not move a bar (#139)", () => {
    const yard = upgradingYard();
    const sniper = yard.buildings.find((one) => one.id === 2)!;

    const buildings = new YardBuildings();
    buildings.show(yard, fakeAtlas());
    // No art is fetched here: every building is still its placeholder, which
    // fills the footprint box well below where the tower's picture rises.
    expect(buildings.placeholderCount).toBe(2);
    const crown = buildings.crownOf(2)!;
    expect(crown).toBeLessThan(sniper.box.y);

    // Every store change redraws the yard from placeholders again.
    buildings.show(yard, fakeAtlas());
    expect(buildings.crownOf(2)).toBe(crown);
    buildings.destroy();
  });
});

describe("YardBuildings.hideBadges", () => {
  it("hides the badge of a building with a bar, through the planner's drawer, and gives it back (#230)", () => {
    const buildings = new YardBuildings();
    buildings.show(upgradingYard(), fakeAtlas());
    const badge = badgeOf(buildings);
    expect(badge.visible).toBe(true);

    buildings.hideBadges(new Set([2]));
    expect(badge.visible).toBe(false);
    // Out of the drawer and back: still hidden, the bar is still there.
    buildings.setHidden(2, true);
    buildings.setHidden(2, false);
    expect(badge.visible).toBe(false);

    // No bar any more (the clock was taken away): the badge comes back.
    buildings.hideBadges(new Set());
    expect(badge.visible).toBe(true);
    // A stored building's badge stays hidden whatever the bars say.
    buildings.setHidden(2, true);
    buildings.hideBadges(new Set());
    expect(badge.visible).toBe(false);
    buildings.destroy();
  });
});

describe("YardBuildings.setHighlight", () => {
  it("lights a building and its layers with Flash's matrix, through a damage swap, and puts it back (#88)", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(yardResponse()), fakeAtlas());
    buildings.setHighlight(2, true);
    expect(buildings.isHighlighted(2)).toBe(true);
    const lit = buildings.tops.children.filter((child) => (child.filters as unknown[] | null)?.length);
    // The sniper's top and its gun strip, sharing one filter.
    expect(lit).toHaveLength(2);
    const filter = (lit[0]!.filters as ColorMatrixFilter[])[0]!;
    expect(filter).toBe((lit[1]!.filters as ColorMatrixFilter[])[0]);
    expect([...filter.matrix]).toEqual([...HIGHLIGHT_MATRIX]);

    // The damaged art brings a new gun strip; it is lit too.
    buildings.setDamage(2, 0.4);
    const relit = buildings.tops.children.filter((child) => (child.filters as unknown[] | null)?.length);
    expect(relit).toHaveLength(2);

    buildings.setHighlight(2, false);
    expect(buildings.isHighlighted(2)).toBe(false);
    expect(buildings.tops.children.some((child) => (child.filters as unknown[] | null)?.length)).toBe(false);
    // An unknown id is ignored.
    buildings.setHighlight(99, true);
    expect(buildings.isHighlighted(99)).toBe(false);
    buildings.destroy();
  });
});

describe("YardBuildings.isAnimating, only while working (#255)", () => {
  const capacity = rowOf(1)![6]!.capacity[0]!;
  /** A full Twig Snapper, one with a cycle to go, a fountain and a sniper tower. */
  const workResponse = (): BaseLoadResponse =>
    ({
      ...yardResponse(),
      savetime: 1_700_000_000,
      buildingdata: {
        "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: capacity },
        "2": { id: 2, t: 1, l: 1, X: 100, Y: 0, st: 0, cP: 30 },
        "3": { id: 3, t: 105, l: 1, X: 200, Y: 0 },
        "4": { id: 4, t: 21, l: 1, X: 300, Y: 0 },
      },
    }) as unknown as BaseLoadResponse;

  it("holds a full harvester, runs a filling one until it fills, and leaves the rest as they were", () => {
    const response = workResponse();
    const buildings = new YardBuildings();
    buildings.show(readYard(response), fakeAtlas(), readWork(response));
    const now = 1_700_000_000;
    expect(buildings.isAnimating(1, now)).toBe(false);
    expect(buildings.isAnimating(2, now)).toBe(true);
    expect(buildings.isAnimating(3, now)).toBe(true);
    // A tower's strip is a facing, never a loop.
    expect(buildings.isAnimating(4, now)).toBe(false);
    // The buffer fills partway through, and the strip stops with it.
    const full = readWork(response).get(2)!;
    expect(buildings.isAnimating(2, full - 1)).toBe(true);
    expect(buildings.isAnimating(2, full)).toBe(false);
    buildings.destroy();
  });

  it("holds every working building when nobody says what is working, until told", () => {
    const response = workResponse();
    const buildings = new YardBuildings();
    buildings.show(readYard(response), fakeAtlas());
    const now = 1_700_000_000;
    expect(buildings.isAnimating(2, now)).toBe(false);
    expect(buildings.isAnimating(3, now)).toBe(true);
    buildings.setWork(readWork(response));
    expect(buildings.isAnimating(2, now)).toBe(true);
    buildings.destroy();
  });
});

describe("YardBuildings guests (#272)", () => {
  it("stands a walker among the buildings by its depth key, through a redraw, until it leaves", () => {
    const yard = readYard(yardResponse());
    const sniper = yard.buildings.find((one) => one.id === 2)!;
    const buildings = new YardBuildings();
    buildings.show(yard, fakeAtlas());

    const behind = new Sprite(Texture.WHITE);
    behind.zIndex = creepZIndex(sniper.centreX, sniper.centreY - 20, 1);
    const inFront = new Sprite(Texture.WHITE);
    inFront.zIndex = creepZIndex(sniper.centreX, sniper.centreY + 20, 2);
    buildings.addGuest(behind);
    buildings.addGuest(inFront);

    // Where each stands in the draw list once sorted; the Sniper by its key.
    const order = (): number[] => {
      buildings.tops.sortChildren();
      const children = buildings.tops.children;
      const top = children.findIndex((child) => child.zIndex === sniper.depth * 8);
      return [children.indexOf(behind), top, children.indexOf(inFront)];
    };
    const [before, sniperAt, after] = order();
    expect(before).toBeLessThan(sniperAt!);
    expect(after).toBeGreaterThan(sniperAt!);

    // A redraw destroys every building sprite; the walkers stay, sorted.
    buildings.show(readYard(yardResponse()), fakeAtlas());
    expect(behind.destroyed).toBe(false);
    const [again, sniperAgain, afterAgain] = order();
    expect(again).toBeLessThan(sniperAgain!);
    expect(afterAgain).toBeGreaterThan(sniperAgain!);

    buildings.removeGuest(behind);
    expect(behind.parent).toBeNull();
    expect(behind.destroyed).toBe(false);
    buildings.destroy();
    expect(inFront.destroyed).toBe(false);
    behind.destroy();
    inFront.destroy();
  });
});

describe("YardBuildings: loading the pictures", () => {
  /** The trap and the tower above, behind three walls (type 17) that share one picture. */
  const walledYard = () => {
    const response = yardResponse();
    for (const id of [3, 4, 5]) response.buildingdata![String(id)] = { id, t: 17, l: 1, X: 400 + id * 40, Y: 0 };
    return readYard(response);
  };

  const everywhere = { x: -10_000, y: -10_000, width: 20_000, height: 20_000 };

  it("asks for every building's own picture first, the most shared first, before any shadow or strip", () => {
    const asked: string[] = [];
    const load = vi.spyOn(Assets, "load").mockImplementation(((url: string) => {
      asked.push(url);
      return new Promise(() => {});
    }) as typeof Assets.load);
    try {
      const buildings = new YardBuildings();
      buildings.show(walledYard(), fakeAtlas());
      // Asked for on `show`, not on the first frame.
      expect(asked[0]).toBe(versionedArt("/assets/buildings/walls/top.3d1@2x.webp"));
      expect(asked).toHaveLength(3);

      buildings.draw(everywhere);
      const tops = asked.slice(0, 3);
      // A 3D tower's own picture is its body (`body.t1@2x.webp`), not a `top`; a 3D wall's is `top.3d1@2x.webp`.
      expect(tops.every((url) => /\/(top\.\d|body\.t\d)/.test(url))).toBe(true);
      expect(asked.length).toBeGreaterThan(3);
      buildings.destroy();
    } finally {
      load.mockRestore();
    }
  });

  it("never writes a name over a building whose picture is late or failed", async () => {
    vi.useFakeTimers();
    // The walls' picture fails every try; the trap's fails once, then arrives.
    let trapTries = 0;
    const load = vi.spyOn(Assets, "load").mockImplementation(((url: string) => {
      if (url.includes("walls/top")) return Promise.reject(new Error("gone"));
      if (url.includes("boobytrap/top") && trapTries++ === 0) return Promise.reject(new Error("broken answer"));
      if (url.includes("boobytrap/top")) return Promise.resolve(Texture.WHITE);
      return new Promise(() => {});
    }) as typeof Assets.load);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const buildings = new YardBuildings();
      buildings.show(walledYard(), fakeAtlas());
      buildings.draw(everywhere);
      expect(buildings.labels.children).toHaveLength(0);

      // Five tries over about four seconds.
      for (const delay of RETRY_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay);
        buildings.draw(everywhere);
      }
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("walls/top.3d1@2x.webp"), expect.anything());
      // The trap has its picture; the three walls and the tower keep a faint
      // footprint, and nothing is written over any of them.
      expect(buildings.placeholderCount).toBe(4);
      expect(buildings.labels.children).toHaveLength(0);
      buildings.destroy();
    } finally {
      load.mockRestore();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("YardBuildings.onAllArtReady (beta 9: monsters and music after the buildings)", () => {
  const everywhere = { x: -10_000, y: -10_000, width: 20_000, height: 20_000 };
  const settle = async (buildings: YardBuildings): Promise<void> => {
    for (let pass = 0; pass < 5; pass++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      buildings.draw(everywhere);
    }
  };

  it("waits for the shadows and strips as well as the tops, and counts a missing picture as in", async () => {
    // Tops come at once; the sniper's gun strip waits for `release`; one shadow fails for good.
    let release: () => void = () => {};
    const strips = new Promise<void>((resolve) => (release = resolve));
    const load = vi.spyOn(Assets, "load").mockImplementation((async (url: string) => {
      if (/shadow/.test(url) && /boobytrap/.test(url)) throw new Error("gone");
      if (/turret|anim/.test(url)) await strips;
      return Texture.WHITE;
    }) as typeof Assets.load);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const buildings = new YardBuildings();
      let tops = 0;
      let all = 0;
      buildings.onArtReady(() => (tops += 1));
      buildings.onAllArtReady(() => (all += 1));
      buildings.show(readYard(yardResponse()), fakeAtlas());
      for (let pass = 0; pass < 10; pass++) {
        await vi.advanceTimersByTimeAsync(1000);
        buildings.draw(everywhere);
      }
      expect(tops).toBe(1);
      expect(all).toBe(0);
      release();
      vi.useRealTimers();
      await settle(buildings);
      expect(all).toBe(1);
      expect(performance.getEntriesByName("yard-art-all")).toHaveLength(1);
      buildings.destroy();
    } finally {
      vi.useRealTimers();
      load.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("YardBuildings.setFaded (the upgrade preview, beta 8)", () => {
  const fortifiedSniper = (): BaseLoadResponse => {
    const response = yardResponse();
    (response.buildingdata as Record<string, Record<string, unknown>>)["2"]!.fort = 1;
    return response;
  };
  const everywhere = { x: -10_000, y: -10_000, width: 20_000, height: 20_000 };
  const settle = async (buildings: YardBuildings): Promise<void> => {
    for (let pass = 0; pass < 5; pass++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      buildings.draw(everywhere);
    }
  };

  it("fades a building with its strip, shadow and fortification, keeps it faded as pictures arrive, and puts it back", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const load = vi.spyOn(Assets, "load").mockImplementation((async () => {
      await gate;
      return Texture.WHITE;
    }) as typeof Assets.load);
    try {
      const buildings = new YardBuildings();
      buildings.show(readYard(fortifiedSniper()), fakeAtlas());
      // Booby trap, then the sniper's fort back, top, gun strip and fort front.
      const [trap, back, top, gun, front] = buildings.tops.children;
      buildings.setFaded(2);
      expect(buildings.fadedId).toBe(2);
      // Still a placeholder: it keeps its own faint grey.
      expect(top!.alpha).toBeCloseTo(0.3);
      expect([back!.alpha, gun!.alpha, front!.alpha]).toEqual([UPGRADE_FADE_ALPHA, UPGRADE_FADE_ALPHA, UPGRADE_FADE_ALPHA]);

      release();
      await settle(buildings);
      // The picture came in faded; the trap beside it is untouched.
      expect(top!.alpha).toBe(UPGRADE_FADE_ALPHA);
      expect(trap!.alpha).toBe(1);
      expect(buildings.shadows.children.every((shadow) => shadow.alpha === 1 || shadow.alpha === UPGRADE_FADE_ALPHA)).toBe(true);

      buildings.setFaded(null);
      expect(buildings.fadedId).toBeNull();
      expect(buildings.tops.children.map((child) => child.alpha)).toEqual([1, 1, 1, 1, 1]);
      expect(buildings.shadows.children.every((shadow) => shadow.alpha === 1)).toBe(true);

      // Shown again (every save change), nothing stays faded.
      buildings.setFaded(2);
      buildings.show(readYard(fortifiedSniper()), fakeAtlas());
      expect(buildings.fadedId).toBeNull();
      buildings.destroy();
    } finally {
      load.mockRestore();
    }
  });
});

describe("YardBuildings.setHelpLit (a friend's visit, owner's pick F, 26 Nov 2026)", () => {
  const everywhere = { x: -10_000, y: -10_000, width: 20_000, height: 20_000 };
  const lit = litTint(0xffffff, 1);
  const tinted = (buildings: YardBuildings): number =>
    buildings.tops.children.filter((child) => child instanceof Sprite && child.tint === lit).length;
  const settle = async (buildings: YardBuildings): Promise<void> => {
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) await Promise.resolve();
      buildings.draw(everywhere);
    }
  };
  const fakeRenderer = () => ({ generateTexture: vi.fn(() => RenderTexture.create({ width: 4, height: 4 })) });

  it("tints a building and its strip amber with a glow behind and a lift over it, and puts it back", async () => {
    const load = vi.spyOn(Assets, "load").mockImplementation((() => Promise.resolve(Texture.WHITE)) as typeof Assets.load);
    try {
      const buildings = new YardBuildings();
      const renderer = fakeRenderer();
      buildings.useRenderer(renderer as unknown as Renderer);
      buildings.show(readYard(yardResponse()), fakeAtlas());
      await settle(buildings);
      const before = buildings.tops.children.length;

      buildings.setHelpLit(new Map([[2, 1]]));
      expect(buildings.helpLitOf(2)).toBe(1);
      expect(buildings.helpLitOf(1)).toBe(0);
      // The sniper's top and its gun strip; the trap is left alone.
      expect(tinted(buildings)).toBe(2);
      // One glow baked: behind the building, and laid over it adding light.
      expect(renderer.generateTexture).toHaveBeenCalledTimes(1);
      expect(buildings.tops.children.length).toBe(before + 2);
      expect(buildings.tops.children.filter((child) => child.blendMode === "add")).toHaveLength(1);
      // No filter is left on any building: the light costs no pass a frame.
      expect(buildings.tops.children.some((child) => (child.filters as unknown[] | null)?.length)).toBe(false);

      // The yard is shown again after a help: lit again next frame, from the same baked glow.
      buildings.show(readYard(yardResponse()), fakeAtlas());
      await settle(buildings);
      expect(buildings.helpLitOf(2)).toBe(0);
      buildings.setHelpLit(new Map([[2, 1]]));
      expect(tinted(buildings)).toBe(2);
      expect(renderer.generateTexture).toHaveBeenCalledTimes(1);

      // Helped, or the visit left: back to how it was.
      buildings.setHelpLit(new Map());
      expect(tinted(buildings)).toBe(0);
      expect(buildings.tops.children.length).toBe(before);
      buildings.destroy();
    } finally {
      load.mockRestore();
    }
  });

  it("lights a picture that arrives after the building was lit", async () => {
    let arrive: (texture: Texture) => void = () => {};
    const load = vi.spyOn(Assets, "load").mockImplementation(((url: string) =>
      url.includes("sniper") && /body|top/.test(url)
        ? new Promise<Texture>((resolve) => (arrive = resolve))
        : Promise.resolve(Texture.WHITE)) as typeof Assets.load);
    try {
      const buildings = new YardBuildings();
      buildings.show(readYard(yardResponse()), fakeAtlas());
      await settle(buildings);
      buildings.setHelpLit(new Map([[2, 1]]));
      const early = tinted(buildings);
      arrive(Texture.WHITE);
      await settle(buildings);
      expect(tinted(buildings)).toBe(early + 1);
      buildings.destroy();
    } finally {
      load.mockRestore();
    }
  });
});
