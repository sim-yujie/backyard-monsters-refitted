import { Container, Sprite } from "pixi.js";
import { MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { anchorOffset, frameRow, sheetColumn, spriteFor } from "@/game/attack/monsterSprites";
import { boxAround, type RaidHost } from "./StagedRaidLayer";
import type { YardPoint } from "./stagedRaid";

/**
 * New monsters walking into the yard to their Housing (issue #227): Bob's 15
 * free Pokeys in the guided start (`docs/design/tutorial.md` §2.3 step 8),
 * and, for the Goals package, a monster reward arriving. Drawing only: the
 * server has already housed them.
 *
 * They start in a loose line past `from` and walk to `to`, then fade there,
 * as if going in. Ends by itself; {@link destroy} takes it down early.
 */

/** Yard units a second. */
const SPEED = 110;
/** Seconds between one monster setting off and the next. */
const STAGGER = 0.18;
/** Seconds a monster takes to fade at the door. */
const FADE = 0.35;
const TICKS_PER_SECOND = 80;

export interface WalkInOptions {
  /** Monster id, e.g. `C1`. */
  readonly monster: string;
  /** How many walk in (a few at most are drawn; the rest is implied). */
  readonly count: number;
  /** Where they come from: the yard's edge. */
  readonly from: YardPoint;
  /** The Housing's centre. */
  readonly to: YardPoint;
  /** Called once when the last has gone in. */
  readonly onEnd?: () => void;
}

/** The most drawn at once; more read as a crowd anyway. */
export const MAX_WALKERS = 15;

/** Where walker `index` is `t` seconds in, and whether it has gone in. */
export const walkerAt = (
  options: Pick<WalkInOptions, "from" | "to">,
  index: number,
  t: number,
): { x: number; y: number; alpha: number; done: boolean; heading: number } => {
  const dx = options.to.x - options.from.x;
  const dy = options.to.y - options.from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // A loose column: each one a little to the side of the line.
  const side = ((index % 3) - 1) * 18;
  const start = { x: options.from.x - uy * side, y: options.from.y + ux * side };
  const walked = Math.max(0, t - index * STAGGER) * SPEED;
  const travel = Math.hypot(options.to.x - start.x, options.to.y - start.y);
  const along = Math.min(walked, travel);
  const k = travel > 0 ? along / travel : 1;
  const over = Math.max(0, walked - travel) / SPEED;
  return {
    x: start.x + (options.to.x - start.x) * k,
    y: start.y + (options.to.y - start.y) * k,
    alpha: over <= 0 ? 1 : Math.max(0, 1 - over / FADE),
    done: over >= FADE,
    heading: Math.atan2(uy, ux),
  };
};

export class MonsterWalkIn {
  private readonly root = new Container();
  private readonly sprites: Sprite[] = [];
  private readonly textures = new MonsterSheetTextures();
  private frame: number | null = null;
  private started: number | null = null;
  private ended = false;

  constructor(
    private readonly host: RaidHost,
    private readonly options: WalkInOptions,
  ) {
    this.root.eventMode = "none";
    this.root.sortableChildren = true;
    host.root.addChild(this.root);
    const sheet = spriteFor(options.monster);
    if (sheet) this.textures.preload(sheet);
  }

  /** The world rectangle the walk crosses, for Bob's spotlight (fixed for the walk). */
  worldBox(): { x: number; y: number; width: number; height: number } | null {
    if (this.ended) return null;
    const { from, to } = this.options;
    return boxAround([this.host.yardToWorld(from.x, from.y), this.host.yardToWorld(to.x, to.y)], 60);
  }

  start(): void {
    if (this.frame !== null || this.ended) return;
    const shown = Math.max(1, Math.min(MAX_WALKERS, this.options.count));
    const sheet = spriteFor(this.options.monster);
    const step = (time: number): void => {
      this.started ??= time;
      const t = (time - this.started) / 1000;
      let all = true;
      for (let index = 0; index < shown; index++) {
        const at = walkerAt(this.options, index, t);
        if (!at.done) all = false;
        let sprite = this.sprites[index];
        if (!sheet) continue;
        const ground = this.host.yardToWorld(at.x, at.y);
        const ahead = this.host.yardToWorld(at.x + Math.cos(at.heading) * 10, at.y + Math.sin(at.heading) * 10);
        const column = sheetColumn(sheet, Math.atan2(ahead.y - ground.y, ahead.x - ground.x));
        const texture = this.textures.frame(sheet, column, frameRow(sheet, "walk", Math.floor(t * TICKS_PER_SECOND)));
        if (!texture) continue;
        if (!sprite) {
          sprite = new Sprite(texture);
          this.sprites[index] = sprite;
          this.root.addChild(sprite);
        }
        const anchor = anchorOffset(sheet);
        sprite.texture = texture;
        sprite.position.set(ground.x + anchor.x, ground.y + anchor.y);
        sprite.zIndex = ground.y;
        sprite.alpha = at.alpha;
        // Not yet set off: still off the edge, not drawn.
        sprite.visible = t >= index * STAGGER && !at.done;
      }
      if (all) {
        this.frame = null;
        this.finish();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.ended = true;
    this.root.parent?.removeChild(this.root);
    this.root.destroy({ children: true });
    this.textures.destroy();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.root.visible = false;
    this.options.onEnd?.();
  }
}
