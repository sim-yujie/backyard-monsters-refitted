/**
 * The guided start's staged raid as a pure timeline (issue #227,
 * `docs/design/tutorial.md` §4): eight Octo-oozes (C2), as Flash's
 * `CUSTOMATTACKS.TutorialAttack` sent (`client/scripts/CUSTOMATTACKS.as:75-103`),
 * walk at the new Sniper Tower; it shoots one dead every two seconds, its
 * level 1 rate, and the last two turn and run (`TUTORIAL.as:1490-1497`).
 *
 * Client-only and harmless: no engine runs, no route is called, nothing is
 * saved. `StagedRaidLayer` draws {@link raidAt}; the runner calls
 * `guide/advance {from: "raid"}` when it ends. Positions are yard units, the
 * space of `buildingdata` X/Y, so the layer draws them with `yardToWorld`.
 */

/** A point in yard units. */
export interface YardPoint {
  readonly x: number;
  readonly y: number;
}

/** The monster the raid sends. */
export const RAID_MONSTER = "C2";
/** How many walk in. */
export const RAID_COUNT = 8;
/** How many the tower kills; the rest run. */
export const RAID_KILLS = 6;
/** Spawn distance from the tower, yard units (§4: "about 600"). */
export const SPAWN_DISTANCE = 600;
/** A level 1 Sniper Tower's range (§4). */
export const TOWER_RANGE = 300;
/** Seconds between shots: 80 ticks x rearm 2 at 80 ticks a second. */
export const SHOT_SECONDS = 2;
/** Walking speed, yard units a second: in range after about four seconds. */
export const WALK_SPEED = 75;
/** Running away is quicker. */
export const RUN_SPEED = 140;
/** They stop this far from the tower's centre, as at its wall. */
export const STOP_DISTANCE = 80;
/** When the two survivors turn and run. */
export const FLEE_AT = 16;
/** When the last of them is gone: the closing line follows. */
export const RAID_SECONDS = 19;
/** How long a death puff plays. */
export const DEATH_SECONDS = 0.6;
/** How long a shot's tracer shows. */
export const SHOT_FLASH_SECONDS = 0.18;

/** One ooze's plan: where it starts and when, if ever, it is shot. */
export interface RaidMonster {
  readonly id: number;
  readonly spawn: YardPoint;
  /** Seconds into the raid it is shot; null for the two that run. */
  readonly diesAt: number | null;
}

/** The whole raid, fixed once at the start. */
export interface RaidPlan {
  readonly tower: YardPoint;
  readonly monsters: readonly RaidMonster[];
  /** Seconds of each shot, in order. */
  readonly shots: readonly { readonly at: number; readonly target: number }[];
}

/** One ooze at a moment. */
export interface RaidMonsterState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** Heading on the ground, radians, from +x towards +y. */
  readonly heading: number;
  readonly moving: boolean;
  /** Seconds since it was shot, while its puff plays; null while alive. */
  readonly dying: number | null;
  readonly fleeing: boolean;
  /** Gone from the screen (dead and faded, or run off). */
  readonly gone: boolean;
}

/** A shot on screen: from the tower to where its target stood. */
export interface RaidShot {
  readonly to: YardPoint;
  /** 0 to 1 through its flash. */
  readonly progress: number;
}

export interface RaidFrame {
  readonly monsters: readonly RaidMonsterState[];
  readonly shots: readonly RaidShot[];
  readonly over: boolean;
}

const unit = (from: YardPoint, to: YardPoint): YardPoint => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
};

/** A small repeatable scatter, so every raid looks the same. */
const scatter = (index: number, salt: number): number => {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

/**
 * Plans the raid: the oozes spawn {@link SPAWN_DISTANCE} beyond the tower on
 * the line from the Town Hall through it, in a loose group, and walk straight
 * at it. Each shot kills the nearest live one; the first fires as the first
 * ooze comes into range.
 *
 * @param tower - The Sniper Tower's centre.
 * @param hall - The Town Hall's centre (the raid comes from beyond the tower).
 */
export const planRaid = (tower: YardPoint, hall: YardPoint | null): RaidPlan => {
  const away = hall ? unit(hall, tower) : { x: 1, y: 0 };
  const side = { x: -away.y, y: away.x };
  const centre = { x: tower.x + away.x * SPAWN_DISTANCE, y: tower.y + away.y * SPAWN_DISTANCE };
  const spawns = Array.from({ length: RAID_COUNT }, (_, index) => {
    const across = scatter(index, 1) * 90;
    const along = scatter(index, 2) * 50;
    return {
      x: centre.x + side.x * across + away.x * along,
      y: centre.y + side.y * across + away.y * along,
    };
  });

  const ahead = (spawn: YardPoint): number => Math.hypot(spawn.x - tower.x, spawn.y - tower.y);
  // The first shot: when the nearest ooze reaches the tower's range.
  const nearest = Math.min(...spawns.map(ahead));
  const firstShot = Math.max(0.5, (nearest - TOWER_RANGE) / WALK_SPEED);

  // Shots go to the nearest live ooze; spawn distance orders them, since all walk at one speed.
  const order = spawns
    .map((spawn, id) => ({ id, distance: ahead(spawn) }))
    .sort((a, b) => a.distance - b.distance || a.id - b.id);
  const shots = order.slice(0, RAID_KILLS).map((entry, index) => ({
    at: firstShot + index * SHOT_SECONDS,
    target: entry.id,
  }));
  const diesAt = new Map(shots.map((shot) => [shot.target, shot.at]));

  return {
    tower,
    monsters: spawns.map((spawn, id) => ({ id, spawn, diesAt: diesAt.get(id) ?? null })),
    shots,
  };
};

/** Where an ooze walking at the tower is `t` seconds in. */
const walkingAt = (plan: RaidPlan, monster: RaidMonster, t: number): YardPoint => {
  const toward = unit(monster.spawn, plan.tower);
  const room = Math.max(
    0,
    Math.hypot(plan.tower.x - monster.spawn.x, plan.tower.y - monster.spawn.y) - STOP_DISTANCE,
  );
  const walked = Math.min(room, Math.max(0, t) * WALK_SPEED);
  return { x: monster.spawn.x + toward.x * walked, y: monster.spawn.y + toward.y * walked };
};

/** The raid `t` seconds in. */
export const raidAt = (plan: RaidPlan, t: number): RaidFrame => {
  const monsters = plan.monsters.map((monster): RaidMonsterState => {
    const toward = unit(monster.spawn, plan.tower);
    const heading = Math.atan2(toward.y, toward.x);
    if (monster.diesAt !== null && t >= monster.diesAt) {
      const at = walkingAt(plan, monster, monster.diesAt);
      const dying = t - monster.diesAt;
      return {
        id: monster.id,
        ...at,
        heading,
        moving: false,
        dying,
        fleeing: false,
        gone: dying >= DEATH_SECONDS,
      };
    }
    if (monster.diesAt === null && t >= FLEE_AT) {
      const from = walkingAt(plan, monster, FLEE_AT);
      const ran = (t - FLEE_AT) * RUN_SPEED;
      return {
        id: monster.id,
        x: from.x - toward.x * ran,
        y: from.y - toward.y * ran,
        heading: heading + Math.PI,
        moving: true,
        dying: null,
        fleeing: true,
        gone: t >= RAID_SECONDS,
      };
    }
    const at = walkingAt(plan, monster, t);
    const still = Math.hypot(plan.tower.x - at.x, plan.tower.y - at.y) <= STOP_DISTANCE + 0.5;
    return { id: monster.id, ...at, heading, moving: !still, dying: null, fleeing: false, gone: false };
  });

  const shots: RaidShot[] = [];
  for (const shot of plan.shots) {
    const since = t - shot.at;
    if (since < 0 || since > SHOT_FLASH_SECONDS) continue;
    const target = plan.monsters[shot.target]!;
    shots.push({ to: walkingAt(plan, target, shot.at), progress: since / SHOT_FLASH_SECONDS });
  }

  return { monsters, shots, over: t >= RAID_SECONDS };
};
