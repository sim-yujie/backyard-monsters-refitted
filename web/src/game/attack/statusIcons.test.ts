import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Texture, type Sprite } from "pixi.js";
import type { CreepSnapshot } from "@/game/combat/rules";
import {
  ICON_GAP,
  ICON_SIZE,
  STATUS_EFFECTS,
  STATUS_ICON_FILES,
  STATUS_ICON_SETS,
  StatusIconRow,
  StatusIconTextures,
  badgeScale,
  statusIconSet,
  statusIconUrl,
  statusRow,
  statusesOf,
  type StatusEffect,
} from "./statusIcons";

/**
 * The status icons' arithmetic and their row without a renderer: which
 * effects a snapshot carries, that each has its picture, where the row sits
 * over the bar, how a stacking venom grows, and that an icon comes and goes
 * with its effect.
 */

const PUBLIC_ICONS = path.resolve(__dirname, "../../../public/status-icons");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Pictures that are in already, a white square for every effect. */
const readyTextures = async (): Promise<StatusIconTextures> => {
  const textures = new StatusIconTextures(STATUS_ICON_SETS.stickers, () => Promise.resolve(Texture.WHITE));
  for (const effect of STATUS_EFFECTS) textures.get(effect);
  await flush();
  return textures;
};

const creepOf = (overrides: Partial<CreepSnapshot> = {}): CreepSnapshot => ({
  id: 1,
  monsterId: "C1",
  level: 1,
  champion: false,
  friendly: false,
  ix: 100,
  iy: 100,
  hp: 200,
  maxHp: 200,
  flying: false,
  state: "walking",
  targetBuilding: -1,
  targetCreep: -1,
  ...overrides,
});

const idsOf = (creep: CreepSnapshot | null): string[] =>
  statusesOf(creep).map(({ effect }) => effect.id);

describe("statusesOf", () => {
  it("finds nothing on a plain creep, or on no creep", () => {
    expect(idsOf(null)).toEqual([]);
    expect(idsOf(creepOf())).toEqual([]);
    // The engine sends false for an effect that is off; that is no badge.
    expect(
      idsOf(creepOf({ burning: false, enraged: false, puttied: false, lootBoosted: false })),
    ).toEqual([]);
  });

  it("reads each effect the engine reports", () => {
    expect(idsOf(creepOf({ poisonStacks: 1 }))).toEqual(["poisoned"]);
    expect(idsOf(creepOf({ burning: true }))).toEqual(["burning"]);
    expect(idsOf(creepOf({ enraged: true }))).toEqual(["enraged"]);
    expect(idsOf(creepOf({ puttied: true }))).toEqual(["puttied"]);
    expect(idsOf(creepOf({ lootBoosted: true }))).toEqual(["lootBoosted"]);
  });

  it("keeps the registry's order whatever order the flags are in, and carries the venom's stacks", () => {
    const all = statusesOf(
      creepOf({ lootBoosted: true, burning: true, poisonStacks: 4, enraged: true }),
    );
    expect(all.map(({ effect }) => effect.id)).toEqual([
      "poisoned",
      "burning",
      "enraged",
      "lootBoosted",
    ]);
    expect(all[0]?.stacks).toBe(4);
    expect(all[1]?.stacks).toBe(1);
  });

  it("takes a new effect from one registry line", () => {
    const slowed: StatusEffect = {
      id: "slowed",
      label: "Slowed",
      stacks: (c) => (c.flying ? 1 : 0),
    };
    const effects = [...STATUS_EFFECTS, slowed];
    expect(
      statusesOf(creepOf({ flying: true, burning: true }), effects).map(
        ({ effect }) => effect.id,
      ),
    ).toEqual(["burning", "slowed"]);
  });
});

describe("the registry", () => {
  it("gives every effect its own id, and a picture shipped under that id", () => {
    const ids = STATUS_EFFECTS.map((effect) => effect.id);
    expect(new Set(ids).size).toBe(ids.length);
    const files: readonly string[] = STATUS_ICON_FILES;
    for (const id of ids) expect(files).toContain(id);
  });

  it("ships every picture in both sets, the ones still waiting for an effect too", () => {
    for (const set of Object.values(STATUS_ICON_SETS)) {
      for (const id of STATUS_ICON_FILES) {
        const file = path.join(PUBLIC_ICONS, set.id, `${id}.webp`);
        expect(existsSync(file), file).toBe(true);
        // Game-sized: a few KB each, not the painted original.
        expect(statSync(file).size).toBeLessThan(12_000);
      }
    }
  });

  it("serves an effect's picture by its set and id", () => {
    expect(statusIconUrl("poisoned")).toMatch(/status-icons\/stickers\/poisoned\.webp$/);
    expect(statusIconUrl("poisoned", STATUS_ICON_SETS.shields)).toMatch(
      /status-icons\/shields\/poisoned\.webp$/,
    );
  });

  it("draws the stickers unless the trial switch asks for shields", () => {
    // No browser here: the stickers.
    expect(statusIconSet()).toBe(STATUS_ICON_SETS.stickers);
    const stored = new Map<string, string>();
    const browser = { location: { search: "" }, localStorage: { getItem: (key: string) => stored.get(key) ?? null } };
    vi.stubGlobal("window", browser);
    expect(statusIconSet()).toBe(STATUS_ICON_SETS.stickers);
    browser.location.search = "?icons=shields";
    expect(statusIconSet()).toBe(STATUS_ICON_SETS.shields);
    // The address wins over the stored choice.
    stored.set("bymr.statusIcons", "shields");
    browser.location.search = "?icons=stickers";
    expect(statusIconSet()).toBe(STATUS_ICON_SETS.stickers);
    browser.location.search = "";
    expect(statusIconSet()).toBe(STATUS_ICON_SETS.shields);
    vi.unstubAllGlobals();
  });
});

describe("StatusIconTextures", () => {
  it("asks for a picture once, and gives it out once it is in", async () => {
    const asked: string[] = [];
    const textures = new StatusIconTextures(STATUS_ICON_SETS.stickers, (url) => {
      asked.push(url);
      return Promise.resolve(Texture.WHITE);
    });
    const [venom] = STATUS_EFFECTS as [StatusEffect];
    expect(textures.get(venom)).toBeNull();
    expect(textures.get(venom)).toBeNull();
    await flush();
    expect(textures.get(venom)).toBe(Texture.WHITE);
    expect(asked).toEqual([statusIconUrl("poisoned", STATUS_ICON_SETS.stickers)]);
  });

  it("fetches the other set's pictures once switched to it", async () => {
    const asked: string[] = [];
    const textures = new StatusIconTextures(STATUS_ICON_SETS.stickers, (url) => {
      asked.push(url);
      return Promise.resolve(Texture.WHITE);
    });
    const [venom] = STATUS_EFFECTS as [StatusEffect];
    textures.get(venom);
    await flush();
    textures.use(STATUS_ICON_SETS.shields);
    expect(textures.set).toBe(STATUS_ICON_SETS.shields);
    expect(textures.get(venom)).toBeNull();
    await flush();
    expect(textures.get(venom)).toBe(Texture.WHITE);
    expect(asked).toEqual([
      statusIconUrl("poisoned", STATUS_ICON_SETS.stickers),
      statusIconUrl("poisoned", STATUS_ICON_SETS.shields),
    ]);
  });

  it("gives up quietly on a picture that did not load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const textures = new StatusIconTextures(STATUS_ICON_SETS.stickers, () => {
      calls += 1;
      return Promise.reject(new Error("404"));
    });
    const [venom] = STATUS_EFFECTS as [StatusEffect];
    textures.get(venom);
    await flush();
    expect(textures.get(venom)).toBeNull();
    expect(calls).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("statusRow", () => {
  it("puts one icon over the middle of the bar, just above it", () => {
    expect(statusRow(1, 50, 20)).toEqual([{ x: 50, y: 20 - ICON_GAP - ICON_SIZE / 2 }]);
  });

  it("spreads a longer row evenly both ways from the middle", () => {
    const row = statusRow(3, 50, 20);
    const step = ICON_SIZE + ICON_GAP;
    expect(row.map((spot) => spot.x)).toEqual([50 - step, 50, 50 + step]);
    expect(new Set(row.map((spot) => spot.y)).size).toBe(1);
    const pair = statusRow(2, 50, 20);
    expect(((pair[0]?.x ?? 0) + (pair[1]?.x ?? 0)) / 2).toBe(50);
  });
});

describe("badgeScale", () => {
  it("grows a little with each stack past the first, then stops", () => {
    expect(badgeScale(1)).toBe(1);
    expect(badgeScale(2)).toBeGreaterThan(1);
    expect(badgeScale(3)).toBeGreaterThan(badgeScale(2));
    expect(badgeScale(50)).toBe(badgeScale(5));
    expect(badgeScale(0)).toBe(1);
  });
});

describe("StatusIconRow", () => {
  it("starts hidden and shows what it is given, left to right", async () => {
    const row = new StatusIconRow(await readyTextures());
    expect(row.container.visible).toBe(false);
    row.show(statusesOf(creepOf({ burning: true, poisonStacks: 2 })), 50, 20);
    expect(row.container.visible).toBe(true);
    expect(row.shown).toEqual(["poisoned", "burning"]);
    row.destroy();
  });

  it("keeps a place for a picture still on its way, and shows it once it is in", async () => {
    const textures = new StatusIconTextures(STATUS_ICON_SETS.stickers, () => Promise.resolve(Texture.WHITE));
    const row = new StatusIconRow(textures);
    const statuses = statusesOf(creepOf({ burning: true, poisonStacks: 2 }));
    row.show(statuses, 50, 20);
    expect(row.shown).toEqual([]);
    await flush();
    row.show(statuses, 50, 20);
    expect(row.shown).toEqual(["poisoned", "burning"]);
    // Both in their two-icon places, not the one-icon middle.
    const xs = row.container.children.map((child) => child.x).sort((one, other) => one - other);
    expect(xs).toEqual(statusRow(2, 50, 20).map((spot) => Math.round(spot.x)));
    row.destroy();
  });

  it("drops an icon when its effect ends, and hides when none is left", async () => {
    const row = new StatusIconRow(await readyTextures());
    row.show(statusesOf(creepOf({ burning: true, poisonStacks: 2 })), 50, 20);
    row.show(statusesOf(creepOf({ burning: true })), 50, 20);
    expect(row.shown).toEqual(["burning"]);
    // The one icon left moves to the middle.
    const flame = row.container.children.find((child) => child.visible) as Sprite;
    expect(flame.x).toBe(50);
    row.show(statusesOf(creepOf()), 50, 20);
    expect(row.container.visible).toBe(false);
    expect(row.shown).toEqual([]);
    row.destroy();
  });

  it("makes one sprite per effect and reuses it, sized to the icon and scaled by its stacks", async () => {
    const row = new StatusIconRow(await readyTextures());
    row.show(statusesOf(creepOf({ poisonStacks: 1 })), 0, 0);
    const venom = row.container.children[0] as Sprite;
    expect(venom.width).toBeCloseTo(ICON_SIZE);
    row.show(statusesOf(creepOf({ poisonStacks: 3 })), 0, 0);
    expect(row.container.children).toHaveLength(1);
    expect(venom.width).toBeCloseTo(ICON_SIZE * badgeScale(3));
    row.destroy();
  });

  it("sizes and spaces a set's icons by that set's size", async () => {
    const { shields } = STATUS_ICON_SETS;
    const textures = new StatusIconTextures(shields, () => Promise.resolve(Texture.WHITE));
    for (const effect of STATUS_EFFECTS) textures.get(effect);
    await flush();
    const row = new StatusIconRow(textures);
    row.show(statusesOf(creepOf({ burning: true, poisonStacks: 1 })), 50, 20);
    const icons = row.container.children as Sprite[];
    expect(icons[0]?.width).toBeCloseTo(shields.size);
    expect(icons.map((icon) => icon.x)).toEqual(
      statusRow(2, 50, 20, shields.size).map((spot) => Math.round(spot.x)),
    );
    row.destroy();
  });

  it("fades with the creep, and hides for one that cannot be seen at all", async () => {
    const row = new StatusIconRow(await readyTextures());
    row.show(statusesOf(creepOf({ burning: true })), 0, 0, 0.3);
    expect(row.container.alpha).toBe(0.3);
    row.show(statusesOf(creepOf({ burning: true })), 0, 0, 0);
    expect(row.container.visible).toBe(false);
    row.destroy();
  });
});
