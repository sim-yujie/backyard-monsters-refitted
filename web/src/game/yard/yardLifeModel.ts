import type { BaseLoadResponse } from "@/api/types";
import { BEHAVIOUR_SPEED, monsterMovement, monsterTickSpeed } from "@/game/combat/rules";
import { academyLevel } from "@/game/monsters/housing";
import type { Yard, YardBuilding } from "./yardModel";

/**
 * What lives on the player's own yard besides its buildings (issue #158): the
 * housed monsters wandering their pens. Arithmetic only, so it runs under
 * node; `YardLifeLayer` draws it.
 *
 * Everything here is drawn and nothing is saved. The Flash client simulated
 * all of it as real creatures; this client has no creature to simulate on its
 * own yard, so it keeps the look and none of the state.
 *
 * ## Housed monsters (`client/scripts/HOUSING.as:201-240`)
 *
 * `HOUSING.Populate`, run on every base load (`BASE.as:2043-2044`), spawns
 * every housed monster at a random Housing building with health above zero,
 * at `PointInHouse`: a random spot 40 to 120 yard units in from the pen's top
 * corner on both axes (`HOUSING.as:237-240`), in behaviour `pen`. A penned
 * creep stands for its first 240 ticks, then on each tick has a 1 in 200 chance
 * of picking a fresh `PointInHouse` and walking to it
 * (`creeps/CreepBase.as:1373-1380`), at a quarter of its creature speed: half
 * for every creep and half again for `pen` (`CreepBase.as:1455-1458`). It is
 * "there" once within 5 (`CreepBase.as:1696-1703`). A flyer does not hover in
 * its pen (`CreepBase.as:260`), so it stands on the ground over its shadow.
 *
 * Flash drew every one. A big army is thousands, so this draws a sample:
 * {@link sampleArmy} keeps every type present and shares at most
 * {@link MAX_HOUSED_DRAWN} places between the types in proportion to their
 * counts, and the sample is dealt round the pens in turn.
 */

/* ── Clocks ─────────────────────────────────────────────────────────────── */

/**
 * The creature tick: `CREATURES.Tick` and the champions run in the fast loop,
 * 80 a second (`client/scripts/GLOBAL.as:1234-1274`), which is also the tick
 * the attack screen's animation rows count in.
 */
export const CREATURE_TICK_HZ = 80;

/**
 * The most ticks one frame may advance, so a tab that was hidden for a minute
 * does not spend its first frame back walking everybody a minute's worth.
 */
export const MAX_TICKS_PER_FRAME = 20;

/* ── Sizes ──────────────────────────────────────────────────────────────── */

/** The most housed monsters drawn at once across the whole yard. */
export const MAX_HOUSED_DRAWN = 150;

/** Housing's type id and its pen (`HOUSING.as:237-240`). */
export const HOUSING_TYPE = 15;
const PEN = { inset: 40, size: 80 } as const;

/** Ticks a penned creature stands before it may first move (`CreepBase.as:1377`). */
export const PEN_SETTLE_TICKS = 240;

/** One chance in this many, each tick, of a penned creature picking a new spot. */
export const CREEP_WANDER_ODDS = 200;

/** Yard units from its target at which a walker counts as there (`CreepBase.as:1698`). */
const ARRIVED = 5;

/* ── What the save says ─────────────────────────────────────────────────── */

export interface LifeArea {
  /** Yard units: the top corner of the rectangle. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One housed monster type and how many there are. */
export interface LifeGroup {
  readonly id: string;
  /** Academy level: picks nothing on the sheet, only the walking speed. */
  readonly level: number;
  readonly count: number;
}

/** One Housing building a monster may wander in. */
export interface LifePen {
  readonly id: number;
  /** Yard units of the building's top corner. */
  readonly x: number;
  readonly y: number;
}

/** Everything alive on a yard, as read from its save. */
export interface YardLife {
  readonly groups: readonly LifeGroup[];
  readonly pens: readonly LifePen[];
}

/** Nothing alive at all. */
export const EMPTY_LIFE: YardLife = {
  groups: [],
  pens: [],
};

const standing = (building: YardBuilding): boolean => building.hp === null || building.hp > 0;

/**
 * What lives on the player's own yard, from its save and the yard read from it.
 *
 * Pens are the Housing buildings with health above zero, as `Populate` takes
 * them (`HOUSING.as:212-215`); one still being built counts, as it did there.
 */
export const yardLifeOf = (save: BaseLoadResponse, yard: Yard): YardLife => {
  const groups: LifeGroup[] = [];
  for (const [id, raw] of Object.entries(save.monsters?.housed ?? {})) {
    const count = Math.floor(Number(raw));
    if (!Number.isFinite(count) || count <= 0 || monsterMovement(id) === undefined) continue;
    groups.push({ id, level: academyLevel(save.academy, id), count });
  }

  const pens: LifePen[] = [];
  for (const building of yard.buildings) {
    if (building.type === HOUSING_TYPE && standing(building)) {
      pens.push({ id: building.id, x: building.x, y: building.y });
    }
  }
  pens.sort((a, b) => a.id - b.id);

  return {
    groups,
    pens,
  };
};

/* ── The sample ─────────────────────────────────────────────────────────── */

/** One monster to draw: its type and its academy level. */
export interface SampledMonster {
  readonly id: string;
  readonly level: number;
}

/**
 * The monsters to draw, at most `cap` of them.
 *
 * An army that fits is drawn whole. One that does not keeps one of every type,
 * most numerous first should there be more types than places, and shares the
 * places left in proportion to what each type has beyond that one, by largest
 * remainder so the total is exactly `cap`. The list comes back type by type in
 * the order given.
 */
export const sampleArmy = (
  groups: readonly LifeGroup[],
  cap = MAX_HOUSED_DRAWN,
): SampledMonster[] => {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const take = new Map<LifeGroup, number>();

  if (total <= cap) {
    for (const group of groups) take.set(group, group.count);
  } else {
    const byCount = [...groups].sort((a, b) => b.count - a.count);
    let left = cap;
    for (const group of byCount) {
      if (left === 0) break;
      take.set(group, 1);
      left--;
    }
    const extra = [...take.keys()];
    const beyond = extra.reduce((sum, group) => sum + group.count - 1, 0);
    if (left > 0 && beyond > 0) {
      const shares = extra.map((group) => {
        const exact = ((group.count - 1) * left) / beyond;
        return { group, whole: Math.floor(exact), rest: exact - Math.floor(exact) };
      });
      let given = 0;
      for (const share of shares) {
        take.set(share.group, (take.get(share.group) ?? 0) + share.whole);
        given += share.whole;
      }
      shares.sort((a, b) => b.rest - a.rest || b.group.count - a.group.count);
      for (const share of shares) {
        if (given >= left) break;
        take.set(share.group, (take.get(share.group) ?? 0) + 1);
        given++;
      }
    }
  }

  const drawn: SampledMonster[] = [];
  for (const group of groups) {
    const count = take.get(group) ?? 0;
    for (let i = 0; i < count; i++) drawn.push({ id: group.id, level: group.level });
  }
  return drawn;
};

/* ── Walkers: monsters in their pens ─────────────────────────────────────────── */

/** A creature pacing an area, in yard units and creature ticks. */
export interface Walker {
  /** Stable across redraws, so a creature keeps its place when the yard is re-read. */
  readonly key: string;
  readonly monsterId: string;
  /** The level its sheet is picked at. */
  readonly sheetLevel: number;
  readonly champion: boolean;
  area: LifeArea;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  moving: boolean;
  /** Screen-space heading, radians, y down: what the sheet column is read from. */
  heading: number;
  /** Ticks since it appeared: the animation clock and the settle wait. */
  age: number;
  /** Yard units a tick while walking. */
  speed: number;
  /** One chance in this many, a tick, of moving on. */
  odds: number;
}

export type Random = () => number;

/** A random spot inside an area. */
const pointIn = (area: LifeArea, random: Random): { x: number; y: number } => ({
  x: area.x + random() * area.width,
  y: area.y + random() * area.height,
});

/** Screen-space heading of a step in yard units: the isometric projection's angle. */
export const screenHeading = (dx: number, dy: number): number =>
  Math.atan2((dx + dy) / 2, dx - dy);

/** The wander rectangle of a Housing pen (`PointInHouse`). */
export const penArea = (pen: LifePen): LifeArea => ({
  x: pen.x + PEN.inset,
  y: pen.y + PEN.inset,
  width: PEN.size,
  height: PEN.size,
});

interface WalkerSpec {
  readonly key: string;
  readonly monsterId: string;
  readonly sheetLevel: number;
  readonly champion: boolean;
  readonly area: LifeArea;
  readonly speed: number;
  readonly odds: number;
}

const makeWalker = (spec: WalkerSpec, random: Random): Walker => {
  const at = pointIn(spec.area, random);
  return {
    ...spec,
    x: at.x,
    y: at.y,
    targetX: at.x,
    targetY: at.y,
    moving: false,
    // `Populate` hands each creep `Math.random() * 360` (`HOUSING.as:228`).
    heading: random() * Math.PI * 2,
    // A flyer's frame counter starts anywhere up to 1000 (`CreepBase.as:125`),
    // so the flock does not flap in step; everything else starts at 0.
    age: monsterMovement(spec.monsterId) === "fly" ? Math.floor(random() * 1000) : 0,
  };
};

/** The walkers a yard's pens hold, by key. */
export const walkerSpecs = (life: YardLife, cap = MAX_HOUSED_DRAWN): WalkerSpec[] => {
  const specs: WalkerSpec[] = [];

  if (life.pens.length > 0) {
    // The nth of a type in a pen keeps its key while the army around it changes.
    const seen = new Map<string, number>();
    sampleArmy(life.groups, cap).forEach((monster, index) => {
      const pen = life.pens[index % life.pens.length];
      if (!pen) return;
      const slot = `${pen.id}:${monster.id}`;
      const nth = seen.get(slot) ?? 0;
      seen.set(slot, nth + 1);
      specs.push({
        key: `m:${slot}:${nth}`,
        monsterId: monster.id,
        sheetLevel: 1,
        champion: false,
        area: penArea(pen),
        speed: monsterTickSpeed(monster.id, monster.level) * (BEHAVIOUR_SPEED["pen"] ?? 1),
        odds: CREEP_WANDER_ODDS,
      });
    });
  }

  return specs;
};

/**
 * Brings a set of walkers in line with a yard: keeps every walker whose key is
 * still wanted where it stands, makes the new ones, drops the rest.
 *
 * A kept walker takes the new spec's area, so a pen that moved has its
 * creatures walk over to it rather than blink there.
 */
export const reconcileWalkers = (
  current: ReadonlyMap<string, Walker>,
  specs: readonly WalkerSpec[],
  random: Random,
): Map<string, Walker> => {
  const next = new Map<string, Walker>();
  for (const spec of specs) {
    const kept = current.get(spec.key);
    if (kept) {
      if (!kept.champion) kept.area = spec.area;
      kept.speed = spec.speed;
      if (!inside(kept.area, kept.targetX, kept.targetY)) {
        const at = pointIn(kept.area, random);
        kept.targetX = at.x;
        kept.targetY = at.y;
        kept.moving = true;
      }
      next.set(spec.key, kept);
    } else {
      next.set(spec.key, makeWalker(spec, random));
    }
  }
  return next;
};

const inside = (area: LifeArea, x: number, y: number): boolean =>
  x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;

/**
 * One creature tick for a walker: maybe pick a new spot, then step toward it.
 *
 * `int(Math.random() * odds) == 1` in Flash; `random() * odds` landing in
 * `[1, 2)` is the same one chance in `odds`.
 */
export const stepWalker = (walker: Walker, random: Random): void => {
  walker.age++;
  if (!walker.moving && walker.age > PEN_SETTLE_TICKS && Math.floor(random() * walker.odds) === 1) {
    const at = pointIn(walker.area, random);
    walker.targetX = at.x;
    walker.targetY = at.y;
    walker.moving = true;
  }
  if (!walker.moving) return;

  const dx = walker.targetX - walker.x;
  const dy = walker.targetY - walker.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= ARRIVED || walker.speed <= 0) {
    walker.moving = false;
    return;
  }
  const step = Math.min(walker.speed, distance);
  walker.x += (dx / distance) * step;
  walker.y += (dy / distance) * step;
  walker.heading = screenHeading(dx, dy);
};
