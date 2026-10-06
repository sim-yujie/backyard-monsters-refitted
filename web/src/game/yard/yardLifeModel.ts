import type { BaseLoadResponse } from "@/api/types";
import {
  BEHAVIOUR_SPEED,
  championStat,
  isKnownMonster,
  monsterMovement,
  monsterTickSpeed,
} from "@/game/combat/rules";
import { academyLevel } from "@/game/monsters/housing";
import { fromIso } from "./YardGrid";
import type { Yard, YardBuilding } from "./yardModel";

/**
 * What lives on a yard besides its buildings (issues #158, #159): the housed
 * monsters wandering their pens, a raised champion pacing its cage, and the
 * workers. Arithmetic only, so it runs under node; `YardLifeLayer` draws it.
 *
 * Everything here is drawn and nothing is saved. The Flash client simulated
 * all of it as real creatures; this client has no creature to simulate outside
 * a battle, so it keeps the look and none of the state.
 *
 * ## Whose yard ({@link LifeView})
 *
 * Flash ran the same load on every yard it opened, so a visited or attacked
 * yard showed its owner's life too: `HOUSING.Populate` (`BASE.as:2043-2044`)
 * filled the pens from the loaded yard's monsters, the cage spawned its
 * champion, and `QUEUE.Spawn` (`BASE.as:1498`) put out the workers. A
 * `/base/load` of somebody else's yard carries that yard's `monsters`,
 * `champion`, `academy` and `storedata`, never the viewer's, so the same
 * reading works on it. Three exceptions:
 *
 * - **No workers on a wild monster camp.** `QUEUE.Spawn` skips the two world
 *   map modes, `WMATTACK` and `WMVIEW` (`QUEUE.as:56`); a player's yard, visited
 *   or attacked, has its workers, and a running job has one standing at it
 *   (`BFOUNDATION.as:3154-3182` queues it on load, whoever is looking).
 * - **No champion on an attacked yard.** Flash's cage champion was a guardian
 *   that came out to fight the attacker. The combat engine does not simulate a
 *   defending champion (only the attacker's flung ones,
 *   `game/combat/rules/engine.ts`), so one drawn in its cage would be a
 *   defender that never defends. A visit, where nobody fights, shows it pacing.
 * - **A Housing destroyed in a battle loses its monsters.** `BUILDING15.Destroyed`
 *   sets every creature in it to zero health in Map Room 2
 *   (`BUILDING15.as:93-104`); {@link fellPens} takes the pen's walkers off.
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
 * its pen (`CreepBase.as:260`), so it stands on the ground over its shadow,
 * which the owner kept (#211) when the flyers went higher on the attack
 * screen.
 *
 * Flash drew every one. A big army is thousands, so this draws a sample:
 * {@link sampleArmy} keeps every type present and shares at most
 * {@link MAX_HOUSED_DRAWN} places between the types in proportion to their
 * counts, and the sample is dealt round the pens in turn.
 *
 * ## The champion (`client/scripts/CHAMPIONCAGE.as:589-660`)
 *
 * The cage's `Setup` spawns every champion whose `status` is 0, "normal", in
 * behaviour `pen` at `PointInCage`: 40 to 80 yard units in from a centre that
 * is the cage's corner shifted up to 20 px each way on screen (`:623`,
 * `:280-283`). A frozen (1), juiced (2) or otherwise gone champion is not
 * spawned, so the cage stands empty. There is no sleeping state: a hurt
 * champion heals in its pen and paces like any other
 * (`champions/ChampionBase.as:1044-1061`), with a 1 in 150 chance a tick of a
 * new spot (`:1058`), at a quarter of its speed (`:1374-1378`, and the
 * engine's `speed / 4`), showing its idle row while it stands (`:1538-1540`).
 * One owner rule departs from that (#206): a champion at a flying level, Fomor
 * from 3, never lands in its cage but hovers at its flight height and flaps,
 * standing or pacing (`YardLifeLayer`). Krallen picks its sheet by power level (`champions/Krallen.as:46-48`).
 *
 * ## Workers (`client/scripts/WORKERS.as`, `WORKER.as`)
 *
 * One `WORKER` per worker the yard has (`QUEUE.as:40-70`), each spawned at a
 * random spot on the map (`WORKERS.as:37-51`). An idle worker stands: its
 * `Wander` is empty (`WORKER.as:151-165`). A job takes the nearest free worker
 * (`WORKERS.as:65-80`), who walks to the building, speeding up by 0.05 a frame
 * to 2 px (1 px when it has no job), turning a third of the way toward its
 * target each frame (a fifth without a job), and slowing by 0.1 a frame to a
 * stop once within 20 px of it (`WORKER.as:211-316`). When the job ends it
 * stays where it stood (`WORKERS.as:104-130`). A job already running when the
 * yard loads has its worker standing at it already (`WORKERS.as:85-95`, the
 * catch-up branch). While Sharper Tools runs every worker wears the hard hat
 * row (`SPRITES.as:130-138`).
 */

/* ── Clocks ─────────────────────────────────────────────────────────────── */

/**
 * The creature tick: `CREATURES.Tick` and the champions run in the fast loop,
 * 80 a second (`client/scripts/GLOBAL.as:1234-1274`), which is also the tick
 * the attack screen's animation rows count in.
 */
export const CREATURE_TICK_HZ = 80;

/** Workers tick once a frame at the stage's 40 (`GLOBAL.as:1297-1301`). */
export const WORKER_TICK_HZ = 40;

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

/** The Champion Cage's type id and its pen (`CHAMPIONCAGE.as:280-283`). */
export const CHAMPION_CAGE_TYPE = 114;
const CAGE = { inset: 40, size: 40, jitter: 20 } as const;

/** Ticks a penned creature stands before it may first move (`CreepBase.as:1377`). */
export const PEN_SETTLE_TICKS = 240;

/** One chance in this many, each tick, of a penned creature picking a new spot. */
export const CREEP_WANDER_ODDS = 200;
export const CHAMPION_WANDER_ODDS = 150;

/** Yard units from its target at which a walker counts as there (`CreepBase.as:1698`). */
const ARRIVED = 5;

/** A champion's speed prop to yard units a tick, before behaviour (`engine.ts` `speed / 4`). */
const CHAMPION_SPEED_DIVISOR = 4;

/** Krallen's champion type: its sheet goes by power level (`Krallen.as:46-48`). */
const KRALLEN_TYPE = 5;

/** Worker motion, in world px and degrees a frame (`WORKER.as:211-316`). */
export const WORKER_MOTION = {
  /** Top speed with a job, and without one. */
  busySpeed: 2,
  idleSpeed: 1,
  accelerate: 0.05,
  brake: 0.1,
  /** Within this many px of its target a worker brakes to a stop. */
  near: 20,
  /** Fraction of the remaining turn taken each frame. */
  busyTurn: 1 / 3,
  idleTurn: 1 / 5,
} as const;

/** Yard units a working worker stands off the building's footprint. */
const WORKER_STANDOFF = 6;

/** The countdowns that hold a worker (`workers.ts`, `holdsWorker`). */
const WORKER_JOBS: ReadonlySet<string> = new Set(["build", "upgrade", "fortify"]);

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

/** A champion on show in the cage. */
export interface LifeChampion {
  /** `G1`..`G5`. */
  readonly id: string;
  /** Evolution level: its speed. */
  readonly level: number;
  /** The level its sheet is picked at: the power level for Krallen. */
  readonly sheetLevel: number;
}

/** A building a worker is on. */
export interface LifeJob {
  readonly id: number;
  /** Yard units: footprint top corner and size. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How a yard is being looked at: the player's own, somebody else's on a visit,
 * or somebody else's under attack. See "Whose yard" above.
 */
export type LifeView = "own" | "visit" | "attack";

/** Everything alive on a yard, as read from its save. */
export interface YardLife {
  readonly groups: readonly LifeGroup[];
  readonly pens: readonly LifePen[];
  /** Pens destroyed in a battle: their monsters are gone (`BUILDING15.as:93-104`). */
  readonly fallen: ReadonlySet<number>;
  readonly champions: readonly LifeChampion[];
  /** The cage's top corner in yard units, or null when the yard has none. */
  readonly cage: LifePen | null;
  readonly workers: number;
  readonly jobs: readonly LifeJob[];
  /** Sharper Tools is running: every worker wears the hard hat. */
  readonly hardHat: boolean;
  /** The plot, `[-w/2, w/2) x [-h/2, h/2)` in yard units. */
  readonly plot: { readonly width: number; readonly height: number };
  /** Every footprint, so an idle worker is not put down inside a building. */
  readonly footprints: readonly LifeArea[];
}

/** Nothing alive at all. */
export const EMPTY_LIFE: YardLife = {
  groups: [],
  pens: [],
  fallen: new Set(),
  champions: [],
  cage: null,
  workers: 0,
  jobs: [],
  hardHat: false,
  plot: { width: 0, height: 0 },
  footprints: [],
};

const standing = (building: YardBuilding): boolean => building.hp === null || building.hp > 0;

/** A wild monster camp's save `type` (`server/src/enums/Base.ts`). */
const TRIBE_TYPE = "tribe";

/**
 * What lives on a yard, from its save and the yard read from it, as seen in
 * `view`.
 *
 * Pens are the Housing buildings with health above zero, as `Populate` takes
 * them (`HOUSING.as:212-215`); one still being built counts, as it did there.
 * The champion list keeps status 0 only (`CHAMPIONCAGE.as:593-594`), and is
 * empty on an attacked yard; a wild monster camp has no workers.
 *
 * Every housed monster the combat tables know is drawn. A ground monster, the
 * Pokey among them, names no `movement` there (only flyers, burrowers and
 * jumpers do), so it is the table entry that is looked for (#229).
 */
export const yardLifeOf = (
  save: BaseLoadResponse,
  yard: Yard,
  view: LifeView = "own",
): YardLife => {
  const groups: LifeGroup[] = [];
  for (const [id, raw] of Object.entries(save.monsters?.housed ?? {})) {
    const count = Math.floor(Number(raw));
    if (!Number.isFinite(count) || count <= 0 || !isKnownMonster(id)) continue;
    groups.push({ id, level: academyLevel(save.academy, id), count });
  }

  const pens: LifePen[] = [];
  let cage: LifePen | null = null;
  const jobs: LifeJob[] = [];
  const footprints: LifeArea[] = [];
  for (const building of yard.buildings) {
    const [width, height] = building.footprint;
    footprints.push({ x: building.x, y: building.y, width, height });
    if (building.type === HOUSING_TYPE && standing(building)) {
      pens.push({ id: building.id, x: building.x, y: building.y });
    }
    if (building.type === CHAMPION_CAGE_TYPE && cage === null) {
      cage = { id: building.id, x: building.x, y: building.y };
    }
    if (building.countdown && WORKER_JOBS.has(building.countdown.kind)) {
      jobs.push({ id: building.id, x: building.x, y: building.y, width, height });
    }
  }
  pens.sort((a, b) => a.id - b.id);
  jobs.sort((a, b) => a.id - b.id);

  const champions: LifeChampion[] = [];
  for (const entry of view === "attack" ? [] : (save.champion ?? [])) {
    if (!entry || Number(entry.status ?? 0) !== 0) continue;
    const t = Math.floor(Number(entry.t));
    if (!(t >= 1)) continue;
    const level = Math.max(1, Math.floor(Number(entry.l)) || 1);
    const power = Math.max(1, Math.floor(Number(entry.pl)) || 1);
    champions.push({ id: `G${t}`, level, sheetLevel: t === KRALLEN_TYPE ? power : level });
  }

  const workless = save.type === TRIBE_TYPE;
  return {
    groups,
    pens,
    fallen: EMPTY_LIFE.fallen,
    champions,
    cage,
    workers: workless ? 0 : yard.workers.total,
    jobs: workless ? [] : jobs,
    hardHat: yard.buildTime < 1,
    plot: { width: yard.bounds.yardWidth, height: yard.bounds.yardHeight },
    footprints,
  };
};

/**
 * The life with every pen among `destroyed` fallen, or the same object when
 * that fells no pen that was standing, so a caller can tell nothing changed.
 */
export const fellPens = (life: YardLife, destroyed: readonly number[]): YardLife => {
  let fallen: Set<number> | null = null;
  for (const id of destroyed) {
    if (life.fallen.has(id) || !life.pens.some((pen) => pen.id === id)) continue;
    fallen ??= new Set(life.fallen);
    fallen.add(id);
  }
  return fallen ? { ...life, fallen } : life;
};

/**
 * At most `cap` of one monster type in the pens, while the rest of them are
 * still walking home (#228): a new monster is drawn walking there, and only
 * joins its pen when it arrives.
 */
export interface LifeHold {
  readonly monster: string;
  readonly cap: number;
}

/**
 * The life with every held type cut to its cap, the lowest when one type is
 * held more than once; the same object when no group is over its cap.
 */
export const holdBack = (life: YardLife, holds: readonly LifeHold[]): YardLife => {
  if (holds.length === 0) return life;
  const caps = new Map<string, number>();
  for (const hold of holds) {
    caps.set(hold.monster, Math.min(caps.get(hold.monster) ?? Infinity, Math.max(0, hold.cap)));
  }
  let held = false;
  const groups: LifeGroup[] = [];
  for (const group of life.groups) {
    const cap = caps.get(group.id);
    if (cap === undefined || group.count <= cap) {
      groups.push(group);
      continue;
    }
    held = true;
    if (cap > 0) groups.push({ ...group, count: Math.floor(cap) });
  }
  return held ? { ...life, groups } : life;
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

/* ── Walkers: monsters and champions in their pens ──────────────────────── */

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

/**
 * The wander rectangle of a champion at a cage (`PointInCage` around the centre
 * `SpawnGuardian` picks: the corner moved up to 20 px either way on screen).
 */
export const cageArea = (cage: LifePen, random: Random): LifeArea => {
  const nudge = fromIso(
    -CAGE.jitter + random() * CAGE.jitter * 2,
    -CAGE.jitter + random() * CAGE.jitter * 2,
  );
  return {
    x: cage.x + nudge.x + CAGE.inset,
    y: cage.y + nudge.y + CAGE.inset,
    width: CAGE.size,
    height: CAGE.size,
  };
};

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

/** The walkers a yard's pens and cage hold, by key. */
export const walkerSpecs = (
  life: YardLife,
  random: Random,
  cap = MAX_HOUSED_DRAWN,
): WalkerSpec[] => {
  const specs: WalkerSpec[] = [];

  if (life.pens.length > 0) {
    // The nth of a type in a pen keeps its key while the army around it changes.
    const seen = new Map<string, number>();
    sampleArmy(life.groups, cap).forEach((monster, index) => {
      const pen = life.pens[index % life.pens.length];
      // Dealt round every pen first, so the ones left standing keep theirs.
      if (!pen || life.fallen.has(pen.id)) return;
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

  const cage = life.cage;
  if (cage) {
    for (const champion of life.champions) {
      specs.push({
        key: `c:${cage.id}:${champion.id}`,
        monsterId: champion.id,
        sheetLevel: champion.sheetLevel,
        champion: true,
        area: cageArea(cage, random),
        speed:
          (championStat(champion.id, "speed", champion.level) / CHAMPION_SPEED_DIVISOR) *
          (BEHAVIOUR_SPEED["pen"] ?? 1),
        odds: CHAMPION_WANDER_ODDS,
      });
    }
  }

  return specs;
};

/**
 * Brings a set of walkers in line with a yard: keeps every walker whose key is
 * still wanted where it stands, makes the new ones, drops the rest.
 *
 * A kept walker takes the new spec's area, so a pen that moved has its
 * creatures walk over to it rather than blink there, and a kept champion keeps
 * the cage spot it already chose. A champion that evolved keeps its key and
 * spot but takes its new level's sheet (#311).
 */
export const reconcileWalkers = (
  current: ReadonlyMap<string, Walker>,
  specs: readonly WalkerSpec[],
  random: Random,
): Map<string, Walker> => {
  const next = new Map<string, Walker>();
  for (const spec of specs) {
    const found = current.get(spec.key);
    const kept =
      found && found.sheetLevel !== spec.sheetLevel ? { ...found, sheetLevel: spec.sheetLevel } : found;
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

/* ── Workers ────────────────────────────────────────────────────────────── */

/** A worker, in world px and frames, as `WORKER.as` moves it. */
export interface Worker {
  readonly index: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** Degrees, 0 facing right, clockwise on screen: `mcMarker.rotation`. */
  rotation: number;
  speed: number;
  /** The building it is on, or null. */
  job: number | null;
}

/** Yard units to world px, without `toIso`'s floor: a worker is drawn wherever it is. */
export type ToWorld = (x: number, y: number) => { x: number; y: number };

/**
 * An idle worker's starting spot: somewhere on the plot, as `WORKERS.Spawn`
 * scatters them (`WORKERS.as:43`), but not inside a building, which the
 * Flash map never had to think about because its workers stood on top.
 */
export const idleSpot = (life: YardLife, random: Random): { x: number; y: number } => {
  const { width, height } = life.plot;
  let spot = { x: 0, y: 0 };
  for (let attempt = 0; attempt < 30; attempt++) {
    spot = { x: (random() - 0.5) * width * 0.9, y: (random() - 0.5) * height * 0.9 };
    const blocked = life.footprints.some(
      (box) =>
        spot.x >= box.x - 4 &&
        spot.x <= box.x + box.width + 4 &&
        spot.y >= box.y - 4 &&
        spot.y <= box.y + box.height + 4,
    );
    if (!blocked) break;
  }
  return spot;
};

/**
 * Where a worker stands to work on a building: the point of the footprint's
 * edge nearest to where it comes from, a step outside. Flash walked the path
 * to the footprint's edge and stopped there (`WORKER.as:196-206`).
 */
export const jobSpot = (job: LifeJob, fromX: number, fromY: number): { x: number; y: number } => {
  const left = job.x - WORKER_STANDOFF;
  const top = job.y - WORKER_STANDOFF;
  const right = job.x + job.width + WORKER_STANDOFF;
  const bottom = job.y + job.height + WORKER_STANDOFF;
  let x = Math.min(Math.max(fromX, left), right);
  let y = Math.min(Math.max(fromY, top), bottom);
  if (x > left && x < right && y > top && y < bottom) {
    // Coming from inside the footprint: out through the nearest side.
    const gaps = [x - left, right - x, y - top, bottom - y];
    const nearest = gaps.indexOf(Math.min(...gaps));
    if (nearest === 0) x = left;
    else if (nearest === 1) x = right;
    else if (nearest === 2) y = top;
    else y = bottom;
  }
  return { x, y };
};

/**
 * Brings the crew in line with a yard's jobs.
 *
 * A worker whose job is over keeps standing where it is. A new job takes the
 * nearest free worker (`WORKERS.as:65-80`) and sets it walking; on the first
 * read of a yard (`arrive`) the worker is put straight at the job, as Flash's
 * catch-up did. Workers are added or dropped to match the count.
 */
export const reconcileWorkers = (
  crew: readonly Worker[],
  life: YardLife,
  toWorld: ToWorld,
  toYard: ToWorld,
  random: Random,
  arrive: boolean,
): Worker[] => {
  const next: Worker[] = crew.slice(0, life.workers);
  while (next.length < life.workers) {
    const spot = idleSpot(life, random);
    const at = toWorld(spot.x, spot.y);
    next.push({
      index: next.length,
      x: at.x,
      y: at.y,
      targetX: at.x,
      targetY: at.y,
      rotation: random() * 360,
      speed: 0,
      job: null,
    });
  }

  const jobs = new Map(life.jobs.map((job) => [job.id, job]));
  for (const worker of next) {
    if (worker.job !== null && !jobs.has(worker.job)) worker.job = null;
  }
  const taken = new Set<number>();
  for (const worker of next) if (worker.job !== null) taken.add(worker.job);

  for (const job of life.jobs) {
    if (taken.has(job.id)) continue;
    let best: Worker | null = null;
    let bestDistance = Infinity;
    for (const worker of next) {
      if (worker.job !== null) continue;
      const centre = toWorld(job.x + job.width / 2, job.y + job.height / 2);
      const distance = Math.hypot(centre.x - worker.x, centre.y - worker.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = worker;
      }
    }
    if (!best) break;
    best.job = job.id;
    taken.add(job.id);
    const from = toYard(best.x, best.y);
    const spot = jobSpot(job, from.x, from.y);
    const at = toWorld(spot.x, spot.y);
    best.targetX = at.x;
    best.targetY = at.y;
    if (arrive) {
      best.x = at.x;
      best.y = at.y;
      best.speed = 0;
    }
  }
  return next;
};

/** Wraps a turn into `(-180, 180]` degrees. */
const shortTurn = (degrees: number): number => {
  let turn = degrees % 360;
  if (turn > 180) turn -= 360;
  if (turn <= -180) turn += 360;
  return turn;
};

/**
 * One frame of a worker's walk (`WORKER.as:211-316`): speed up toward its top
 * speed until it is near, then brake; step along its facing; turn part of the
 * way toward the target. Its facing only follows the target while it moves,
 * so one standing still keeps the way it last faced.
 */
export const stepWorker = (worker: Worker): void => {
  const busy = worker.job !== null;
  const dx = worker.targetX - worker.x;
  const dy = worker.targetY - worker.y;
  const distance = Math.hypot(dx, dy);

  if (distance < WORKER_MOTION.near) {
    worker.speed = Math.max(0, worker.speed - WORKER_MOTION.brake);
  } else {
    const top = busy ? WORKER_MOTION.busySpeed : WORKER_MOTION.idleSpeed;
    worker.speed += worker.speed < top ? WORKER_MOTION.accelerate : -WORKER_MOTION.accelerate;
  }
  if (worker.speed <= 0 && distance < WORKER_MOTION.near) return;

  const radians = (worker.rotation * Math.PI) / 180;
  worker.x += Math.cos(radians) * worker.speed;
  worker.y += Math.sin(radians) * worker.speed;

  if (distance > 0) {
    const want = (Math.atan2(dy, dx) * 180) / Math.PI;
    const turn = shortTurn(want - worker.rotation);
    worker.rotation += turn * (busy ? WORKER_MOTION.busyTurn : WORKER_MOTION.idleTurn);
    worker.rotation = ((worker.rotation % 360) + 360) % 360;
  }
};
