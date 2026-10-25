import { describe, expect, it } from "vitest";
import { buildEngineYard, createBattle } from "@/game/combat/rules";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import {
  anchorOffset,
  cycleRow,
  directionColumn,
  flyerAltitude,
  frameRect,
  frameRow,
  championFlightTop,
  hoverOffset,
  isHighResolutionSheet,
  krallenLook,
  MIRRORED_HEADINGS,
  REPAINTED_SHEETS,
  shadowOffset,
  sheetColumn,
  sheetUrl,
  spriteFor,
} from "./monsterSprites";

const sheet = (key: string) => {
  const found = MONSTER_SPRITES[key];
  if (!found) throw new Error(`no sheet ${key}`);
  return found;
};

const degrees = (value: number) => (value * Math.PI) / 180;

describe("directionColumn", () => {
  it("maps the four cardinal headings on a 30-column sheet (SPRITES.as:369)", () => {
    // 0 faces right (+x); 90 faces down the screen (+y); columns run clockwise.
    expect(directionColumn(0, 30)).toBe(0);
    expect(directionColumn(Math.PI / 2, 30)).toBe(7); // 90 / 12 = 7.5 -> 7
    expect(directionColumn(Math.PI, 30)).toBe(15);
    expect(directionColumn((3 * Math.PI) / 2, 30)).toBe(22); // 270 / 12 = 22.5 -> 22
  });

  it("maps the same headings on a 32-column sheet (SPRITES.as:182, :207)", () => {
    expect(directionColumn(0, 32)).toBe(0);
    expect(directionColumn(Math.PI / 2, 32)).toBe(8);
    expect(directionColumn(Math.PI, 32)).toBe(16);
    expect(directionColumn((3 * Math.PI) / 2, 32)).toBe(24);
  });

  it("wraps negative angles and full turns like MonsterBase.as:610-613 and SPRITES.as:127-129", () => {
    expect(directionColumn(-Math.PI / 2, 30)).toBe(22);
    expect(directionColumn(2 * Math.PI, 30)).toBe(0);
    expect(directionColumn(2 * Math.PI + Math.PI / 2, 32)).toBe(8);
    expect(directionColumn(-4 * Math.PI, 16, 45)).toBe(14);
    expect(directionColumn(degrees(359.9), 30)).toBe(29);
    expect(directionColumn(degrees(359.9), 32)).toBe(31);
  });

  it("offsets champions by 45 degrees before the 22.5 degree split (ChampionBase.as:1539-1545)", () => {
    expect(directionColumn(0, 16, 45)).toBe(14); // -45 -> 315 -> 14
    expect(directionColumn(degrees(45), 16, 45)).toBe(0);
    expect(directionColumn(Math.PI / 2, 16, 45)).toBe(2);
    expect(directionColumn(Math.PI, 16, 45)).toBe(6);
    expect(directionColumn((3 * Math.PI) / 2, 16, 45)).toBe(10);
    // int() truncates toward zero, so 44.9 - 45 is 0, not -1 -> 359.
    expect(directionColumn(degrees(44.9), 16, 45)).toBe(0);
  });

  it("is always 0 for a shadow", () => {
    expect(directionColumn(Math.PI, 1)).toBe(0);
    expect(sheetColumn(sheet("shadow"), Math.PI)).toBe(0);
  });

  it("reads the count and offset off the sheet", () => {
    expect(sheetColumn(sheet("C2"), Math.PI)).toBe(15);
    expect(sheetColumn(sheet("C15"), Math.PI)).toBe(16);
    expect(sheetColumn(sheet("G1_1"), Math.PI)).toBe(6);
  });

  it("reads a mirror-painted repaint (Ichi) through the mirror", () => {
    const ichi = sheet("C6");
    expect(MIRRORED_HEADINGS.has(ichi.file)).toBe(true);
    expect(MIRRORED_HEADINGS.has(sheet("C8").file)).toBe(true); // Fang, painted the same way
    // The painted column 0 faces left and column 15 faces right.
    expect(sheetColumn(ichi, 0)).toBe(15); // moving right
    expect(sheetColumn(ichi, Math.PI)).toBe(0); // moving left
    expect(sheetColumn(ichi, degrees(45))).toBe(12); // down-right: column 3 mirrored
    expect(sheetColumn(ichi, degrees(135))).toBe(4); // down-left: column 11 mirrored
    expect(sheetColumn(ichi, degrees(225))).toBe(27); // up-left: column 18 mirrored
    expect(sheetColumn(ichi, degrees(315))).toBe(19); // up-right: column 26 mirrored
    // Straight down and straight up keep their side of the sheet.
    expect([7, 8]).toContain(sheetColumn(ichi, Math.PI / 2));
    expect([22, 23]).toContain(sheetColumn(ichi, (3 * Math.PI) / 2));
  });

  it("swaps every column with its mirror and only for the listed sheets", () => {
    const ichi = sheet("C6");
    for (let column = 0; column < 30; column++) {
      const angle = degrees(column * 12 + 6);
      expect(sheetColumn(ichi, angle)).toBe((45 - column) % 30);
    }
    const others = Object.values(MONSTER_SPRITES).filter((s) => !MIRRORED_HEADINGS.has(s.file));
    for (const other of others) {
      expect(sheetColumn(other, degrees(5))).toBe(directionColumn(degrees(5), other.directions, other.directionOffset));
    }
  });
});

describe("frameRow", () => {
  it("advances a champion walk every 8 ticks through rows 1-7 (SPRITES.as:235)", () => {
    const gorgo = sheet("G1_1");
    const rows = [0, 7, 8, 15, 16, 55, 56, 57].map((tick) => frameRow(gorgo, "walk", tick));
    expect(rows).toEqual([1, 1, 2, 2, 3, 7, 1, 1]);
  });

  it("cycles a champion attack over its own rows, longer from level 4 (SPRITES.as:238-243)", () => {
    const low = sheet("G1_3");
    const high = sheet("G1_4");
    const seen = (one: typeof low) => {
      const rows = new Set<number>();
      for (let tick = 0; tick < 8 * 20; tick++) rows.add(frameRow(one, "attack", tick));
      return [...rows].sort((a, b) => a - b);
    };
    expect(seen(low)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(seen(high)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(frameRow(high, "attack", 8 * 8)).toBe(8);
  });

  it("keeps a single-pose creep on row 0 whatever is asked", () => {
    const pokey = sheet("C2");
    for (const animation of ["idle", "walk", "attack", "stomp", "invisible"] as const) {
      for (const tick of [0, 7, 8, 100, 1234]) expect(frameRow(pokey, animation, tick)).toBe(0);
    }
  });

  it("flaps the Teratorn's wings every 3 ticks over three rows (SPRITES.as:182)", () => {
    const teratorn = sheet("C14");
    const rows = Array.from({ length: 10 }, (_, tick) => frameRow(teratorn, "walk", tick));
    expect(rows).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 0]);
    expect(frameRow(teratorn, "landed", 5)).toBe(0);
  });

  it("falls back when a sheet lacks the animation", () => {
    // Fomor attacks with its walk cycle (SPRITES.as:248-264).
    expect(frameRow(sheet("G3_1"), "attack", 8)).toBe(frameRow(sheet("G3_1"), "walk", 8));
    // A Korath below level 5 cannot stomp and keeps walking.
    expect(frameRow(sheet("G4_1"), "stomp", 16)).toBe(frameRow(sheet("G4_1"), "walk", 16));
    // Rezghul idles on row 1 and moves on rows 1-5 (SPRITES.as:192-204).
    expect(frameRow(sheet("C19"), "idle", 40)).toBe(1);
    expect(frameRow(sheet("C19"), "walk", 40)).toBe(1);
    expect(frameRow(sheet("C19"), "walk", 8)).toBe(2);
    // Brain's invisible row (SPRITES.as:142-153).
    expect(frameRow(sheet("C9"), "invisible", 0)).toBe(1);
    expect(frameRow(sheet("C9"), "walk", 0)).toBe(0);
  });

  it("never runs off the sheet", () => {
    for (const one of Object.values(MONSTER_SPRITES)) {
      for (const animation of ["idle", "walk", "attack", "stomp"] as const) {
        for (let tick = 0; tick < 8 * 32; tick += 5) {
          const row = frameRow(one, animation, tick);
          expect(row, `${one.key}.${animation}@${tick}`).toBeGreaterThanOrEqual(0);
          expect(row, `${one.key}.${animation}@${tick}`).toBeLessThan(one.rows);
        }
      }
    }
  });

  it("treats a negative tick as 0", () => {
    expect(cycleRow({ first: 1, count: 7, ticksPerFrame: 8 }, -5)).toBe(1);
  });
});

describe("spriteFor", () => {
  it("returns a creep's own sheet", () => {
    expect(spriteFor("C1")?.key).toBe("C1");
    expect(spriteFor("IC8", 4)?.key).toBe("IC8");
    expect(spriteFor("C200")?.key).toBe("C200");
  });

  it("picks a champion's sheet by level, clamped to the sheets it has (ChampionBase.as:229)", () => {
    expect(spriteFor("G1", 1)?.key).toBe("G1_1");
    expect(spriteFor("G1")?.key).toBe("G1_1");
    expect(spriteFor("G1", 4)?.key).toBe("G1_4");
    expect(spriteFor("G1", 9)?.key).toBe("G1_6");
    expect(spriteFor("G5", 0)?.key).toBe("G5_1");
    expect(spriteFor("G5", 5)?.key).toBe("G5_3");
    expect(spriteFor("G3", 2.9)?.key).toBe("G3_2");
  });

  it("gives Krallen look 1 at levels 1-2, look 2 at 3-4 and look 3 at 5 (owner, 2026-10-25)", () => {
    expect([1, 2, 3, 4, 5].map(krallenLook)).toEqual([1, 1, 2, 2, 3]);
    expect([1, 2, 3, 4, 5].map((level) => spriteFor("G5", level)?.key)).toEqual([
      "G5_1",
      "G5_1",
      "G5_2",
      "G5_2",
      "G5_3",
    ]);
  });

  it("draws a flung Krallen in battle by her level, whatever her power level", () => {
    const yard = buildEngineYard({
      buildingdata: { "1": { id: 1, t: 1, X: 100, Y: 100 } },
      buildinghealthdata: {},
      resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    });
    const looks = [1, 2, 3, 4, 5].map((l) => {
      const battle = createBattle(yard, { seed: 7 });
      battle.apply({ kind: "fling", t: 0, x: -300, y: 0, r: 100, monsters: {}, champion: { t: 5, l, pl: 2 } });
      battle.step();
      const krallen = battle.creeps().find((creep) => creep.monsterId === "G5");
      return krallen && spriteFor(krallen.monsterId, krallen.level)?.key;
    });
    expect(looks).toEqual(["G5_1", "G5_1", "G5_2", "G5_2", "G5_3"]);
  });

  it("draws every Krallen look from its repaint, look 3 at level 5 included", () => {
    const urls = [1, 3, 5].map((level) => {
      const one = spriteFor("G5", level);
      return one && sheetUrl(one);
    });
    expect(urls).toEqual([
      "/assets/monsters/krallen_1_rev_65-repaint@4x.png",
      "/assets/monsters/krallen_2_rev_65-repaint@4x.png",
      "/assets/monsters/krallen_3_rev_65-repaint@4x.png",
    ]);
  });

  it("draws the level 4-6 Gorgo, Drull and Fomor from their repaints", () => {
    const repainted: Array<[string, number, string]> = [["G1", 4, "ape_4"]];
    for (const [id, level, name] of repainted) {
      const one = spriteFor(id, level);
      expect(one && sheetUrl(one)).toBe(`/assets/monsters/${name}-repaint@4x.png`);
    }
  });

  it("is undefined for an unknown id", () => {
    expect(spriteFor("C99")).toBeUndefined();
    expect(spriteFor("G9", 1)).toBeUndefined();
    expect(spriteFor("")).toBeUndefined();
  });
});

describe("placement", () => {
  it("puts the cell's top-left at the ground point minus the anchor", () => {
    expect(anchorOffset(sheet("C2"))).toEqual({ x: -19, y: -15 });
    expect(anchorOffset(sheet("G1_1"))).toEqual({ x: -48, y: -38 });
  });

  it("puts a creep's shadow at (-10, 10) and Zafreeti's at (-19, 4) (CreepBase.as:123-124)", () => {
    expect(shadowOffset(sheet("C14"))).toEqual({ x: -10, y: 10 });
    expect(shadowOffset(sheet("IC5"))).toEqual({ x: -10, y: 10 });
    expect(shadowOffset(sheet("C15"))).toEqual({ x: -19, y: 4 });
  });

  it("puts a flying champion's shadow ten pixels higher (ChampionBase.as:235-236)", () => {
    expect(shadowOffset(sheet("G3_3"))).toEqual({ x: -19, y: -6 });
    expect(shadowOffset(sheet("G3_1"))).toBeNull();
    expect(shadowOffset(sheet("C2"))).toBeNull();
  });

  it("cuts cell (column, row) at column * width, row * height (SPRITES.as:379-380)", () => {
    expect(frameRect(sheet("C2"), 3, 0)).toEqual({ x: 117, y: 0, width: 39, height: 28 });
    expect(frameRect(sheet("G1_1"), 15, 14)).toEqual({ x: 1440, y: 966, width: 96, height: 69 });
    expect(frameRect(sheet("IC2"), 5, 0).x).toBeCloseTo(322, 6);
  });

  it("bobs a flyer twenty pixels peak to peak about its altitude (CreepBase.as:262-264)", () => {
    expect(hoverOffset(0, 108)).toBe(-108);
    expect(hoverOffset(25 * Math.PI, 108)).toBeCloseTo(-98, 6);
    expect(hoverOffset(75 * Math.PI, 108)).toBeCloseTo(-118, 6);
    expect(hoverOffset(0)).toBe(-108);
  });

  it("flies Teratorn, Zafreeti and Vorg at 144 and Balthazar at 108, the owner's heights (#211)", () => {
    expect(flyerAltitude("C14")).toBe(144);
    expect(flyerAltitude("IC5")).toBe(108);
    expect(flyerAltitude("C15")).toBe(144);
    expect(flyerAltitude("C16")).toBe(144);
    expect(flyerAltitude("G3")).toBe(108);
    // A flying champion's height is its own, not the creeps' table.
    expect(championFlightTop(0)).toBe(-144);
  });

  it("flies a champion's cell at a fixed -144 with twice the sine on it (ChampionBase.as:1317-1322, #206)", () => {
    expect(championFlightTop(0)).toBe(-144);
    expect(championFlightTop(25 * Math.PI)).toBeCloseTo(-134, 6);
    expect(championFlightTop(75 * Math.PI)).toBeCloseTo(-154, 6);
  });
});

describe("sheetUrl", () => {
  it("serves from /assets/ like the building art", () => {
    expect(sheetUrl(sheet("IC1"))).toBe("/assets/monsters/spurtz.png");
    expect(sheetUrl("monsters/flyingshadow.png")).toBe("/assets/monsters/flyingshadow.png");
  });

  it("serves a repainted sheet in place of the original", () => {
    for (const one of Object.values(MONSTER_SPRITES)) {
      const repaint = REPAINTED_SHEETS[one.file];
      expect(sheetUrl(one)).toBe(`/assets/${repaint ?? one.file}`);
    }
    expect(isHighResolutionSheet("/assets/monsters/14-repaint@4x.png")).toBe(true);
    expect(isHighResolutionSheet(sheetUrl(sheet("C1")))).toBe(true);
    expect(isHighResolutionSheet(sheetUrl(sheet("IC1")))).toBe(false);
  });
});
