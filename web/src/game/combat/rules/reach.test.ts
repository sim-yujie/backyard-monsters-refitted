import { describe, expect, it } from "vitest";

import { buildingReachOf } from "./champions.js";
import { EYE_RA_FOE_SQUARED } from "./engine.js";
import {
  screenPxBlastDistance,
  screenPxCreepsSquared,
  towerAcquires,
  towerHolds,
  type ReachPoint,
} from "./reach.js";
import type { EngineBuilding } from "./yard.js";
import { buildEngineYard, reachSquared } from "./yard.js";

/**
 * Every reach rule against Flash (beta 9, the reach audit), as a table: one
 * row per rule with the Flash line it follows, the space it measures in, the
 * point of the building it measures from and its radius, and whether it hits
 * a probe at eight bearings on screen round a building.
 *
 * Each probe stands `ring` screen pixels from the middle of the building's
 * drawn footprint, at N (straight up the screen, behind: the top corner's
 * side), NE, E, SE, S (in front), SW, W and NW. `H` is a hit, `.` a miss.
 *
 * `engine` is what the engine's own rule (`reach.ts`) gives; `flash` is
 * Flash's rule written out again here, apart from the engine. A faithful rule
 * has the two the same. A deliberate one (the owner's) says why they differ.
 */

/** The eight bearings, clockwise from straight up the screen. */
const BEARINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

type Footprint = "70x70" | "Town Hall";

/** One building alone, its footprint's middle on the yard's origin. */
const FOOTPRINTS: Record<Footprint, { readonly type: number; readonly at: number }> = {
  "70x70": { type: 1, at: -35 },
  "Town Hall": { type: 14, at: -65 },
};

const buildingOf = (footprint: Footprint): EngineBuilding => {
  const { type, at } = FOOTPRINTS[footprint];
  const yard = buildEngineYard({ buildingdata: { "1": { id: 1, t: type, l: 1, X: at, Y: at } } });
  return yard.buildings[0]!;
};

/** A screen point, and the probe standing on it in yard units (`_tmpPoint`, `FromISO`). */
interface Probe {
  readonly screen: { readonly x: number; readonly y: number };
  readonly point: ReachPoint;
}

/** The probe `ring` screen px from the screen origin (the footprint's middle) at `bearing`. */
const probeAt = (ring: number, bearing: number): Probe => {
  const angle = (bearing * Math.PI) / 4;
  const sx = ring * Math.sin(angle);
  const sy = -ring * Math.cos(angle);
  // The screen point back to the yard: x - y = sx, (x + y) / 2 = sy.
  const ix = sy + sx / 2;
  const iy = sy - sx / 2;
  return { screen: { x: sx, y: sy }, point: { ix, iy, x: Math.trunc(ix), y: Math.trunc(iy) } };
};

/* ── Flash, written out apart from the engine ─────────────────────────────── */

/** `GRID.ToISO` of a stored X/Y: the building's `_mc`/`_position`, floored. */
const flashPosition = (footprint: Footprint): { x: number; y: number } => {
  const { at } = FOOTPRINTS[footprint];
  return { x: Math.floor(at - at), y: Math.floor((at + at) * 0.5) };
};

/** Footprint height in yard units. */
const flashHeight = (footprint: Footprint): number => (footprint === "70x70" ? 70 : 130);

const flashSquared = (ax: number, ay: number, bx: number, by: number): number =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/** `getBuildingsInRange` (`Targeting.as:163`): screen px, `_tmpPoint` to `_mc`. */
const flashSplash = (probe: Probe, footprint: Footprint, radius: number): boolean => {
  const at = flashPosition(footprint);
  return Math.trunc(flashSquared(probe.screen.x, probe.screen.y, at.x, at.y)) < radius * radius;
};

/** `PATHING.FromISO`: yard units, truncated (`PATHING.as:677-681`). */
const pathingFromIso = (x: number, y: number) => ({
  x: Math.trunc(x * 0.5 + y),
  y: Math.trunc(y - x * 0.5),
});

/** `GRID.FromISO`: yard units, rounded up (`GRID.as:141-145`). */
const gridFromIso = (x: number, y: number) => ({
  x: Math.ceil(x * 0.5 + y),
  y: Math.ceil(y - x * 0.5),
});

/** `FindTargets` (`BTOWER.as:394`, `Targeting.as:236-241`): yard, `_position + (0, h / 2)`. */
const flashAcquire = (probe: Probe, footprint: Footprint, range: number): boolean => {
  const at = flashPosition(footprint);
  const from = pathingFromIso(at.x, at.y + flashHeight(footprint) / 2);
  const creep = pathingFromIso(probe.screen.x, probe.screen.y);
  return Math.trunc(flashSquared(from.x, from.y, creep.x, creep.y)) < range * range;
};

/** `targetInRange` (`BTOWER.as:234-249`): yard, `GRID.FromISO(_mc)`, its `.add` discarded. */
const flashHold = (probe: Probe, footprint: Footprint, range: number): boolean => {
  const at = flashPosition(footprint);
  const from = gridFromIso(at.x, at.y);
  const creep = gridFromIso(probe.screen.x, probe.screen.y);
  return flashSquared(from.x, from.y, creep.x, creep.y) < range * range;
};

/** `canShootBuilding` (`CreepBase.as:735-741`): screen px, `_tmpPoint` to `_mc`. */
const flashRanged = (probe: Probe, footprint: Footprint, range: number): boolean => {
  const at = flashPosition(footprint);
  return flashSquared(probe.screen.x, probe.screen.y, at.x, at.y) < range * range;
};

/** `CreepBase.as:808`: screen px between `_tmpPoint`s, under `DEFENSE_RANGE_SQUARED`. */
const flashEyeraFoe = (probe: Probe): boolean =>
  flashSquared(probe.screen.x, probe.screen.y, 0, 0) < 900;

/* ── The table ────────────────────────────────────────────────────────────── */

interface Row {
  readonly rule: string;
  readonly flashAt: string;
  readonly space: "screen px" | "yard";
  readonly anchor: string;
  readonly radius: number;
  /** Why the engine differs from Flash, for a deliberate rule. */
  readonly deliberate?: string;
  readonly engine: (probe: Probe, building: EngineBuilding) => boolean;
  readonly flash: (probe: Probe, footprint: Footprint) => boolean;
  /** For a rule beta 9 fixed: the engine's rule before, which must miss the table. */
  readonly before?: (probe: Probe, building: EngineBuilding) => boolean;
  /** The ring, chosen where the space and the anchor show, and the patterns there. */
  readonly expected: Record<
    Footprint,
    {
      readonly ring: number;
      readonly engine: string;
      readonly flash: string;
      readonly before?: string;
    }
  >;
}

/** The middle of the screen as a creep, for the creep-against-creep rule. */
const ORIGIN_CREEP: ReachPoint = { ix: 0, iy: 0, x: 0, y: 0 };

/** Until beta 9: yard units from the striker's range point to the anchor. */
const splashBefore = (probe: Probe, building: EngineBuilding): boolean =>
  Math.trunc((probe.point.x - building.cx) ** 2 + (probe.point.y - building.cy) ** 2) < 100 * 100;

const ROWS: readonly Row[] = [
  {
    rule: "splash on buildings (King Wormzer, Wormzer, Fink, Project X, Grokus)",
    flashAt: "Targeting.as:151-173",
    space: "screen px",
    anchor: "drawn top corner",
    radius: 100,
    engine: (probe, building) =>
      screenPxBlastDistance(probe.point.ix, probe.point.iy, building, 100) !== undefined,
    flash: (probe, footprint) => flashSplash(probe, footprint, 100),
    before: splashBefore,
    expected: {
      "70x70": { ring: 115, engine: "HH.....H", flash: "HH.....H", before: ".HH...HH" },
      "Town Hall": { ring: 140, engine: "H.......", flash: "H.......", before: ".H.....H" },
    },
  },
  {
    rule: "tower finds a target (range 160)",
    flashAt: "BTOWER.as:394",
    space: "yard",
    anchor: "footprint middle",
    radius: 160,
    engine: (probe, building) => towerAcquires(probe.point, building, 160),
    flash: (probe, footprint) => flashAcquire(probe, footprint, 160),
    expected: {
      "70x70": { ring: 115, engine: ".HHH.HHH", flash: ".HHH.HHH" },
      "Town Hall": { ring: 115, engine: ".HHH.HHH", flash: ".HHH.HHH" },
    },
  },
  {
    rule: "tower keeps shooting a target it found (range 160)",
    flashAt: "BTOWER.as:234-249",
    space: "yard",
    anchor: "footprint middle",
    radius: 160,
    deliberate:
      "owner's pick B (reach-merge, 25 Nov 2026): towers stay as they are, holding from the " +
      "middle where they found the target; Flash means to as well, but the result of " +
      "`_loc2_.add(...)` at BTOWER.as:238 is thrown away, so it holds from the anchor and " +
      "never shoots a creep in front of the tower that is out of the anchor's range",
    engine: (probe, building) => towerHolds(probe.point, building, 160),
    flash: (probe, footprint) => flashHold(probe, footprint, 160),
    expected: {
      "70x70": { ring: 100, engine: "HHHHHHHH", flash: "HHHH.HHH" },
      "Town Hall": { ring: 100, engine: "HHHHHHHH", flash: "HHH...HH" },
    },
  },
  {
    rule: "tower keeps shooting a target it found, further out (range 160)",
    flashAt: "BTOWER.as:234-249",
    space: "yard",
    anchor: "footprint middle",
    radius: 160,
    deliberate:
      "owner's pick B, as above: behind a tower Flash's anchor holds a target the middle " +
      "has already let go of",
    engine: (probe, building) => towerHolds(probe.point, building, 160),
    flash: (probe, footprint) => flashHold(probe, footprint, 160),
    expected: {
      "70x70": { ring: 150, engine: "..H...H.", flash: ".HH...HH" },
      "Town Hall": { ring: 150, engine: "..H...H.", flash: "HHH...HH" },
    },
  },
  {
    rule: "ranged monster reaches a building (D.A.V.E. rank 1, 140)",
    flashAt: "CreepBase.as:735-741",
    space: "yard",
    anchor: "nearest tile",
    radius: 140,
    deliberate:
      "owner's pick C (24 Nov 2026): range / sqrt 2 yard units from the nearest tile, the " +
      "same all round; Flash measured screen px to the top corner",
    engine: (probe, building) => {
      const reach = buildingReachOf("C12", false, 140);
      return reachSquared(probe.point.ix, probe.point.iy, building) <= reach * reach;
    },
    flash: (probe, footprint) => flashRanged(probe, footprint, 140),
    expected: {
      "70x70": { ring: 140, engine: "..H...H.", flash: "HH.....H" },
      "Town Hall": { ring: 140, engine: ".HHH.HHH", flash: "HH.....H" },
    },
  },
];

/** The creep-against-creep row: Eye-ra's blast on the defender it fights (50 px until beta 9). */
const EYE_RA_RINGS: readonly {
  readonly ring: number;
  readonly expected: string;
  readonly before: string;
}[] = [
  { ring: 29, expected: "HHHHHHHH", before: "HHHHHHHH" },
  { ring: 31, expected: "........", before: "HHHHHHHH" },
  { ring: 51, expected: "........", before: "........" },
];

const pattern = (hit: (probe: Probe) => boolean, ring: number): string =>
  BEARINGS.map((_, bearing) => (hit(probeAt(ring, bearing)) ? "H" : ".")).join("");

describe("every reach rule against Flash, at eight bearings (reach audit, beta 9)", () => {
  for (const row of ROWS) {
    for (const footprint of Object.keys(FOOTPRINTS) as Footprint[]) {
      const want = row.expected[footprint];
      it(`${row.rule}: ${row.space} from the ${row.anchor}, ${row.radius}, ${want.ring} px round a ${footprint} (${row.flashAt})`, () => {
        const building = buildingOf(footprint);
        const engine = pattern((probe) => row.engine(probe, building), want.ring);
        const flash = pattern((probe) => row.flash(probe, footprint), want.ring);
        expect(engine).toBe(want.engine);
        expect(flash).toBe(want.flash);
        if (row.deliberate === undefined) expect(engine).toBe(flash);
        else expect(engine).not.toBe(flash);
        if (row.before) {
          const before = pattern((probe) => row.before!(probe, building), want.ring);
          expect(before).toBe(want.before);
          expect(before).not.toBe(engine);
        }
      });
    }
  }

  it.each(EYE_RA_RINGS)(
    "Eye-ra's blast on the defender it fights: screen px between creeps, 30 (CreepBase.as:808), at $ring px",
    ({ ring, expected, before }) => {
      const engine = pattern(
        (probe) => screenPxCreepsSquared(probe.point, ORIGIN_CREEP) < EYE_RA_FOE_SQUARED,
        ring,
      );
      expect(engine).toBe(expected);
      expect(pattern(flashEyeraFoe, ring)).toBe(expected);
      expect(
        pattern((probe) => screenPxCreepsSquared(probe.point, ORIGIN_CREEP) < 2500, ring),
      ).toBe(before);
    },
  );
});
