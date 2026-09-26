import type { Camera } from "@/game/Camera";
import { BOMBS, buildingClass, isTower, type BombStats } from "@/game/combat/rules";
import { propsSize } from "@/game/yard/buildingArt";
import type { Point } from "@/game/yard/YardGrid";
import { toIso } from "@/game/yard/YardGrid";
import type { Yard, YardBuilding } from "@/game/yard/yardModel";
import type { YardRenderer } from "@/game/yard/YardRenderer";
import type { AttackSession } from "./AttackSession";
import type { Bucket } from "./bucket";

/**
 * Tap-to-drop on the enemy yard, and the rules a drop point has to pass
 * (`docs/design/attack-flow.md` §F3, §F4, §4.6; issue #32, WP4).
 *
 * The one click that carries tactical meaning is the drop point, so this is
 * the one click kept. A mouse previews the ring wherever it hovers; a finger
 * previews it wherever it is pressed, and lifting commits. Nothing here is a
 * drag: a press that travels is the camera's pan, and the scene's `YardInput`
 * already tells the two apart before {@link AttackInput.tap} is asked.
 *
 * ## Who owns a tap
 *
 * The scene mounts `YardInput` for hover and for the read-only building panel.
 * Rather than a second listener racing it on the same canvas — which would
 * also have to swallow the camera's `pointerup` — the scene asks
 * {@link ATTACK_TAP_CLAIMS} first, and the drop input takes a tap when it has
 * something to drop: a pending bomb or siege weapon, or a non-empty bucket
 * over open ground. A tap on a building with nothing pending still opens the
 * building's information, as it did before.
 *
 * ## The rules, and where they come from
 *
 * A fling centre may not overlap a building footprint: the fling-log contract
 * (`docs/design/server-combat.md` §3.10, `x`/`y` row) cites `DROPZONE.as:64`,
 * which is `BASE.BuildingOverlap` (`client/scripts/BASE.as:4964-4993`). That
 * test runs in isometric pixels — the `_mc.x/y` space, `toIso` of a yard
 * position — and approximates both the drop zone and every building as an
 * ellipse squashed by `BASE._angle` (0.8, `BASE.as:331`), overlapping when the
 * centres are closer than the two edge distances along the line between them
 * (`EllipseEdgeDistance`, `BASE.as:4995-5006`). Traps, destroyed buildings,
 * decorations and mushrooms are skipped (`DROPZONE.as` passes `true, true,
 * true`). The shared rules module carries no such test yet, so it is
 * transcribed here, function for function, and `AttackInput.test.ts` pins it.
 *
 * The drop zone's size is what the Flash client called `_size`: for a fling
 * `max(200, bucket / 4)`, twice the logged radius (`ATTACK.as:667-671`,
 * `dropRadius`); for a bomb its `radius` (`ResourceBombs.BombAdd`); for a
 * siege weapon its `range` at the attacker's level (`SIEGEWEAPONPOPUP.Target`).
 * Which side of the overlap test is legal depends on the tool's drop target
 * (`DROPZONE.Drop`, `:151-207`; `docs/specs/combat.md` §3 bomb and siege
 * tables): monsters and ground siege land clear, damage bombs and Jars must
 * touch a building, the Decoy only has to be clear within 30 px
 * (`SIEGEWEAPON_GROUND_SPECIAL_RADIUS`), and a putty bomb lands on the
 * attacker's own monsters.
 */

/* ── The overlap test ─────────────────────────────────────────────────────── */

/** `BASE._angle`: how much an isometric ellipse is squashed (`BASE.as:331`). */
export const ISO_SQUASH = 0.8;

/** The Decoy's clearance, `DROPZONE.SIEGEWEAPON_GROUND_SPECIAL_RADIUS`. */
export const DECOY_CLEARANCE = 30;

/**
 * `BASE.EllipseEdgeDistance`: how far from the centre of an ellipse of the
 * given full width and height its edge lies along `angle`.
 */
export const ellipseEdgeDistance = (angle: number, width: number, height: number): number => {
  const tan = Math.tan(angle);
  let x = Math.pow(Math.pow(width / 2, -2) + tan * tan * Math.pow(height / 2, -2), -0.5);
  const degrees = (angle * 180) / Math.PI;
  if (degrees < -90 || degrees > 90) x *= -1;
  const y = tan * x;
  return Math.sqrt(x * x + y * y);
};

/** A building as the overlap test sees it. */
export interface DropObstacle {
  readonly id: number;
  readonly type: number;
  /** Yard units, as `buildingdata.X/Y`. */
  readonly x: number;
  readonly y: number;
  /** The props `size`, `BFOUNDATION._size` (`BFOUNDATION.as:659`). */
  readonly size: number;
  /** Half the footprint height, `BFOUNDATION._middle` (`:678`). */
  readonly middle: number;
  readonly kind: ReturnType<typeof buildingClass>;
  readonly tower: boolean;
  /** Standing: at or above one health. */
  readonly alive: boolean;
}

/**
 * The yard's buildings as obstacles, with the ones at zero health marked.
 *
 * `destroyed` is the session's `destroyedIds`, so a building the battle has
 * flattened stops blocking the next drop, as `BuildingOverlap`'s health test
 * has it. A type without a props size falls back to its footprint width.
 */
export const obstaclesOf = (
  yard: Pick<Yard, "buildings">,
  destroyed: Iterable<number> = [],
): DropObstacle[] => {
  const down = new Set(destroyed);
  return yard.buildings.map((building) => ({
    id: building.id,
    type: building.type,
    x: building.x,
    y: building.y,
    size: propsSize(building.type) ?? building.footprint[0],
    middle: building.footprint[1] * 0.5,
    kind: buildingClass(building.type),
    tower: isTower(building.type),
    alive: !down.has(building.id) && (building.hp === null || building.hp > 0),
  }));
};

/** Whether `BuildingOverlap(…, true, true, true)` would even look at this one. */
const blocks = (obstacle: DropObstacle): boolean =>
  obstacle.alive && obstacle.kind !== "trap" && obstacle.kind !== "decoration";

/**
 * Every standing building a drop zone of `size` at `point` overlaps, in id
 * order. `point` is in yard units; the test is in isometric pixels.
 */
export const overlappingBuildings = (
  point: Point,
  size: number,
  obstacles: readonly DropObstacle[],
): DropObstacle[] => {
  const at = toIso(point.x, point.y);
  const hits: DropObstacle[] = [];
  for (const obstacle of obstacles) {
    if (!blocks(obstacle)) continue;
    const iso = toIso(obstacle.x, obstacle.y);
    const centreX = iso.x;
    const centreY = iso.y + obstacle.middle;
    const toObstacle = Math.atan2(at.y - centreY, at.x - centreX);
    const zoneEdge = ellipseEdgeDistance(toObstacle, size, size * ISO_SQUASH);
    const toPoint = Math.atan2(centreY - at.y, centreX - at.x);
    const buildingEdge = ellipseEdgeDistance(
      toPoint,
      obstacle.size * 0.5,
      obstacle.size * 0.5 * ISO_SQUASH,
    );
    const apart = Math.trunc(Math.hypot(at.x - centreX, at.y - centreY));
    if (apart < zoneEdge + buildingEdge) hits.push(obstacle);
  }
  return hits;
};

/* ── Siege weapons ────────────────────────────────────────────────────────── */

export type SiegeWeaponId = "decoy" | "vacuum" | "jars";

/** One of the three, as the Flash client's `SiegeWeapon` subclasses spell it. */
export interface SiegeWeaponSpec {
  readonly id: SiegeWeaponId;
  readonly name: string;
  /**
   * Drop-zone range by level, `RANGE` in `weapons/Decoy.as:55` and
   * `Jars.as:36`. The Vacuum has none (`Vacuum.as:26`): Flash fired it with no
   * drop zone at all, so the ring it gets here is a nominal clearance.
   */
  readonly range: readonly number[];
  /** What the drop has to satisfy (`docs/specs/combat.md` §3 siege table). */
  readonly target: "clear" | "clear-special" | "tower";
  readonly hint: string;
}

export const SIEGE_WEAPONS: readonly SiegeWeaponSpec[] = [
  {
    id: "decoy",
    name: "Decoy",
    range: [250, 270, 290, 310, 320, 350, 380, 410, 440, 480],
    target: "clear-special",
    hint: "Drop it on open ground; it draws bunker monsters out.",
  },
  {
    id: "vacuum",
    name: "Vacuum",
    range: [],
    target: "clear",
    hint: "Drop it clear of buildings; it loots as the battle runs.",
  },
  {
    id: "jars",
    name: "Jars",
    range: [200, 210, 235, 335, 360, 370, 380, 390, 400, 410],
    target: "tower",
    hint: "Drop it on a tower to jar it.",
  },
];

export const siegeWeapon = (id: string): SiegeWeaponSpec | undefined =>
  SIEGE_WEAPONS.find((weapon) => weapon.id === id);

/** A weapon's range at a level, or the nominal clearance where it has none. */
export const siegeRange = (weapon: SiegeWeaponSpec, level: number): number => {
  const index = Math.max(0, Math.min(weapon.range.length - 1, Math.floor(level) - 1));
  return weapon.range[index] ?? DECOY_CLEARANCE;
};

/** The attacker's stock of one weapon, from the `siege` save blob. */
export interface SiegeStock {
  readonly id: SiegeWeaponId;
  readonly level: number;
  readonly quantity: number;
}

/**
 * Reads `userSave.siege` — `{ decoy: { level, quantity }, … }`, what
 * `SiegeWeapons.exportWeapons` writes — tolerating anything else, since the
 * server stores it opaquely (`docs/server-api.md`, "Opaque JSON").
 */
export const parseSiegeStock = (raw: unknown): SiegeStock[] => {
  if (typeof raw !== "object" || raw === null) return [];
  const blob = raw as Record<string, unknown>;
  const stock: SiegeStock[] = [];
  for (const weapon of SIEGE_WEAPONS) {
    const entry = blob[weapon.id];
    if (typeof entry !== "object" || entry === null) continue;
    const { level, quantity } = entry as { level?: unknown; quantity?: unknown };
    const lvl = typeof level === "number" && Number.isFinite(level) ? Math.floor(level) : 0;
    const qty =
      typeof quantity === "number" && Number.isFinite(quantity) ? Math.floor(quantity) : 0;
    if (lvl <= 0) continue;
    stock.push({ id: weapon.id, level: lvl, quantity: Math.max(0, qty) });
  }
  return stock;
};

/* ── Tools ────────────────────────────────────────────────────────────────── */

/** What the next tap drops. `fling` is the bucket; the others are pending picks. */
export type DropTool =
  | { readonly kind: "fling" }
  | { readonly kind: "bomb"; readonly bomb: BombStats }
  | { readonly kind: "siege"; readonly weapon: SiegeWeaponSpec; readonly level: number };

/** The drop zone a tool raises: its Flash `_size`, and what it must satisfy. */
export interface DropZone {
  readonly size: number;
  readonly target: "ground" | "buildings" | "monsters" | "clear-special" | "tower";
}

/** `ATTACK.DropZone`'s arguments for a tool (`ATTACK.as:667-672`, `ResourceBombs.as:274-280`). */
export const dropZoneOf = (tool: DropTool, bucketRadius: number): DropZone => {
  switch (tool.kind) {
    case "fling":
      return { size: bucketRadius * 2, target: "ground" };
    case "bomb":
      return { size: tool.bomb.radius, target: tool.bomb.resource === 3 ? "monsters" : "buildings" };
    case "siege":
      return {
        size: siegeRange(tool.weapon, tool.level),
        target:
          tool.weapon.target === "tower"
            ? "tower"
            : tool.weapon.target === "clear-special"
              ? "clear-special"
              : "ground",
      };
  }
};

/** What the yard has to say about a drop point. */
export interface DropVerdict {
  readonly legal: boolean;
  /** Why not, in the player's terms; empty when legal. */
  readonly reason: string;
  /** The buildings the zone touches, for a target that wants one. */
  readonly touching: readonly DropObstacle[];
}

/** `DROPZONE.Drop`'s switch, one case per drop target. */
export const judgeDrop = (
  zone: DropZone,
  point: Point,
  obstacles: readonly DropObstacle[],
  creepsAlive: number,
): DropVerdict => {
  switch (zone.target) {
    case "ground": {
      const touching = overlappingBuildings(point, zone.size, obstacles);
      return touching.length === 0
        ? { legal: true, reason: "", touching }
        : { legal: false, reason: "Too close to a building. Drop on open ground.", touching };
    }
    case "clear-special": {
      const touching = overlappingBuildings(point, DECOY_CLEARANCE, obstacles);
      return touching.length === 0
        ? { legal: true, reason: "", touching }
        : { legal: false, reason: "Too close to a building. Drop on open ground.", touching };
    }
    case "buildings": {
      const touching = overlappingBuildings(point, zone.size, obstacles);
      return touching.length > 0
        ? { legal: true, reason: "", touching }
        : { legal: false, reason: "A bomb has to land on a building.", touching };
    }
    case "tower": {
      const touching = overlappingBuildings(point, zone.size, obstacles).filter(
        (obstacle) => obstacle.tower,
      );
      return touching.length > 0
        ? { legal: true, reason: "", touching }
        : { legal: false, reason: "Jars have to land on a tower.", touching };
    }
    case "monsters":
      // `CREEPS.CreepOverlap` wants a creep under the zone; the engine keeps
      // its creeps to itself, so the field only has to be non-empty.
      return creepsAlive > 0
        ? { legal: true, reason: "", touching: [] }
        : { legal: false, reason: "A putty bomb lands on your own monsters; none are on the field.", touching: [] };
  }
};

/* ── The tool count the session ends on ───────────────────────────────────── */

/** What the pickers know, for the count the session's `exhausted` rule reads. */
export interface ToolInventory {
  readonly catapultLevel: number;
  /** The attacker's pool, or null when it could not be read (then no bomb is buyable). */
  readonly pool: { readonly r1: number; readonly r2: number; readonly r3: number } | null;
  /** Resources whose bomb was already fired this attack (one per resource). */
  readonly bombsUsed: ReadonlySet<number>;
  readonly creepsAlive: number;
  readonly siege: readonly SiegeStock[];
  readonly siegeUsed: Readonly<Partial<Record<SiegeWeaponId, number>>>;
}

/** The bombs the attacker could fire now: unlocked, unfired, affordable, and for putty, with a target. */
export const usableBombs = (inventory: ToolInventory): BombStats[] => {
  const pool = inventory.pool;
  if (!pool) return [];
  return BOMBS.filter((bomb) => {
    if (bomb.catapultLevel > inventory.catapultLevel) return false;
    if (inventory.bombsUsed.has(bomb.resource)) return false;
    if (bomb.resource === 3 && inventory.creepsAlive <= 0) return false;
    const have = bomb.resource === 1 ? pool.r1 : bomb.resource === 2 ? pool.r2 : pool.r3;
    return have >= bomb.cost;
  });
};

/** Siege weapons left, by id, after what was fired. */
export const siegeLeft = (inventory: ToolInventory): Record<SiegeWeaponId, number> => {
  const left: Record<SiegeWeaponId, number> = { decoy: 0, vacuum: 0, jars: 0 };
  for (const stock of inventory.siege) {
    left[stock.id] = Math.max(0, stock.quantity - (inventory.siegeUsed[stock.id] ?? 0));
  }
  return left;
};

/**
 * What `AttackSession.setUnusedTools` should hear: one per resource whose bomb
 * could still be fired, plus every siege weapon left. A putty bomb counts only
 * while something is on the field to buff, so an empty field with nothing
 * left to send still ends the attack (§F6).
 */
export const unusedToolCount = (inventory: ToolInventory): number => {
  const resources = new Set(usableBombs(inventory).map((bomb) => bomb.resource));
  const siege = Object.values(siegeLeft(inventory)).reduce((sum, count) => sum + count, 0);
  return resources.size + siege;
};

/* ── The input ────────────────────────────────────────────────────────────── */

/** The ring to draw, or null to hide it. */
export interface DropPreview {
  readonly tool: DropTool;
  /** Yard units. */
  readonly x: number;
  readonly y: number;
  readonly zone: DropZone;
  readonly legal: boolean;
}

/**
 * Who is asked about a tap on the enemy yard before the scene selects a
 * building. Each claim gets the building under the tap, or null on open
 * ground; the first to return true has taken the tap. The attack scene
 * consults this from its `YardInput.onSelect`.
 */
export const ATTACK_TAP_CLAIMS: Array<(building: YardBuilding | null) => boolean> = [];

export interface AttackInputOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: Camera;
  readonly renderer: Pick<YardRenderer, "worldToYard">;
  readonly yard: Pick<Yard, "buildings">;
  readonly session: AttackSession;
  readonly bucket: Bucket;
  /** Redraws the ring; null hides it. */
  readonly onPreview: (preview: DropPreview | null) => void;
  /** A refused tap, in the player's words. */
  readonly onRefuse?: (reason: string) => void;
  /** After a pending bomb or siege weapon was dropped. */
  readonly onToolUsed?: (tool: Exclude<DropTool, { kind: "fling" }>) => void;
  /** The pending tool changed (picked, dropped, or cancelled). */
  readonly onToolChange?: (tool: DropTool | null) => void;
  /** Keyboard `B` and `S`. */
  readonly onOpenCatapult?: () => void;
  readonly onOpenSiege?: () => void;
}

export class AttackInput {
  private readonly options: AttackInputOptions;
  private pending: Exclude<DropTool, { kind: "fling" }> | null = null;
  /** The last pointer position over the canvas, in yard units. */
  private pointer: Point | null = null;
  private pressed = false;
  private touchPress = false;
  private readonly claim = (building: YardBuilding | null): boolean => this.tap(building);
  private unsubscribeBucket: (() => void) | null = null;
  private obstacles: DropObstacle[] | null = null;
  private obstaclesFor = -1;

  constructor(options: AttackInputOptions) {
    this.options = options;
  }

  attach(): void {
    const canvas = this.options.canvas;
    // Capture, so the position is known before the scene's own `pointerup`
    // asks the claims; nothing is stopped, so the camera still hears it.
    canvas.addEventListener("pointerdown", this.onPointerDown, true);
    canvas.addEventListener("pointermove", this.onPointerMove, true);
    canvas.addEventListener("pointerup", this.onPointerUp, true);
    canvas.addEventListener("pointercancel", this.onPointerCancel, true);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    ATTACK_TAP_CLAIMS.unshift(this.claim);
    this.unsubscribeBucket = this.options.bucket.subscribe(() => this.refreshPreview());
  }

  detach(): void {
    const canvas = this.options.canvas;
    canvas.removeEventListener("pointerdown", this.onPointerDown, true);
    canvas.removeEventListener("pointermove", this.onPointerMove, true);
    canvas.removeEventListener("pointerup", this.onPointerUp, true);
    canvas.removeEventListener("pointercancel", this.onPointerCancel, true);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    const at = ATTACK_TAP_CLAIMS.indexOf(this.claim);
    if (at >= 0) ATTACK_TAP_CLAIMS.splice(at, 1);
    this.unsubscribeBucket?.();
    this.unsubscribeBucket = null;
    this.options.onPreview(null);
  }

  /* ── Tools ──────────────────────────────────────────────────────────── */

  /** The pending bomb or siege weapon, or null when the next tap flings. */
  pendingTool(): Exclude<DropTool, { kind: "fling" }> | null {
    return this.pending;
  }

  /** What the next tap would drop. */
  tool(): DropTool {
    return this.pending ?? { kind: "fling" };
  }

  /** Arms a bomb or siege weapon, or clears the pick with null. */
  setTool(tool: Exclude<DropTool, { kind: "fling" }> | null): void {
    if (tool === this.pending) return;
    this.pending = tool;
    this.options.onToolChange?.(tool);
    this.refreshPreview();
  }

  /** The drop zone the next tap raises. */
  zone(): DropZone {
    return dropZoneOf(this.tool(), this.options.bucket.radius());
  }

  /** The verdict on a yard point for the current tool. */
  judge(point: Point): DropVerdict {
    const session = this.options.session;
    const battle = session.battle()?.state();
    const destroyed = battle?.destroyedIds ?? [];
    // The obstacle list changes only when the battle flattens something.
    if (!this.obstacles || this.obstaclesFor !== destroyed.length) {
      this.obstacles = obstaclesOf(this.options.yard, destroyed);
      this.obstaclesFor = destroyed.length;
    }
    return judgeDrop(this.zone(), point, this.obstacles, battle?.creepsAlive ?? 0);
  }

  /* ── Taps ───────────────────────────────────────────────────────────── */

  /**
   * A tap at the last pointer position, over `building` or open ground.
   * Returns whether the drop input took it; false leaves it to the scene.
   */
  tap(building: YardBuilding | null): boolean {
    const point = this.pointer;
    if (!point) return false;
    return this.tapAt(point, building);
  }

  /** {@link tap} at an explicit yard point. */
  tapAt(point: Point, building: YardBuilding | null): boolean {
    const { session, bucket } = this.options;
    const phase = session.state().phase;
    if (phase !== "loaded" && phase !== "running") return false;

    const pending = this.pending;
    if (pending) {
      const verdict = this.judge(point);
      if (!verdict.legal) {
        this.options.onRefuse?.(verdict.reason);
        return true;
      }
      try {
        if (pending.kind === "bomb") {
          session.appendBomb({ x: point.x, y: point.y, id: pending.bomb.id });
        } else {
          session.appendSiege({ x: point.x, y: point.y, weapon: pending.weapon.id });
        }
      } catch (caught) {
        this.options.onRefuse?.(caught instanceof Error ? caught.message : "That could not be dropped.");
        return true;
      }
      this.setTool(null);
      this.options.onToolUsed?.(pending);
      return true;
    }

    if (bucket.isEmpty() || building) return false;

    const verdict = this.judge(point);
    if (!verdict.legal) {
      this.options.onRefuse?.(verdict.reason);
      return true;
    }
    try {
      session.appendFling({ ...bucket.composition(), x: point.x, y: point.y });
    } catch (caught) {
      this.options.onRefuse?.(caught instanceof Error ? caught.message : "That could not be sent.");
      return true;
    }
    bucket.afterDrop();
    this.refreshPreview();
    return true;
  }

  /** Cancels a pending tool. Returns whether there was one. */
  cancel(): boolean {
    if (!this.pending) return false;
    this.setTool(null);
    return true;
  }

  /* ── The preview ────────────────────────────────────────────────────── */

  /** The yard point under a pointer event. */
  yardAt(event: { clientX: number; clientY: number }): Point {
    const rect = this.options.canvas.getBoundingClientRect();
    const world = this.options.camera.screenToWorld({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    return this.options.renderer.worldToYard(world.x, world.y);
  }

  /** Whether the ring is worth showing: something to drop, and an attack to drop it in. */
  private showing(): boolean {
    const phase = this.options.session.state().phase;
    if (phase !== "loaded" && phase !== "running") return false;
    return this.pending !== null || !this.options.bucket.isEmpty();
  }

  private refreshPreview(): void {
    const point = this.pointer;
    if (!point || !this.showing()) {
      this.options.onPreview(null);
      return;
    }
    // A finger shows the ring only while it is down (§4.6); a mouse always.
    if (this.touchPress && !this.pressed) {
      this.options.onPreview(null);
      return;
    }
    const tool = this.tool();
    const zone = this.zone();
    this.options.onPreview({
      tool,
      x: point.x,
      y: point.y,
      zone,
      legal: this.judge(point).legal,
    });
  }

  /* ── Events ─────────────────────────────────────────────────────────── */

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.pressed = true;
    this.touchPress = event.pointerType !== "mouse";
    this.pointer = this.yardAt(event);
    this.refreshPreview();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const touch = event.pointerType !== "mouse";
    if (touch && !this.pressed) return;
    this.touchPress = touch;
    this.pointer = this.yardAt(event);
    this.refreshPreview();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pressed) return;
    this.pointer = this.yardAt(event);
    this.pressed = false;
    // The scene's `pointerup` runs next and asks the claims; a finger's ring
    // goes with the release either way, a mouse's stays.
    if (this.touchPress) this.options.onPreview(null);
  };

  private readonly onPointerCancel = (): void => {
    this.pressed = false;
    if (this.touchPress) this.options.onPreview(null);
  };

  private readonly onPointerLeave = (): void => {
    this.pressed = false;
    this.pointer = null;
    this.options.onPreview(null);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (!this.pending) return;
    event.preventDefault();
    this.cancel();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTextEntry(event.target)) return;
    switch (event.key) {
      case "b":
      case "B":
        this.options.onOpenCatapult?.();
        break;
      case "s":
      case "S":
        this.options.onOpenSiege?.();
        break;
      case "Escape":
        this.cancel();
        break;
      default:
        break;
    }
  };
}

const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
};
