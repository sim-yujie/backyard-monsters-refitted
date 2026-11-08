import { Rectangle, Sprite, Texture, type Container } from "pixi.js";
import { MUSHROOM_POP_SECONDS, mushroomPopScale } from "./mushroomPop";
import { mushroomKey } from "./mushroomPick";
import { loadWithRetries } from "./retryLoad";
import { THANKSGIVING_ART } from "./thanksgivingSkin";
import {
  FRAME,
  freeSpotNear,
  holdTurkey,
  newTurkey,
  stepTurkey,
  turkeyAreaOf,
  turkeyFrame,
  type TurkeyArea,
  type TurkeyState,
} from "./turkeyWalk";
import { depthKey, yardToWorld, type YardBounds } from "./YardGrid";
import type { Yard, YardMushroom } from "./yardModel";

/**
 * The Thanksgiving turkeys on the yard (`turkeyWalk.ts` for how they roam):
 * one per mushroom the server grew, wandering near its spot, picked like a
 * mushroom. A pick flaps it (held), and its landing pops it: it hops up and
 * fades. When the pick rolled golden it turns gold, hops, swells once at the
 * top and fades more slowly, and the golden popup waits for it to finish
 * ({@link GOLDEN_POP_SECONDS}).
 *
 * Cheap on purpose (owner plays Firefox; phones): at most one sprite per
 * mushroom, which the server caps at 10, plus a short-lived pop; no filters;
 * a sprite's depth key is re-set only when it moves a whole pixel down or
 * across; nothing moves while the page is hidden, and a long frame after a
 * hidden spell is cut short rather than jumping the turkeys across the yard.
 */

/** The strips: 6 frames each, @2x (`art-samples/thanksgiving/build_art.py`). */
const WALK_ART = `${THANKSGIVING_ART}turkey.png`;
const GOLDEN_ART = `${THANKSGIVING_ART}turkey-golden.png`;
const FRAME_W = 112;
const FRAME_H = 104;
const FRAMES = 6;

/** The strips are @2x; a turkey stands about 47 world px tall, a bit bigger than a pumpkin. */
export const TURKEY_SCALE = 0.45;

/** A mushroom's ground, yard units: a turkey's home is its middle. */
const MUSHROOM_GROUND = 30;

/** The longest frame the turkeys take in one step, seconds. */
const MAX_STEP = 0.1;

/**
 * How often the ground the buildings' art covers is measured again, seconds:
 * pictures arrive after the yard is shown, and a building can go up a level.
 */
const AREA_REFRESH_SECONDS = 1;

/** How long a pop lasts, seconds. */
export const POP_SECONDS = 0.7;

/**
 * How long a golden pop lasts, seconds: long enough to be seen before the
 * golden popup and its dimmer cover the yard (`YardScene` waits this long).
 */
export const GOLDEN_POP_SECONDS = 1;

/**
 * The tap box around a turkey's feet, world px: a little bigger than the
 * drawn bird (about 50 x 47) so a finger finds a moving one.
 */
const HIT = { left: 28, right: 28, top: 50, bottom: 10 } as const;

interface Walker {
  readonly mushroom: YardMushroom;
  readonly state: TurkeyState;
  readonly sprite: Sprite;
  /** Seconds into its pop-in, while it grows in. */
  growing: number | null;
  /** The last whole world pixel its depth key was set for. */
  depthAt: string;
}

interface Pop {
  readonly sprite: Sprite;
  readonly golden: boolean;
  readonly x: number;
  readonly y: number;
  readonly facing: 1 | -1;
  elapsed: number;
}

/** Where to hang the sprites: the buildings' depth-sorted layer (`YardBuildings.addGuest`). */
export interface TurkeyStage {
  addGuest(child: Container): void;
  removeGuest(child: Container): void;
  /** By building id, how far its art rises above its footprint, world px (`YardBuildings.artRises`). */
  artRises?(): ReadonlyMap<number, number>;
}

const isHidden = (): boolean => typeof document !== "undefined" && document.hidden;

export class YardTurkeys {
  private walk: Texture[] | null = null;
  private golden: Texture[] | null = null;
  private loading: Promise<boolean> | null = null;
  private readonly walkers = new Map<string, Walker>();
  /** Where turkeys stood when their mushroom left the yard: a pick's pop starts there. */
  private gone = new Map<string, { x: number; y: number; facing: 1 | -1 }>();
  private readonly pops: Pop[] = [];
  private area: TurkeyArea | null = null;
  /** The yard the area was measured for, to measure it again. */
  private yard: Yard | null = null;
  /** Seconds since the area was last measured. */
  private areaAge = 0;
  private bounds: YardBounds | null = null;
  private destroyed = false;

  constructor(
    private readonly stage: TurkeyStage,
    private readonly random: () => number = Math.random,
  ) {}

  /** Whether the pictures are in, so turkeys can stand in for mushrooms. */
  get ready(): boolean {
    return this.walk !== null;
  }

  /** How many turkeys are on the yard. */
  get count(): number {
    return this.walkers.size;
  }

  /** Fetches both strips (the yard's five tries each). Resolves whether they arrived. */
  load(): Promise<boolean> {
    this.loading ??= Promise.all([
      loadWithRetries(WALK_ART, () => this.destroyed),
      loadWithRetries(GOLDEN_ART, () => this.destroyed),
    ]).then(
      ([walk, golden]) => {
        if (this.destroyed) return false;
        this.walk = framesOf(walk);
        this.golden = framesOf(golden);
        return true;
      },
      (caught: unknown) => {
        console.warn("The Thanksgiving turkeys did not load; mushrooms stay.", caught);
        this.loading = null;
        return false;
      },
    );
    return this.loading;
  }

  /**
   * Puts a turkey on every mushroom of `yard`. A turkey already roaming for a
   * mushroom that is still there keeps walking from where it is; one whose
   * mushroom is gone leaves (its spot remembered for a pop). `fresh` keys grow
   * in, as a new mushroom pops up.
   */
  sync(yard: Yard, fresh: ReadonlySet<string> = new Set()): void {
    const walk = this.walk;
    if (!walk) return;
    this.yard = yard;
    this.measure();
    this.bounds = yard.bounds;
    const area = this.area!;
    const keys = new Set<string>();
    for (const mushroom of yard.mushrooms) {
      const key = mushroomKey(mushroom);
      keys.add(key);
      const known = this.walkers.get(key);
      if (known) {
        // The redraw emptied the layer; stand it back among the buildings.
        this.stage.addGuest(known.sprite);
        continue;
      }
      const state = newTurkey(mushroom.x + MUSHROOM_GROUND / 2, mushroom.y + MUSHROOM_GROUND / 2, this.random);
      // A mushroom behind a building: its turkey starts on open ground near it.
      const start = freeSpotNear(area, state.x, state.y);
      state.x = state.targetX = start.x;
      state.y = state.targetY = start.y;
      const sprite = new Sprite(walk[FRAME.stand]);
      sprite.anchor.set(0.5, 0.97);
      sprite.eventMode = "none";
      const walker: Walker = { mushroom, state, sprite, growing: fresh.has(key) ? 0 : null, depthAt: "" };
      this.place(walker);
      this.stage.addGuest(sprite);
      this.walkers.set(key, walker);
    }
    const gone = new Map<string, { x: number; y: number; facing: 1 | -1 }>();
    for (const [key, walker] of this.walkers) {
      if (keys.has(key)) continue;
      gone.set(key, { x: walker.sprite.x, y: walker.sprite.y, facing: walker.state.facing });
      this.drop(walker);
      this.walkers.delete(key);
    }
    this.gone = gone;
  }

  /** Moves every turkey and pop on by `seconds` (a frame). Nothing moves while the page is hidden. */
  update(seconds: number): void {
    if (isHidden()) return;
    const step = Math.min(Math.max(seconds, 0), MAX_STEP);
    this.areaAge += step;
    if (this.areaAge >= AREA_REFRESH_SECONDS && this.walkers.size > 0) this.measure();
    const area = this.area;
    if (area) {
      for (const walker of this.walkers.values()) {
        stepTurkey(walker.state, step, area, this.random);
        if (walker.growing !== null) {
          walker.growing += step;
          if (walker.growing >= MUSHROOM_POP_SECONDS) walker.growing = null;
        }
        this.place(walker);
      }
    }
    this.runPops(step);
  }

  /** The mushroom whose turkey is under a world point, frontmost first, or null. */
  at(worldX: number, worldY: number): YardMushroom | null {
    let front: Walker | null = null;
    for (const walker of this.walkers.values()) {
      const dx = worldX - walker.sprite.x;
      const dy = worldY - walker.sprite.y;
      const hit = dx >= -HIT.left && dx <= HIT.right && dy >= -HIT.top && dy <= HIT.bottom;
      if (hit && (!front || walker.sprite.zIndex > front.sprite.zIndex)) front = walker;
    }
    return front?.mushroom ?? null;
  }

  /** Holds the turkey for a spot still (flapping) while it is picked, or lets it go. */
  hold(spot: Pick<YardMushroom, "x" | "y">, on: boolean): void {
    const walker = this.walkers.get(mushroomKey(spot));
    if (walker) holdTurkey(walker.state, on);
  }

  /** A pick landed: the turkey for a spot hops up and fades where it stood, gold if `golden`. */
  pop(spot: Pick<YardMushroom, "x" | "y">, golden: boolean): void {
    const frames = golden ? this.golden : this.walk;
    if (!frames) return;
    const key = mushroomKey(spot);
    const walker = this.walkers.get(key);
    const where = walker
      ? { x: walker.sprite.x, y: walker.sprite.y, facing: walker.state.facing }
      : this.gone.get(key);
    if (!where) return;
    if (walker) walker.sprite.visible = false;
    const sprite = new Sprite(frames[FRAME.hop]);
    sprite.anchor.set(0.5, 0.97);
    sprite.eventMode = "none";
    sprite.position.set(where.x, where.y);
    sprite.scale.set(TURKEY_SCALE * where.facing, TURKEY_SCALE);
    // In front of whatever is round it: it is leaping out.
    sprite.zIndex = depthKey(where.x, where.y + 40, 999) * 8;
    this.stage.addGuest(sprite);
    this.pops.push({ sprite, golden, x: where.x, y: where.y, facing: where.facing, elapsed: 0 });
  }

  /** Takes every turkey and pop off the yard (e.g. Thanksgiving is over). */
  clear(): void {
    for (const walker of this.walkers.values()) this.drop(walker);
    this.walkers.clear();
    for (const pop of this.pops) this.dropSprite(pop.sprite);
    this.pops.length = 0;
    this.gone.clear();
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
  }

  /** Measures where turkeys may walk: the plot, the buildings and the ground their art hides. */
  private measure(): void {
    this.areaAge = 0;
    if (this.yard) this.area = turkeyAreaOf(this.yard, this.stage.artRises?.());
  }

  private place(walker: Walker): void {
    const bounds = this.bounds;
    if (!bounds) return;
    const { state, sprite } = walker;
    const world = yardToWorld(bounds, state.x, state.y);
    sprite.position.set(world.x, world.y);
    const frames = this.walk;
    if (frames) sprite.texture = frames[turkeyFrame(state)] ?? frames[FRAME.stand]!;
    const grow = walker.growing === null ? 1 : mushroomPopScale(walker.growing);
    sprite.scale.set(TURKEY_SCALE * grow * state.facing, TURKEY_SCALE * grow);
    // Re-sorting the building layer only when the turkey has moved a pixel.
    const at = `${world.x},${world.y}`;
    if (at !== walker.depthAt) {
      walker.depthAt = at;
      sprite.zIndex = depthKey(world.x, world.y, walker.mushroom.id) * 8;
    }
  }

  private runPops(seconds: number): void {
    for (let index = this.pops.length - 1; index >= 0; index--) {
      const pop = this.pops[index]!;
      pop.elapsed += seconds;
      const t = Math.min(1, pop.elapsed / (pop.golden ? GOLDEN_POP_SECONDS : POP_SECONDS));
      const look = popLook(t, pop.golden);
      pop.sprite.position.set(pop.x, pop.y - look.rise);
      pop.sprite.scale.set(TURKEY_SCALE * look.grow * pop.facing, TURKEY_SCALE * look.grow);
      pop.sprite.alpha = look.alpha;
      if (t >= 1) {
        this.dropSprite(pop.sprite);
        this.pops.splice(index, 1);
      }
    }
  }

  private drop(walker: Walker): void {
    this.dropSprite(walker.sprite);
  }

  private dropSprite(sprite: Sprite): void {
    this.stage.removeGuest(sprite);
    sprite.destroy();
  }
}

/**
 * A pop's look `t` of the way through (0..1): how far up (world px), how
 * big, how solid. An ordinary one goes up in an arc, a little bigger, fading
 * over the second half. A golden one is up by 40%, swells once while it hangs
 * there, and fades only over the last quarter.
 */
export const popLook = (t: number, golden: boolean): { rise: number; grow: number; alpha: number } => {
  if (!golden) {
    return {
      rise: Math.sin(t * Math.PI * 0.5) * 34,
      grow: 1 + 0.35 * t,
      alpha: t < 0.5 ? 1 : 1 - (t - 0.5) * 2,
    };
  }
  const up = Math.min(1, t / 0.4);
  const hang = t <= 0.4 ? 0 : Math.min(1, (t - 0.4) / 0.35);
  return {
    rise: Math.sin(up * Math.PI * 0.5) * 40,
    grow: 1 + 0.35 * up + 0.2 * Math.sin(hang * Math.PI),
    alpha: t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) * 4),
  };
};

/** The six frames of a strip, sharing its picture. */
const framesOf = (strip: Texture): Texture[] =>
  Array.from(
    { length: FRAMES },
    (_, index) => new Texture({ source: strip.source, frame: new Rectangle(index * FRAME_W, 0, FRAME_W, FRAME_H) }),
  );
