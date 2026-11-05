import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Point } from "@/game/yard/YardGrid";
import {
  CRIT_POP,
  CRIT_POP_TICKS,
  CreepFx,
  LABEL_BONUS_COLOUR,
  LABEL_REDUCED_COLOUR,
  critPop,
  hasMods,
  modText,
  type CreepFxHost,
} from "./creepFx";
import { StatusIconTextures } from "./statusIcons";

/**
 * The damage numbers' modifiers (owner, beta 6): "(+X)" in orange for a crit,
 * "(-X)" in pale blue for a weakened striker or Fomor's armour, a crit's pop,
 * the thorn mark before an Ichi's reflected damage, and the Classic look's
 * plain font.
 */

const host: CreepFxHost = {
  creepAnchor: () => null,
  flashBuilding: () => {},
  zoom: () => 1,
};

const AT: Point = { x: 100, y: 164 };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Thorn pictures that are in already. */
const readyMarks = async (): Promise<StatusIconTextures> => {
  const marks = new StatusIconTextures(() => Promise.resolve(Texture.WHITE));
  marks.get({ id: "thorns", label: "Thorns" });
  await flush();
  return marks;
};

describe("a number's modifier", () => {
  it("reads a crit as (+X) in orange and a cut as (-X) in pale blue", () => {
    expect(modText({ bonus: 170 })).toEqual({ text: "(+170)", colour: LABEL_BONUS_COLOUR });
    expect(modText({ reduced: 159.6 })).toEqual({ text: "(-160)", colour: LABEL_REDUCED_COLOUR });
    expect(modText({ thorns: true })).toBeNull();
    expect(modText(undefined)).toBeNull();
  });

  it("counts a modifier under half a point as none", () => {
    expect(hasMods({ bonus: 0.2, reduced: 0.4 })).toBe(false);
    expect(hasMods({ thorns: true })).toBe(true);
    expect(hasMods(undefined)).toBe(false);
  });

  it("pops a crit larger and settles it", () => {
    expect(critPop(0)).toBeCloseTo(1 + CRIT_POP, 9);
    expect(critPop(CRIT_POP_TICKS / 2)).toBeCloseTo(1 + CRIT_POP / 2, 9);
    expect(critPop(CRIT_POP_TICKS)).toBe(1);
    expect(critPop(100)).toBe(1);
  });
});

describe.each([
  ["plain", false],
  ["juiced", true],
])("CreepFx's %s numbers with modifiers", (_name, juiced) => {
  it("shows the main number as today, the crit's (+X) beside it, and pops it", () => {
    const fx = new CreepFx(host, false, juiced);
    fx.number(10, "building:1", -1, 340, AT, "damage", { bonus: 170 });
    fx.update(10);
    const [crit] = fx.partsFor("building:1");
    expect(crit).toMatchObject({ text: "340", extra: "(+170)", extraColour: LABEL_BONUS_COLOUR });
    const popped = crit!.scale;
    fx.update(10 + CRIT_POP_TICKS + 2);
    expect(fx.partsFor("building:1")[0]!.scale).toBeLessThan(popped);
  });

  it("shows a weakened blow's (-X) in pale blue, with no pop", () => {
    const fx = new CreepFx(host, false, juiced);
    fx.number(10, "creep:4", -1, 500, AT, "damage", { reduced: 160 });
    fx.update(10);
    expect(fx.partsFor("creep:4")[0]).toMatchObject({
      text: "500",
      extra: "(-160)",
      extraColour: LABEL_REDUCED_COLOUR,
      thorns: false,
    });
  });

  it("never adds a modified hit into a plain number, nor a plain one into it", () => {
    const fx = new CreepFx(host, false, juiced);
    fx.number(10, "building:2", -1, 100, AT, "damage");
    fx.number(11, "building:2", -1, 200, AT, "damage", { bonus: 100 });
    fx.number(12, "building:2", -1, 100, AT, "damage");
    fx.update(12);
    const parts = fx.partsFor("building:2");
    expect(parts.map((part) => part.extra)).toContain("(+100)");
    const crit = parts.find((part) => part.extra === "(+100)");
    expect(crit?.text).toBe("200");
  });

  it("puts the thorn mark before an Ichi's reflected damage", async () => {
    const fx = new CreepFx(host, false, juiced, true, false, await readyMarks());
    fx.number(10, "building:3", -1, 28, AT, "damage", { thorns: true });
    fx.update(10);
    expect(fx.partsFor("building:3")[0]).toMatchObject({ text: "28", extra: null, thorns: true });
  });

  it("leaves a plain number plain", () => {
    const fx = new CreepFx(host, false, juiced);
    fx.number(10, "creep:9", -1, 60, AT, "damage");
    fx.update(10);
    expect(fx.partsFor("creep:9")[0]).toMatchObject({ text: "60", extra: null, thorns: false });
  });
});

describe("the Classic look's numbers", () => {
  it("shows them in a plain bold font rather than Titan One", () => {
    const classic = new CreepFx(host, false, false, true, true);
    classic.number(10, "creep:1", -1, 60, AT, "damage", { bonus: 30 });
    const modern = new CreepFx(host, false, false, true, false);
    modern.number(10, "creep:1", -1, 60, AT, "damage");
    expect(classic.partsFor("creep:1")[0]?.font).toMatch(/Verdana/);
    expect(classic.partsFor("creep:1")[0]?.extra).toBe("(+30)");
    expect(modern.partsFor("creep:1")[0]?.font).toMatch(/Titan One/);
  });
});
