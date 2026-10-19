import { Texture, type Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { MONSTER_PROPS } from "@/game/combat/rules/combatStatsData";
import type { Point } from "@/game/yard/YardGrid";
import {
  BURST_TICKS,
  BUILDING_NUMBER_LIFT,
  CreepFx,
  HEAL_BURST_TICKS,
  HEALER_STYLES,
  FLASH_COOLDOWN_TICKS,
  FLASH_TICKS,
  JUMP_PX_PER_TICK,
  LABEL_DIGIT_SHIFT,
  LABEL_MAX,
  LABEL_PER_TARGET,
  LABEL_RISE,
  mouthPoint,
  LABEL_TICKS,
  LABEL_WINDOW_TICKS,
  LUNGE_PX,
  LUNGE_TICKS,
  PROJECTILE_TICKS,
  ROCKET_DIRECTIONS,
  ROCKET_SPREAD,
  SMOKE_TICKS,
  burstTicks,
  drawsProjectile,
  flightPoint,
  jumpTicks,
  labelPose,
  labelShift,
  lungeOffset,
  projectileStyle,
  rocketPair,
  type CreepFxHost,
  type ProjectileStyle,
} from "./creepFx";

/**
 * The creep-side effects of issues #63 and #68 without a renderer: the lunge
 * and flight arithmetic, and the effects object driven by hand — projectiles
 * that land, flash and number their building, smoke that pools, damage
 * numbers that follow their creep, cap per target and overall, show healing
 * green, expire and recycle.
 */

describe("arithmetic", () => {
  it("lunges out and back, peaking halfway and resting outside the window", () => {
    expect(lungeOffset(-1)).toBe(0);
    expect(lungeOffset(0)).toBe(0);
    expect(lungeOffset(LUNGE_TICKS / 2)).toBeCloseTo(LUNGE_PX);
    expect(lungeOffset(LUNGE_TICKS)).toBe(0);
    expect(lungeOffset(LUNGE_TICKS + 5)).toBe(0);
    expect(lungeOffset(1)).toBeGreaterThan(0);
    expect(lungeOffset(1)).toBeLessThan(LUNGE_PX);
  });

  it("flies from the body to the target with an arc that lifts the middle", () => {
    const from: Point = { x: 0, y: 100 };
    const to: Point = { x: 100, y: 100 };
    expect(flightPoint(from, to, 0)).toEqual({ x: 0, y: 100 });
    expect(flightPoint(from, to, PROJECTILE_TICKS).x).toBe(100);
    expect(flightPoint(from, to, PROJECTILE_TICKS).y).toBeCloseTo(100);
    const middle = flightPoint(from, to, PROJECTILE_TICKS / 2);
    expect(middle.x).toBe(50);
    expect(middle.y).toBeLessThan(100);
    // Never overshoots.
    expect(flightPoint(from, to, PROJECTILE_TICKS * 2)).toEqual(flightPoint(from, to, PROJECTILE_TICKS));
  });

  it("rises a number 25 px with a cubic ease and fades only at the very end", () => {
    expect(labelPose(0)).toEqual({ rise: 0, alpha: 1 });
    const early = labelPose(LABEL_TICKS / 4);
    const half = labelPose(LABEL_TICKS / 2);
    const late = labelPose((LABEL_TICKS * 3) / 4);
    // Ease-in-out: slow start, half the rise at half time, slow finish.
    expect(early.rise).toBeLessThan(LABEL_RISE / 4);
    expect(half.rise).toBeCloseTo(LABEL_RISE / 2);
    expect(late.rise).toBeGreaterThan((LABEL_RISE * 3) / 4);
    expect(late.alpha).toBe(1);
    expect(labelPose(LABEL_TICKS).rise).toBe(LABEL_RISE);
    expect(labelPose(LABEL_TICKS).alpha).toBe(0);
  });

  it("shifts a target's second number right and third left, ten px a digit", () => {
    expect(labelShift(0, 3)).toBe(0);
    expect(labelShift(1, 2)).toBe(2 * LABEL_DIGIT_SHIFT);
    expect(labelShift(2, 3)).toBe(-3 * LABEL_DIGIT_SHIFT);
  });

  it("draws a projectile for a ranged swing unless the monster stomps", () => {
    expect(drawsProjectile("G3", true)).toBe(true);
    expect(drawsProjectile("C14", true)).toBe(true);
    expect(drawsProjectile("C1", false)).toBe(false);
    // Gorgo's reach of 35 is a stomp, not a shot.
    expect(drawsProjectile("G1", true)).toBe(false);
    expect(drawsProjectile("G4", true)).toBe(false);
  });
});

/* ── The effects object ─────────────────────────────────────────────────── */

interface Host extends CreepFxHost {
  anchors: Map<number, { ground: Point; top: number }>;
  flashes: Array<{ id: number; on: boolean }>;
  zoomLevel: number;
}

const hostOf = (): Host => {
  const anchors = new Map<number, { ground: Point; top: number }>();
  const flashes: Array<{ id: number; on: boolean }> = [];
  const host: Host = {
    anchors,
    flashes,
    zoomLevel: 1,
    creepAnchor: (id) => anchors.get(id) ?? null,
    flashBuilding: (id, on) => flashes.push({ id, on }),
    zoom: () => host.zoomLevel,
  };
  return host;
};

const AT: Point = { x: 100, y: 164 };

describe("CreepFx", () => {
  it("lands a projectile after its flight, flashes and numbers the building, then puts it back", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.projectile(10, { x: 0, y: 0 }, { x: 80, y: 40 }, 7, true, 120);
    expect(fx.projectileCount).toBe(1);
    fx.update(11);
    expect(host.flashes).toEqual([]);
    expect(fx.labelCount).toBe(0);
    fx.update(10 + PROJECTILE_TICKS);
    expect(host.flashes).toEqual([{ id: 7, on: true }]);
    expect(fx.flashing).toEqual([7]);
    expect(fx.labelsFor("building:7")).toEqual([
      { amount: -120, x: 80, y: 40 - BUILDING_NUMBER_LIFT },
    ]);
    fx.update(10 + PROJECTILE_TICKS + FLASH_TICKS);
    expect(host.flashes).toEqual([
      { id: 7, on: true },
      { id: 7, on: false },
    ]);
    // The burst lingers a little past the landing, then the projectile is gone.
    expect(fx.projectileCount).toBe(1);
    fx.update(10 + PROJECTILE_TICKS + BURST_TICKS + 1);
    expect(fx.projectileCount).toBe(0);
    fx.destroy();
  });

  it("tells the host once, on landing, how much a projectile took off its building (#77)", () => {
    const landings: Array<{ id: number; amount: number }> = [];
    const host: CreepFxHost = {
      ...hostOf(),
      landed: (id, amount) => landings.push({ id, amount }),
    };
    const fx = new CreepFx(host);
    fx.projectile(10, { x: 0, y: 0 }, { x: 80, y: 40 }, 7, false, 45);
    // A swing at a creep, or one that took nothing, carries nothing to a building.
    fx.projectile(10, { x: 0, y: 0 }, { x: 80, y: 40 }, -1, false, 30);
    fx.projectile(10, { x: 0, y: 0 }, { x: 80, y: 40 }, 8, false, 0);
    fx.update(10 + PROJECTILE_TICKS - 1);
    expect(landings).toEqual([]);
    fx.update(10 + PROJECTILE_TICKS);
    expect(landings).toEqual([{ id: 7, amount: 45 }]);
    fx.update(10 + PROJECTILE_TICKS + 2);
    expect(landings).toHaveLength(1);
    fx.destroy();
  });

  it("times a fireball's jump at Flash's 6 px a tick, never under 4 ticks (#352)", () => {
    expect(JUMP_PX_PER_TICK).toBe(6);
    expect(jumpTicks({ x: 0, y: 0 }, { x: 60, y: 0 })).toBe(10);
    expect(jumpTicks({ x: 0, y: 0 }, { x: 60, y: 80 })).toBe(17);
    expect(jumpTicks({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(4);
    // A longer flight still starts and ends on its two buildings.
    const start = flightPoint({ x: 0, y: 0 }, { x: 60, y: 0 }, 0, 10);
    const end = flightPoint({ x: 0, y: 0 }, { x: 60, y: 0 }, 10, 10);
    expect([start.x, start.y, end.x, end.y].map((n) => Math.round(n) + 0)).toEqual([0, 0, 60, 0]);
    // Halfway through a 10-tick jump is halfway across, not done as a 16-tick shot would be.
    expect(flightPoint({ x: 0, y: 0 }, { x: 60, y: 0 }, 5, 10).x).toBeCloseTo(30, 6);
  });

  it("holds a jump thrown later until its tick, then flies it for its own flight (#352)", () => {
    const landings: Array<{ id: number; amount: number }> = [];
    const host: CreepFxHost = {
      ...hostOf(),
      landed: (id, amount) => landings.push({ id, amount }),
    };
    const fx = new CreepFx(host);
    // Thrown at 30, ten ticks in the air.
    fx.projectile(30, { x: 0, y: 0 }, { x: 60, y: 0 }, 4, false, 25, 10);
    fx.update(12);
    expect(fx.projectileCount).toBe(1);
    expect(landings).toEqual([]);
    fx.update(39);
    expect(landings).toEqual([]);
    fx.update(40);
    expect(landings).toEqual([{ id: 4, amount: 25 }]);
    expect(fx.labelsFor("building:4")).toEqual([
      { amount: -25, x: 60, y: -BUILDING_NUMBER_LIFT },
    ]);
    fx.update(40 + BURST_TICKS + 1);
    expect(fx.projectileCount).toBe(0);
    fx.destroy();
  });

  it("still lands a shot when one frame jumps past its burst", () => {
    const landings: Array<{ id: number; amount: number }> = [];
    const host: CreepFxHost = {
      ...hostOf(),
      landed: (id, amount) => landings.push({ id, amount }),
    };
    const fx = new CreepFx(host);
    fx.projectile(10, { x: 0, y: 0 }, { x: 80, y: 40 }, 7, false, 45);
    fx.update(10 + PROJECTILE_TICKS + BURST_TICKS + 50);
    expect(landings).toEqual([{ id: 7, amount: 45 }]);
    expect(fx.projectileCount).toBe(0);
    fx.destroy();
  });

  it("does not strobe a building hit by a mob: one flash per cooldown", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.flash(3, 100);
    fx.flash(3, 101);
    fx.flash(3, 102);
    expect(host.flashes.filter((flash) => flash.on)).toHaveLength(1);
    fx.update(100 + FLASH_TICKS);
    expect(host.flashes.at(-1)).toEqual({ id: 3, on: false });
    fx.flash(3, 100 + FLASH_COOLDOWN_TICKS - 1);
    expect(host.flashes.filter((flash) => flash.on)).toHaveLength(1);
    fx.flash(3, 100 + FLASH_COOLDOWN_TICKS);
    expect(host.flashes.filter((flash) => flash.on)).toHaveLength(2);
    // Nothing for a swing at a creep rather than a building.
    fx.flash(-1, 500);
    expect(host.flashes.filter((flash) => flash.on)).toHaveLength(2);
    fx.destroy();
  });

  it("puffs smoke that fades out and is pooled for the next poof", () => {
    const fx = new CreepFx(hostOf());
    fx.poof(0, { x: 100, y: 100 }, false);
    expect(fx.puffCount).toBe(4);
    fx.update(SMOKE_TICKS + 1);
    expect(fx.puffCount).toBe(0);
    fx.poof(SMOKE_TICKS + 1, { x: 100, y: 100 }, true);
    expect(fx.puffCount).toBe(8);
    // A destroyed building goes on streaming puffs for a while.
    fx.update(SMOKE_TICKS + 1 + 20);
    expect(fx.puffCount).toBeGreaterThan(8);
    fx.update(SMOKE_TICKS * 4);
    expect(fx.puffCount).toBe(0);
    fx.destroy();
  });

  it("shows a wound as a red number bound to the creep, following it as it moves", () => {
    const host = hostOf();
    host.anchors.set(5, { ground: { x: 100, y: 200 }, top: 170 });
    const fx = new CreepFx(host);
    fx.number(10, "creep:5", 5, 20, AT, "damage");
    expect(fx.labelCount).toBe(1);
    fx.update(10);
    expect(fx.labelsFor("creep:5")).toEqual([{ amount: -20, x: 100, y: 164 }]);
    host.anchors.set(5, { ground: { x: 130, y: 200 }, top: 170 });
    fx.update(10 + LABEL_TICKS / 2);
    const [later] = fx.labelsFor("creep:5");
    expect(later?.x).toBe(130);
    // Half the rise, on a whole pixel.
    expect(Math.abs((later?.y ?? 0) - (164 - LABEL_RISE / 2))).toBeLessThanOrEqual(0.5);
    fx.destroy();
  });

  it("shows healing as a green plus and rounds fractional amounts", () => {
    const fx = new CreepFx(hostOf());
    fx.number(0, "creep:2", 2, 33.4, AT, "heal");
    fx.update(0);
    expect(fx.labelsFor("creep:2")).toEqual([{ amount: 33, x: 100, y: 164 }]);
    fx.destroy();
  });

  it("shows at most three numbers per target in the window, shifted sideways", () => {
    const fx = new CreepFx(hostOf());
    fx.number(0, "creep:1", 1, 20, AT, "damage");
    fx.number(1, "creep:1", 1, 20, AT, "damage");
    fx.number(2, "creep:1", 1, 20, AT, "damage");
    fx.number(3, "creep:1", 1, 20, AT, "damage");
    fx.update(3);
    const shown = fx.labelsFor("creep:1");
    expect(shown).toHaveLength(LABEL_PER_TARGET);
    expect(shown.map((label) => label.x - AT.x)).toEqual([
      0,
      2 * LABEL_DIGIT_SHIFT,
      -2 * LABEL_DIGIT_SHIFT,
    ]);
    // Another target is not held back by this one.
    fx.number(3, "creep:9", 9, 5, AT, "damage");
    expect(fx.labelsFor("creep:9")).toHaveLength(1);
    // Once the window has passed the target may show numbers again.
    fx.number(LABEL_WINDOW_TICKS, "creep:1", 1, 7, AT, "damage");
    expect(fx.labelCount).toBe(5);
    fx.destroy();
  });

  it("recycles an expired number and shows no more than twenty at once", () => {
    const fx = new CreepFx(hostOf());
    fx.number(0, "creep:1", 1, 20, AT, "damage");
    fx.update(LABEL_TICKS + 1);
    expect(fx.labelCount).toBe(0);
    expect(fx.pooledLabelCount).toBe(1);
    expect(fx.labelsFor("creep:1")).toEqual([]);
    fx.number(LABEL_TICKS + 1, "creep:2", 2, 30, AT, "damage");
    expect(fx.pooledLabelCount).toBe(0);
    expect(fx.labelCount).toBe(1);

    // Six hundred creeps hit in the same tick make at most LABEL_MAX numbers;
    // the ones that do not fit are simply not shown, as Flash dropped them.
    for (let creep = 100; creep < 700; creep += 1) {
      fx.number(LABEL_TICKS + 2, `creep:${creep}`, creep, 10, AT, "damage");
    }
    expect(fx.labelCount).toBe(LABEL_MAX);
    fx.update(LABEL_TICKS + 2);
    expect(fx.labelsFor("creep:2")).toHaveLength(1);
    expect(fx.labelsFor("creep:699")).toEqual([]);
    fx.destroy();
  });

  it("keeps a number the same size on screen whatever the zoom", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.number(0, "building:1", -1, 60, AT, "damage");
    host.zoomLevel = 2;
    fx.update(0);
    // Fire, rockets, smoke, then the numbers.
    const text = fx.root.children[3]?.children[0] as { scale: { x: number } } | undefined;
    expect(text?.scale.x).toBeCloseTo(0.5);
    fx.destroy();
  });

  it("puts nothing in motion under reduced motion, but still shows the number", () => {
    const host = hostOf();
    host.anchors.set(1, { ground: { x: 50, y: 50 }, top: 30 });
    const fx = new CreepFx(host, true);
    fx.number(0, "creep:1", 1, 15, { x: 50, y: 24 }, "damage");
    fx.update(LABEL_TICKS / 2);
    expect(fx.labelsFor("creep:1")[0]?.y).toBe(24);
    fx.poof(0, { x: 0, y: 0 }, true);
    fx.update(20);
    // No stream under reduced motion: only the poof itself.
    expect(fx.puffCount).toBe(8);
    fx.destroy();
  });

  it("switches every flash off and leaves the overlay when destroyed", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.flash(4, 0);
    fx.destroy();
    expect(host.flashes.at(-1)).toEqual({ id: 4, on: false });
    expect(fx.root.parent).toBeNull();
  });
});

describe("mouthPoint", () => {
  const cell = { x: 100, y: -144, width: 100, height: 80 };

  it("sits low on the cell, not at the top where the old start was", () => {
    const mouth = mouthPoint(cell, { x: 100, y: 200 });
    expect(mouth.y).toBeGreaterThan(cell.y + cell.height / 2);
    expect(mouth.y).toBeLessThan(cell.y + cell.height);
  });

  it("leans toward the side the target is on", () => {
    const right = mouthPoint(cell, { x: 600, y: -50 });
    const left = mouthPoint(cell, { x: -400, y: -50 });
    expect(right.x).toBeGreaterThan(150);
    expect(left.x).toBeLessThan(150);
    expect(right.x - 150).toBeCloseTo(30, 0);
  });

  it("stays in the cell's middle when the target is straight on", () => {
    const mouth = mouthPoint(cell, { x: 150, y: -144 + 80 * 0.62 });
    expect(mouth).toEqual({ x: 150, y: -144 + 80 * 0.62 });
  });
});

/* ── Whose shot looks like what ─────────────────────────────────────────── */

/** The colours the shots' graphics fill and stroke with this frame. */
const coloursDrawn = (fx: CreepFx): Set<number> => {
  const fire = fx.root.children[0] as Graphics;
  const colours = new Set<number>();
  for (const instruction of fire.context.instructions) {
    const style = (instruction.data as { style?: { color?: number } }).style;
    if (style?.color !== undefined) colours.add(style.color);
  }
  return colours;
};

const STYLES: readonly ProjectileStyle[] = ["fireball", "rocket", "fomor", "zafreeti", "vorg"];

describe("projectile styles", () => {
  it("gives D.A.V.E., Fomor, Zafreeti and Vorg their own, and everyone else the fireball", () => {
    expect(projectileStyle("C12")).toBe("rocket");
    expect(projectileStyle("G3")).toBe("fomor");
    expect(projectileStyle("C15")).toBe("zafreeti");
    expect(projectileStyle("C16")).toBe("vorg");
    for (const id of ["C14", "C19", "IC7", "C1", ""]) expect(projectileStyle(id)).toBe("fireball");
  });

  it("puts every monster that heals, and only those, in the healer family", () => {
    const healers = Object.entries(MONSTER_PROPS)
      .filter(([, stat]) => (stat.props.damage ?? []).some((damage) => damage < 0))
      .map(([id]) => id)
      .sort();
    expect(healers).toEqual(["C15", "C16"]);
    for (const id of Object.keys(MONSTER_PROPS)) {
      expect(HEALER_STYLES.has(projectileStyle(id))).toBe(healers.includes(id));
    }
    expect([...HEALER_STYLES].sort()).toEqual(["vorg", "zafreeti"]);
  });

  it("lands every style on the same tick with the same flash and number as the fireball", () => {
    for (const style of STYLES) {
      const host = hostOf();
      const landed: Array<[number, number]> = [];
      host.landed = (id, amount) => landed.push([id, amount]);
      const fx = new CreepFx(host);
      fx.projectile(10, { x: 0, y: 0 }, { x: 80, y: 40 }, 7, false, 120, PROJECTILE_TICKS, style);
      fx.update(10 + PROJECTILE_TICKS - 1);
      expect(host.flashes, style).toEqual([]);
      expect(landed, style).toEqual([]);
      fx.update(10 + PROJECTILE_TICKS);
      expect(host.flashes, style).toEqual([{ id: 7, on: true }]);
      // One loss of the whole swing, even from D.A.V.E.'s pair of rockets.
      expect(landed, style).toEqual([[7, 120]]);
      expect(fx.labelsFor("building:7").map((label) => label.amount), style).toEqual([-120]);
      // Every shot is gone once its landing has been shown.
      fx.update(10 + PROJECTILE_TICKS + burstTicks(style) + 1);
      expect(fx.projectileCount, style).toBe(0);
      fx.destroy();
    }
  });

  it("shows a heal's landing longer than a fireball's", () => {
    expect(burstTicks("zafreeti")).toBe(HEAL_BURST_TICKS);
    expect(burstTicks("vorg")).toBe(HEAL_BURST_TICKS);
    expect(burstTicks("fireball")).toBe(BURST_TICKS);
    expect(burstTicks("fomor")).toBe(BURST_TICKS);
    expect(HEAL_BURST_TICKS).toBeGreaterThan(BURST_TICKS);
  });

  it("fires D.A.V.E.'s rockets as a pair, either side of the line, closing on the target", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const [left, right] = rocketPair(from, to);
    expect(left!.from.y).toBeCloseTo(ROCKET_SPREAD);
    expect(right!.from.y).toBeCloseTo(-ROCKET_SPREAD);
    expect(Math.hypot(left!.to.x - to.x, left!.to.y - to.y)).toBeLessThanOrEqual(3);
    expect(Math.hypot(right!.to.x - to.x, right!.to.y - to.y)).toBeLessThanOrEqual(3);

    const fx = new CreepFx(hostOf());
    fx.projectile(0, from, to, 3, false, 90, PROJECTILE_TICKS, "rocket");
    expect(fx.shots.map((shot) => [shot.style, shot.amount])).toEqual([
      ["rocket", 90],
      ["rocket", 0],
    ]);
    // Straight, no arc: a rocket halfway is on the line between its ends.
    const half = flightPoint(left!.from, left!.to, PROJECTILE_TICKS / 2, PROJECTILE_TICKS, 0);
    expect(half.y).toBeCloseTo((left!.from.y + left!.to.y) / 2);
    fx.destroy();
  });

  it("draws a rocket from the sheet once it is in, and by hand before", () => {
    const columns: number[] = [];
    const host = hostOf();
    let ready = false;
    host.rocketCell = (column) => {
      columns.push(column);
      return ready ? Texture.WHITE : null;
    };
    const fx = new CreepFx(host);
    fx.projectile(0, { x: 0, y: 0 }, { x: 0, y: 100 }, 3, false, 90, PROJECTILE_TICKS, "rocket");
    fx.update(4);
    const rockets = fx.root.children[1]!;
    expect(rockets.children.filter((child) => child.visible)).toHaveLength(0);
    // Straight down is a quarter turn clockwise from east: column 8 of 32.
    expect(columns).toEqual([ROCKET_DIRECTIONS / 4, ROCKET_DIRECTIONS / 4]);
    ready = true;
    fx.update(5);
    expect(rockets.children.filter((child) => child.visible)).toHaveLength(2);
    // Gone once they land.
    fx.update(PROJECTILE_TICKS + 1);
    expect(rockets.children.filter((child) => child.visible)).toHaveLength(0);
    fx.destroy();
  });

  it("draws each style in colours of its own, the healers sharing the white plus", () => {
    const inFlight = new Map<ProjectileStyle, Set<number>>();
    const landing = new Map<ProjectileStyle, Set<number>>();
    for (const style of STYLES) {
      const fx = new CreepFx(hostOf());
      fx.projectile(0, { x: 0, y: 0 }, { x: 120, y: 60 }, -1, false, 0, PROJECTILE_TICKS, style);
      fx.update(6);
      inFlight.set(style, coloursDrawn(fx));
      fx.update(PROJECTILE_TICKS + 2);
      landing.set(style, coloursDrawn(fx));
      fx.destroy();
    }
    // No two styles fly in the same colours.
    const seen = new Set<string>();
    for (const style of STYLES) {
      const key = [...inFlight.get(style)!].sort().join(",");
      expect(seen.has(key), style).toBe(false);
      seen.add(key);
    }
    // The healers land with a white plus; the damage shots do not.
    for (const style of STYLES) {
      expect(landing.get(style)!.has(0xffffff), style).toBe(HEALER_STYLES.has(style));
    }
  });

  it("drops the trails but keeps each style's shape under reduced motion", () => {
    const count = (fx: CreepFx) => (fx.root.children[0] as Graphics).context.instructions.length;
    for (const style of STYLES) {
      const calm = new CreepFx(hostOf(), true);
      const busy = new CreepFx(hostOf(), false);
      for (const fx of [calm, busy]) {
        fx.projectile(0, { x: 0, y: 0 }, { x: 120, y: 60 }, -1, false, 0, PROJECTILE_TICKS, style);
        fx.update(8);
      }
      expect(count(calm), style).toBeGreaterThan(0);
      expect(count(calm), style).toBeLessThan(count(busy));
      calm.destroy();
      busy.destroy();
    }
  });
});
