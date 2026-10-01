import { Container, Graphics, Sprite } from "pixi.js";
import { MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { anchorOffset, frameRow, sheetColumn, spriteFor } from "@/game/attack/monsterSprites";
import {
  DEATH_SECONDS,
  planRaid,
  raidAt,
  RAID_MONSTER,
  type RaidFrame,
  type RaidPlan,
  type YardPoint,
} from "./stagedRaid";

/**
 * Draws the guided start's staged raid (issue #227, `docs/design/tutorial.md`
 * §4) on the own yard: the oozes from the original sprite sheet, the tower's
 * tracer and the death puffs, on a container of its own above the yard.
 *
 * It reads the tower's position and nothing else: no engine, no save, no
 * route. The timeline is `stagedRaid.ts`; this only paints it, frame by frame,
 * until {@link onEnd}. A reload during the raid starts it again.
 */

/** Where the layer draws and how it turns yard units into world px. */
export interface RaidHost {
  readonly root: Container;
  yardToWorld(x: number, y: number): { x: number; y: number };
}

/** How high above its ground point the tower fires from, world px. */
const MUZZLE_HEIGHT = 58;
/** The tracer and puff colours: the attack screen's shot yellow and a dust grey. */
const TRACER = 0xfff2a8;
const PUFF = 0xe8e2d0;
/** Animation ticks a second (the engine's 80, as the sheets are timed). */
const TICKS_PER_SECOND = 80;
/** World px around the raid's points, for the sprites and the tower's top. */
const BOX_MARGIN = 70;

/** The smallest rectangle round some world points, grown by `margin`. */
export const boxAround = (
  points: readonly { x: number; y: number }[],
  margin: number,
): { x: number; y: number; width: number; height: number } => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return { x, y, width: Math.max(...xs) + margin - x, height: Math.max(...ys) + margin - y };
};

export class StagedRaidLayer {
  private readonly root = new Container();
  private readonly bodies = new Container();
  private readonly effects = new Graphics();
  private readonly sprites = new Map<number, Sprite>();
  private readonly textures = new MonsterSheetTextures();
  private readonly plan: RaidPlan;
  private frame: number | null = null;
  private started: number | null = null;
  private ended = false;

  /**
   * @param host - The yard renderer (its root and `yardToWorld`).
   * @param tower - The Sniper Tower's centre, yard units.
   * @param hall - The Town Hall's centre, or null.
   * @param onEnd - Called once, when the last ooze is gone.
   */
  constructor(
    private readonly host: RaidHost,
    tower: YardPoint,
    hall: YardPoint | null,
    private readonly onEnd: () => void,
  ) {
    this.plan = planRaid(tower, hall);
    this.root.eventMode = "none";
    this.bodies.sortableChildren = true;
    this.root.addChild(this.bodies, this.effects);
    host.root.addChild(this.root);
    const sheet = spriteFor(RAID_MONSTER);
    if (sheet) this.textures.preload(sheet);
  }

  /** Starts the clock. */
  start(): void {
    if (this.frame !== null || this.ended) return;
    const step = (time: number): void => {
      this.started ??= time;
      const t = (time - this.started) / 1000;
      const frame = raidAt(this.plan, t);
      this.draw(frame, t);
      if (frame.over) {
        this.frame = null;
        this.finish();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /**
   * The world rectangle the raid plays in (the tower and every spawn point,
   * with room for the sprites), fixed for the raid, so Bob's spotlight can
   * leave it undimmed and still while the oozes cross it.
   */
  worldBox(): { x: number; y: number; width: number; height: number } {
    const points = [this.plan.tower, ...this.plan.monsters.map((monster) => monster.spawn)].map((point) =>
      this.host.yardToWorld(point.x, point.y),
    );
    return boxAround(points, BOX_MARGIN);
  }

  /** Ends it now (Skip): it still counts as watched. */
  skip(): void {
    this.finish();
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
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.root.visible = false;
    this.onEnd();
  }

  private draw(frame: RaidFrame, t: number): void {
    const sheet = spriteFor(RAID_MONSTER);
    const g = this.effects;
    g.clear();
    const tower = this.host.yardToWorld(this.plan.tower.x, this.plan.tower.y);
    const muzzle = { x: tower.x, y: tower.y - MUZZLE_HEIGHT };

    for (const monster of frame.monsters) {
      const ground = this.host.yardToWorld(monster.x, monster.y);
      let sprite = this.sprites.get(monster.id);
      if (monster.gone || monster.dying !== null) {
        if (sprite) sprite.visible = false;
        if (monster.dying !== null && monster.dying < DEATH_SECONDS) {
          const share = monster.dying / DEATH_SECONDS;
          g.circle(ground.x, ground.y - 10, 8 + share * 22).fill({ color: PUFF, alpha: 0.75 * (1 - share) });
        }
        continue;
      }
      if (!sheet) {
        g.circle(ground.x, ground.y - 12, 10).fill({ color: 0x6b4fa0 });
        continue;
      }
      // The heading on screen: towards where it is going, through the camera's projection.
      const ahead = this.host.yardToWorld(
        monster.x + Math.cos(monster.heading) * 10,
        monster.y + Math.sin(monster.heading) * 10,
      );
      const column = sheetColumn(sheet, Math.atan2(ahead.y - ground.y, ahead.x - ground.x));
      const row = frameRow(sheet, monster.moving ? "walk" : "idle", Math.floor(t * TICKS_PER_SECOND));
      const texture = this.textures.frame(sheet, column, row);
      if (!texture) continue;
      if (!sprite) {
        sprite = new Sprite(texture);
        this.sprites.set(monster.id, sprite);
        this.bodies.addChild(sprite);
      }
      sprite.texture = texture;
      const anchor = anchorOffset(sheet);
      sprite.position.set(ground.x + anchor.x, ground.y + anchor.y);
      sprite.zIndex = ground.y;
      sprite.visible = true;
    }

    for (const shot of frame.shots) {
      const to = this.host.yardToWorld(shot.to.x, shot.to.y);
      g.moveTo(muzzle.x, muzzle.y)
        .lineTo(to.x, to.y - 12)
        .stroke({ width: 3, color: TRACER, alpha: 1 - shot.progress });
      g.circle(muzzle.x, muzzle.y, 6 * (1 - shot.progress)).fill({ color: TRACER, alpha: 0.9 });
    }
  }
}
