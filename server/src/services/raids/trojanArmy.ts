import { DEGREES } from "./raidDirection.js";
import { raidLanding } from "./raidPlan.js";
import { TICKS_PER_SECOND, fromIso, screenOf, type RaidEvent } from "../../game-rules/combat/index.js";

/**
 * The Trojan Horse's army (#306 WP2, `docs/design/trojan-horse.md` §4): 51
 * monsters, one at a time, weakest first, all from the horse's door.
 *
 * Pure: no database, no Redis, no clock, no random stream (the horse's spawn
 * point never scatters, `r: 0`). The same input always gives the same 51
 * events.
 */

/** Flash spews on frame 1, then every 20th frame to 1100, at 24 fps (`BUILDING27.as:65-73`). */
const TROJAN_FIRST_FRAME = 1;
const TROJAN_FRAME_STEP = 20;
const TROJAN_LAST_FRAME = 1100;
const TROJAN_FRAMES_PER_SECOND = 24;

/** `Math.ceil(spewNumber / 100)` landing on 5 is Eye-ra, skipped (`BUILDING27.as:66-68`). */
const TROJAN_SKIPPED_TYPE = 5;

/** Flash's door, `new Point(_mc.x - 80, _mc.y + 108)` (`BUILDING27.as:72`), screen pixels. */
const TROJAN_DOOR_OFFSET_X = -80;
const TROJAN_DOOR_OFFSET_Y = 108;

/** One spawn: the engine tick it lands on and the monster it brings. */
export interface TrojanSpawn {
  readonly tick: number;
  readonly monster: string;
}

/**
 * Frame `f` to engine tick: `round(f / 24 x TICKS_PER_SECOND)`
 * (`docs/design/trojan-horse.md` §4).
 */
export const trojanTickOf = (frame: number): number => Math.round((frame / TROJAN_FRAMES_PER_SECOND) * TICKS_PER_SECOND);

/**
 * The 51 spawns, in order: 6 Pokey (C1), then 5 each of Octo-ooze (C2), Bolt
 * (C3), Fink (C4), Ichi (C6), Bandito (C7), Fang (C8), Brain (C9), Crabatron
 * (C10) and Projectix (C11). No Eye-ra (C5), no D.A.V.E. (C12).
 */
const trojanFrames = (): readonly number[] => {
  const frames = [TROJAN_FIRST_FRAME];
  for (let frame = TROJAN_FRAME_STEP; frame <= TROJAN_LAST_FRAME; frame += TROJAN_FRAME_STEP) {
    frames.push(frame);
  }
  return frames;
};

export const trojanSchedule = (): readonly TrojanSpawn[] => {
  const spawns: TrojanSpawn[] = [];
  for (const frame of trojanFrames()) {
    const type = Math.ceil(frame / 100);
    if (type === TROJAN_SKIPPED_TYPE) continue;
    spawns.push({ tick: trojanTickOf(frame), monster: `C${type}` });
  }
  return spawns;
};

export const TROJAN_MONSTER_COUNT = 51;

/** The tick the last spawn lands on, about 45.8 s (`trojanSchedule`'s last entry). */
export const TROJAN_LAST_SPAWN_TICK = trojanTickOf(TROJAN_LAST_FRAME);

/**
 * Health and damage multiplier, read once when the fight starts
 * (`BUILDING27.as:54-64`): x0.4, x0.6 past 3,000,000 empire points (a save's
 * `points + basevalue`, `calculateEmpirePoints`), x0.8 past 5,000,000, x1.0
 * past 8,000,000.
 */
export const trojanStrength = (empirePoints: number): number => {
  if (empirePoints > 8_000_000) return 1;
  if (empirePoints > 5_000_000) return 0.8;
  if (empirePoints > 3_000_000) return 0.6;
  return 0.4;
};

/**
 * The horse's door, in yard units, pulled onto the pathing grid the way
 * {@link raidLanding} pulls a raid's disc in (`docs/design/trojan-horse.md`
 * §4, suggested mapping). Flash's door is a fixed screen point,
 * `(horse.x - 80, horse.y + 108)`; here that is a disc of radius 0, so only
 * its distance and bearing from the yard's middle can be pulled in, never
 * shrunk.
 */
export const trojanDoorPoint = (horseX: number, horseY: number): { readonly x: number; readonly y: number } => {
  const horseScreen = screenOf(horseX, horseY);
  const door = fromIso(horseScreen.x + TROJAN_DOOR_OFFSET_X, horseScreen.y + TROJAN_DOOR_OFFSET_Y);
  const distance = Math.hypot(door.x, door.y);
  const bearing = distance === 0 ? 0 : Math.atan2(door.y, door.x) / DEGREES;
  const landing = raidLanding(bearing, distance, 0);
  return { x: landing.x, y: landing.y };
};

/** What the army builder is handed. */
export interface TrojanArmyInput {
  /** The horse's own stored position (`buildingdata`'s `X`/`Y`). */
  readonly horseX: number;
  readonly horseY: number;
  /** The save's `points + basevalue` (`calculateEmpirePoints`). */
  readonly empirePoints: number;
}

/**
 * The horse's army: 51 one-monster `raid` events at the door point, `r: 0`,
 * each at the strength the player's score earned. Levels are not this
 * builder's job: the fight reads them off the defender's own academy the way
 * any raid wave does (`BattleOptions.defenderLevels`, fidelity note 17).
 */
export const trojanArmy = (input: TrojanArmyInput): readonly RaidEvent[] => {
  const door = trojanDoorPoint(input.horseX, input.horseY);
  const strength = trojanStrength(input.empirePoints);
  return trojanSchedule().map(({ tick, monster }) => ({
    kind: "raid" as const,
    t: tick,
    x: door.x,
    y: door.y,
    r: 0,
    monsters: { [monster]: 1 },
    strength,
  }));
};
