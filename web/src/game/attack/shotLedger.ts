import { rangePointOf } from "@/game/combat/rules";

/**
 * Holds back what a tower's bullet did to the creeps until the bullet has
 * landed (issue #77).
 *
 * The engine applies a tower's damage on the tick it fires: the shot, the
 * target's wound, any splash wounds and any deaths all arrive in one run of
 * `recentEvents`. Flash did not. The Sniper, Cannon and Aerial towers spawn a
 * `PROJECTILE` whose `Move` calls `modifyHealth` only once it is within a
 * speed of its target (`client/scripts/PROJECTILE.as:31-50`), and `Splash`
 * deals the blast there. The Tesla (`BUILDING25.as:145`) and the Railgun
 * (`BUILDING118.as:195`) hurt at once, as does the Laser's beam, so their
 * wounds are shown at once too.
 *
 * The combat rules are shared with the server and stay as they are. The delay
 * lives in the picture only: the layer shows a creep's health as the engine's
 * plus whatever this still holds for it, floats the number and tints the body
 * when the bullet lands, and keeps a creep that the held wound killed on
 * screen, standing, until then — the bullet lands, then it dies.
 *
 * ## Which wounds belong to a bullet
 *
 * Inside a tick the engine runs every tower in turn, and each shot is pushed
 * straight before the wounds it deals: the target's first, then the splash
 * victims in its blast, with a death after any wound that killed
 * (`engine.ts` `tickTower`, `damageCreep`). So a hurt belongs to the open shot
 * when it is on the same tick and is either that shot's target or, for a
 * splash tower, a creep inside the blast. Anything else — a different tick, a
 * creep swing's `hit`, a hurt that fits neither — closes the shot and is shown
 * as it comes. The one hurt this can still claim wrongly is a bunker
 * defender's bite, the first thing in the creep phase, on a creep standing in
 * the last splash tower's blast; it is then shown a bullet's flight late.
 */

/** Ticks a wound is held at most (3 s at 1x), in case its bullet never reports landing. */
export const HOLD_LIMIT_TICKS = 240;

/** Yard units of slack on the splash radius: the engine truncates positions. */
const SPLASH_SLACK = 2;

/** A shot whose wounds wait for its bullet. */
export interface HeldShot {
  /** The bullet's key, as `TowerFx.onShot` returned it. */
  readonly key: number;
  readonly tick: number;
  /** The creep the shot was fired at. */
  readonly creepId: number;
  /** The tower's splash radius in yard units; 0 for none. */
  readonly splash: number;
  /** The target's yard position on the shot tick. */
  readonly ix: number;
  readonly iy: number;
}

/** The part of a `hurt` event the ledger reads. */
export interface WoundLike {
  readonly tick: number;
  readonly creepId: number;
  readonly ix: number;
  readonly iy: number;
  readonly amount: number;
}

interface Shot {
  readonly tick: number;
  readonly wounds: WoundLike[];
  primary: boolean;
}

/** What a landing lets go of: the wounds to show, and the deaths they held. */
export interface Released<D> {
  readonly wounds: WoundLike[];
  readonly deaths: D[];
}

export class ShotLedger<D extends { readonly creepId: number }> {
  private open: HeldShot | null = null;
  private readonly shots = new Map<number, Shot>();
  /** Health held per creep, and how many wounds make it up. */
  private readonly amounts = new Map<number, number>();
  private readonly counts = new Map<number, number>();
  private readonly deaths = new Map<number, D>();

  /**
   * A tower fired. `held` is the shot when its bullet will report landing,
   * or null for a shot that hurts at once (a beam, a bolt, a rail).
   */
  shot(held: HeldShot | null): void {
    this.open = held;
    if (held) this.shots.set(held.key, { tick: held.tick, wounds: [], primary: false });
  }

  /** Something that is not a tower's wound came along: the open shot is over. */
  interrupt(): void {
    this.open = null;
  }

  /** Takes a wound if the open shot dealt it; false means show it now. */
  hurt(wound: WoundLike): boolean {
    const open = this.open;
    const shot = open ? this.shots.get(open.key) : undefined;
    if (!open || !shot || wound.tick !== open.tick) {
      this.open = null;
      return false;
    }
    const primary = !shot.primary && wound.creepId === open.creepId;
    if (!primary && !this.inBlast(open, wound)) {
      this.open = null;
      return false;
    }
    if (primary) shot.primary = true;
    shot.wounds.push(wound);
    this.amounts.set(wound.creepId, (this.amounts.get(wound.creepId) ?? 0) + wound.amount);
    this.counts.set(wound.creepId, (this.counts.get(wound.creepId) ?? 0) + 1);
    return true;
  }

  /** Takes a death if a held wound is still on its way to that creep. */
  death(event: D): boolean {
    if ((this.counts.get(event.creepId) ?? 0) <= 0) return false;
    this.deaths.set(event.creepId, event);
    return true;
  }

  /** Health the engine has taken off a creep that the screen has not yet. */
  heldAmount(creepId: number): number {
    return this.amounts.get(creepId) ?? 0;
  }

  /** Whether a creep has to stay on screen: a wound or its death still held. */
  holds(creepId: number): boolean {
    return (this.counts.get(creepId) ?? 0) > 0 || this.deaths.has(creepId);
  }

  /** Whether the engine has already killed a creep whose death is held. */
  holdsDeath(creepId: number): boolean {
    return this.deaths.has(creepId);
  }

  /** Shots still in the air. */
  get heldShots(): number {
    return this.shots.size;
  }

  /** A bullet landed: its wounds, and the deaths nothing else is holding now. */
  land(key: number): Released<D> {
    const released: Released<D> = { wounds: [], deaths: [] };
    this.release(key, released);
    return released;
  }

  /** Lands every shot fired `HOLD_LIMIT_TICKS` or more before `tick`. */
  expire(tick: number): Released<D> {
    const released: Released<D> = { wounds: [], deaths: [] };
    for (const [key, shot] of this.shots) {
      if (tick - shot.tick >= HOLD_LIMIT_TICKS) this.release(key, released);
    }
    return released;
  }

  clear(): void {
    this.open = null;
    this.shots.clear();
    this.amounts.clear();
    this.counts.clear();
    this.deaths.clear();
  }

  private inBlast(open: HeldShot, wound: WoundLike): boolean {
    if (open.splash <= 0) return false;
    const centre = rangePointOf(open.ix, open.iy);
    const at = rangePointOf(wound.ix, wound.iy);
    const reach = open.splash + SPLASH_SLACK;
    const dx = at.x - centre.x;
    const dy = at.y - centre.y;
    return dx * dx + dy * dy <= reach * reach;
  }

  private release(key: number, into: Released<D>): void {
    const shot = this.shots.get(key);
    if (!shot) return;
    this.shots.delete(key);
    if (this.open?.key === key) this.open = null;
    for (const wound of shot.wounds) {
      into.wounds.push(wound);
      const amount = (this.amounts.get(wound.creepId) ?? 0) - wound.amount;
      const count = (this.counts.get(wound.creepId) ?? 0) - 1;
      if (count > 0) {
        this.amounts.set(wound.creepId, amount);
        this.counts.set(wound.creepId, count);
        continue;
      }
      this.amounts.delete(wound.creepId);
      this.counts.delete(wound.creepId);
      const death = this.deaths.get(wound.creepId);
      if (death) {
        this.deaths.delete(wound.creepId);
        into.deaths.push(death);
      }
    }
  }
}
