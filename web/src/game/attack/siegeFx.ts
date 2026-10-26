import { Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { SiegeSnapshot } from "@/game/combat/rules/engine";
import { JAR_FALL_TICKS } from "@/game/combat/rules/jars";
import { TICKS_PER_SECOND } from "@/game/combat/rules/stats";
import { VACUUM_HOSE_RISE, VACUUM_LOWER_TICKS, vacuumHoseY } from "@/game/combat/rules/vacuum";
import type { Point } from "@/game/yard/YardGrid";

/**
 * The siege weapons on the field, as the Flash client drew them (Inferno
 * WP 6.8). Picture only: the battle's {@link SiegeSnapshot} says where each
 * weapon is and when, and this follows it each frame on the battle's clock.
 *
 * - The Decoy (`Decoy.as:192-330`): a container at the drop point falls from
 *   300 px above over 0.6 s (`Expo.easeIn`), shows the first cell of its
 *   45-cell wave until it lands and loops it after; its fuse sits at
 *   (graphic.x - 8, graphic.y + 30) and burns its 21 cells from half a
 *   second before the blast; at the blast the 33-cell explosion plays once
 *   in its place and the container goes.
 * - The Vacuum (`VacuumHose.as:183-283`): a nozzle (`vacuum-end`) with pipe
 *   stacked above it to the top of the map, over the Town Hall. It comes
 *   down from 400 px above to the spout over 2 s, fading in (`Expo.easeOut`,
 *   {@link vacuumHoseY}); when it lets go it goes back up and fades out over
 *   2 s. Both strips step every other tick, Flash's 40 fps.
 * - The Jars (`BTOWER.ApplyJar`, `:255-322`): one jar per tower, its middle
 *   on the tower's anchor shifted by half its `_middle`, falling 300 px over
 *   1 s (`Expo.easeIn`); the cell the engine names (whole, cracked, more
 *   cracked, then the break) until it goes.
 *
 * Every sprite goes above the buildings (Flash's `MAP._BUILDINGTOPS` and
 * `_EFFECTSTOP`). No sound.
 */

/** The six strips under `/assets/siegeimages/`, each one row of equal cells. */
export type SiegeSheet = "wave" | "fuse" | "explosion" | "jar" | "end" | "pipe";

export interface SiegeStrip {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
}

/** `SPRITES.as:84-94` and `Jars.as:20`. */
export const SIEGE_STRIPS: Readonly<Record<SiegeSheet, SiegeStrip>> = {
  wave: { url: "/assets/siegeimages/decoy_wave_anim.png", width: 61, height: 70, frames: 45 },
  fuse: { url: "/assets/siegeimages/decoy_fuse_anim.png", width: 44, height: 49, frames: 21 },
  explosion: { url: "/assets/siegeimages/decoy_explosion_anim.png", width: 184, height: 195, frames: 33 },
  jar: { url: "/assets/siegeimages/jar_anim.v2.png", width: 163, height: 150, frames: 23 },
  end: { url: "/assets/siegeimages/vacuum-end.png", width: 52, height: 52, frames: 15 },
  pipe: { url: "/assets/siegeimages/vacuum-pipe.png", width: 26, height: 97, frames: 15 },
};

/** Battle ticks per cell of every strip: Flash's 40 fps `ENTER_FRAME`. */
export const SIEGE_TICKS_PER_FRAME = 2;

/** How far the Decoy and a jar fall from (`TweenLite.from(..., {y: y - 300})`). */
export const SIEGE_DROP_HEIGHT = 300;

/** The fuse starts burning this long before the blast (`Decoy.as:211`). */
export const DECOY_FUSE_LEAD = Math.round(0.5 * TICKS_PER_SECOND);

/**
 * Pipe stacked over the nozzle: Flash's ran to `-GLOBAL._mapHeight`; this
 * many 97 px lengths clears the top of any yard on screen.
 */
export const HOSE_PIPES = 30;

/** `Expo.easeIn` (`gs/easing/Expo.as`): slow off the mark, fastest at the end. */
export const expoEaseIn = (t: number): number => {
  const at = Math.min(1, Math.max(0, t));
  return at <= 0 ? 0 : Math.pow(2, 10 * (at - 1));
};

/** `Expo.easeOut`: fastest off the mark, settling at the end. */
export const expoEaseOut = (t: number): number => {
  const at = Math.min(1, Math.max(0, t));
  return at >= 1 ? 1 : 1 - Math.pow(2, -10 * at);
};

/** How far above its rest a falling thing is, `fall` ticks from `start`. */
export const dropOffset = (tick: number, start: number, fall: number): number =>
  fall <= 0 || tick >= start + fall ? 0 : -SIEGE_DROP_HEIGHT * (1 - expoEaseIn((tick - start) / fall));

/** The Decoy's two cells at a tick before its blast: the wave's and the fuse's. */
export const decoyCells = (
  decoy: NonNullable<SiegeSnapshot["decoy"]>,
  tick: number,
): { wave: number; fuse: number } => {
  const wave =
    tick < decoy.landsAt
      ? 0
      : Math.floor((tick - decoy.landsAt) / SIEGE_TICKS_PER_FRAME) % SIEGE_STRIPS.wave.frames;
  const lit = decoy.explodesAt - DECOY_FUSE_LEAD;
  const fuse =
    tick < lit
      ? 0
      : Math.min(SIEGE_STRIPS.fuse.frames - 1, Math.floor((tick - lit) / SIEGE_TICKS_PER_FRAME));
  return { wave, fuse };
};

/** The explosion's cell `age` ticks after the blast, or null once it has played. */
export const explosionCell = (age: number): number | null => {
  const frame = Math.floor(Math.max(0, age) / SIEGE_TICKS_PER_FRAME);
  return frame < SIEGE_STRIPS.explosion.frames ? frame : null;
};

/** The strips' cells: fetched on first ask, null until a sheet is in. */
export interface SiegeArt {
  cell(sheet: SiegeSheet, frame: number): Texture | null;
  destroy(): void;
}

/** {@link SiegeArt} over Pixi's `Assets`, one fetch per sheet and one framed texture per cell. */
export class SiegeSheetTextures implements SiegeArt {
  private readonly sources = new Map<SiegeSheet, Texture>();
  private readonly asked = new Set<SiegeSheet>();
  private readonly cells = new Map<string, Texture>();

  constructor(
    private readonly load: (url: string) => Promise<Texture> = (url) => Assets.load<Texture>(url),
  ) {}

  cell(sheet: SiegeSheet, frame: number): Texture | null {
    const strip = SIEGE_STRIPS[sheet];
    const index = Math.max(0, Math.min(strip.frames - 1, Math.floor(frame)));
    const key = `${sheet}:${index}`;
    const cached = this.cells.get(key);
    if (cached) return cached;
    const source = this.source(sheet);
    if (!source) return null;
    const texture = new Texture({
      source: source.source,
      frame: new Rectangle(index * strip.width, 0, strip.width, strip.height),
    });
    this.cells.set(key, texture);
    return texture;
  }

  destroy(): void {
    for (const texture of this.cells.values()) texture.destroy(false);
    this.cells.clear();
    this.sources.clear();
  }

  private source(sheet: SiegeSheet): Texture | null {
    const ready = this.sources.get(sheet);
    if (ready) return ready;
    if (this.asked.has(sheet)) return null;
    this.asked.add(sheet);
    this.load(SIEGE_STRIPS[sheet].url)
      .then((texture) => this.sources.set(sheet, texture))
      .catch((caught: unknown) => {
        // Asked once: a missing sheet leaves the weapon unseen, not broken.
        console.warn(`Siege sheet ${sheet} did not load.`, caught);
      });
    return null;
  }
}

/** A building as the weapons need it: its art's anchor in world px and its footprint. */
export interface SiegeBuilding {
  readonly worldX: number;
  readonly worldY: number;
  readonly footprint: readonly [width: number, height: number];
}

/** What the weapons need from the battle layer. */
export interface SiegeFxHost {
  /** Above the buildings, where every weapon is drawn. */
  air(): Container;
  /** A yard point (yard units) in world px. */
  world(x: number, y: number): Point;
  building(id: number): SiegeBuilding | null;
}

export interface SiegeFxOptions {
  readonly art?: SiegeArt;
  /** No falls, no hose tween, no blast: each weapon shows where it rests and goes when it goes. */
  readonly reducedMotion?: boolean;
}

interface DecoyView {
  readonly root: Container;
  readonly body: Sprite;
  readonly fuse: Sprite;
  readonly at: Point;
  plan: NonNullable<SiegeSnapshot["decoy"]>;
  /** The tick it blew up on, once it has. */
  blewAt: number | null;
}

interface HoseView {
  readonly root: Container;
  readonly end: Sprite;
  readonly pipes: Sprite[];
  readonly anchor: Point;
  readonly droppedAt: number;
  /** Once it has let go: when, and where it was. */
  gone: { readonly at: number; readonly y: number; readonly alpha: number } | null;
}

const stripSprite = (): Sprite => {
  const sprite = new Sprite(Texture.EMPTY);
  sprite.eventMode = "none";
  sprite.visible = false;
  return sprite;
};

export class SiegeFx {
  private readonly host: SiegeFxHost;
  private readonly art: SiegeArt;
  private readonly reducedMotion: boolean;
  private decoy: DecoyView | null = null;
  private hose: HoseView | null = null;
  private readonly jars = new Map<number, Sprite>();

  constructor(host: SiegeFxHost, options: SiegeFxOptions = {}) {
    this.host = host;
    this.art = options.art ?? new SiegeSheetTextures();
    this.reducedMotion = options.reducedMotion ?? false;
  }

  /** What is on screen, for tests: the Decoy (or its blast), the hose, the jars. */
  get shown(): { decoy: "decoy" | "blast" | null; hose: boolean; jars: number } {
    return {
      decoy: this.decoy ? (this.decoy.blewAt === null ? "decoy" : "blast") : null,
      hose: this.hose !== null,
      jars: this.jars.size,
    };
  }

  /** Follows the battle's siege weapons to `tick`. */
  update(snapshot: SiegeSnapshot, tick: number): void {
    this.updateDecoy(snapshot.decoy, tick);
    this.updateHose(snapshot.vacuum, tick);
    this.updateJars(snapshot.jars, tick);
  }

  destroy(): void {
    this.decoy?.root.destroy({ children: true });
    this.decoy = null;
    this.hose?.root.destroy({ children: true });
    this.hose = null;
    for (const sprite of this.jars.values()) sprite.destroy();
    this.jars.clear();
    this.art.destroy();
  }

  /* ── The Decoy ──────────────────────────────────────────────────────── */

  private updateDecoy(decoy: SiegeSnapshot["decoy"], tick: number): void {
    let view = this.decoy;
    if (decoy && (!view || view.blewAt !== null)) {
      view?.root.destroy({ children: true });
      view = this.newDecoy(decoy);
    }
    if (!view) return;
    if (decoy) view.plan = decoy;
    else if (view.blewAt === null) view.blewAt = Math.min(tick, view.plan.explodesAt);

    if (view.blewAt !== null) {
      const frame = this.reducedMotion ? null : explosionCell(tick - view.blewAt);
      if (frame === null) {
        view.root.destroy({ children: true });
        this.decoy = null;
        return;
      }
      view.fuse.visible = false;
      view.root.position.set(view.at.x, view.at.y);
      // `setDecoyGraphic`: every graphic is centred on the drop, the blast too.
      view.body.position.set(-SIEGE_STRIPS.explosion.width / 2, -SIEGE_STRIPS.explosion.height / 2);
      this.show(view.body, "explosion", frame);
      return;
    }
    const { wave, fuse } = decoyCells(view.plan, tick);
    const fall = this.reducedMotion
      ? 0
      : dropOffset(tick, view.plan.droppedAt, view.plan.landsAt - view.plan.droppedAt);
    view.root.position.set(view.at.x, view.at.y + fall);
    this.show(view.body, "wave", this.reducedMotion ? 0 : wave);
    this.show(view.fuse, "fuse", this.reducedMotion ? 0 : fuse);
  }

  private newDecoy(decoy: NonNullable<SiegeSnapshot["decoy"]>): DecoyView {
    const root = new Container();
    root.eventMode = "none";
    const body = stripSprite();
    const fuse = stripSprite();
    // Flash centres the graphic on the drop and puts the fuse over it.
    body.position.set(-SIEGE_STRIPS.wave.width / 2, -SIEGE_STRIPS.wave.height / 2);
    fuse.position.set(body.x - 8, body.y + 30);
    root.addChild(body, fuse);
    this.host.air().addChild(root);
    // Fetch the fuse and the blast now, or the blast's first cells play unseen.
    this.art.cell("fuse", 0);
    this.art.cell("explosion", 0);
    const view: DecoyView = { root, body, fuse, at: this.host.world(decoy.x, decoy.y), plan: decoy, blewAt: null };
    this.decoy = view;
    return view;
  }

  /* ── The Vacuum ─────────────────────────────────────────────────────── */

  private updateHose(vacuum: SiegeSnapshot["vacuum"], tick: number): void {
    let view = this.hose;
    if (vacuum && (!view || view.gone !== null || view.droppedAt !== vacuum.droppedAt)) {
      view?.root.destroy({ children: true });
      view = this.newHose(vacuum);
    }
    if (!view) return;
    const elapsed = tick - view.droppedAt;
    if (vacuum) {
      const y = this.reducedMotion ? vacuumHoseY(view.anchor.y, VACUUM_LOWER_TICKS) : vacuumHoseY(view.anchor.y, elapsed);
      view.root.position.set(view.anchor.x, y);
      view.root.alpha = this.reducedMotion ? 1 : expoEaseOut(elapsed / VACUUM_LOWER_TICKS);
      const frame = this.reducedMotion ? 0 : Math.floor(Math.max(0, elapsed) / SIEGE_TICKS_PER_FRAME);
      this.show(view.end, "end", frame % SIEGE_STRIPS.end.frames);
      for (const pipe of view.pipes) this.show(pipe, "pipe", frame % SIEGE_STRIPS.pipe.frames);
      return;
    }
    view.gone ??= { at: tick, y: view.root.y, alpha: view.root.alpha };
    const t = (tick - view.gone.at) / VACUUM_LOWER_TICKS;
    if (this.reducedMotion || t >= 1) {
      view.root.destroy({ children: true });
      this.hose = null;
      return;
    }
    const eased = expoEaseOut(t);
    const top = view.anchor.y - VACUUM_HOSE_RISE;
    view.root.position.set(view.anchor.x, view.gone.y + (top - view.gone.y) * eased);
    view.root.alpha = view.gone.alpha * (1 - eased);
  }

  private newHose(vacuum: NonNullable<SiegeSnapshot["vacuum"]>): HoseView | null {
    const building = this.host.building(vacuum.buildingId);
    if (!building) return null;
    const root = new Container();
    root.eventMode = "none";
    root.alpha = 0;
    // `ApplyVacuum`: the nozzle's foot on the hose's point, pipe up from its top.
    const end = stripSprite();
    let top = -SIEGE_STRIPS.end.height;
    end.position.set(-SIEGE_STRIPS.end.width / 2, top);
    root.addChild(end);
    const pipes: Sprite[] = [];
    for (let index = 0; index < HOSE_PIPES; index += 1) {
      const pipe = stripSprite();
      top -= SIEGE_STRIPS.pipe.height;
      pipe.position.set(-SIEGE_STRIPS.pipe.width / 2, top);
      root.addChild(pipe);
      pipes.push(pipe);
    }
    this.host.air().addChild(root);
    const view: HoseView = {
      root,
      end,
      pipes,
      anchor: { x: building.worldX, y: building.worldY },
      droppedAt: vacuum.droppedAt,
      gone: null,
    };
    this.hose = view;
    return view;
  }

  /* ── The Jars ───────────────────────────────────────────────────────── */

  private updateJars(jars: SiegeSnapshot["jars"], tick: number): void {
    const seen = new Set<number>();
    for (const jar of jars) {
      const building = this.host.building(jar.buildingId);
      if (!building) continue;
      seen.add(jar.buildingId);
      let sprite = this.jars.get(jar.buildingId);
      if (!sprite) {
        sprite = stripSprite();
        this.host.air().addChild(sprite);
        this.jars.set(jar.buildingId, sprite);
      }
      // `ApplyJar`: centred on the anchor, shifted by half the tower's `_middle`.
      const middle = building.footprint[1] * 0.5;
      const fall = this.reducedMotion ? 0 : dropOffset(tick, jar.landsAt - JAR_FALL_TICKS, JAR_FALL_TICKS);
      sprite.position.set(
        building.worldX - SIEGE_STRIPS.jar.width / 2 + middle / 2,
        building.worldY - SIEGE_STRIPS.jar.height / 2 + fall,
      );
      this.show(sprite, "jar", jar.frame);
    }
    for (const [id, sprite] of this.jars) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.jars.delete(id);
    }
  }

  /** Puts a cell on a sprite, hidden while its sheet is still on the way. */
  private show(sprite: Sprite, sheet: SiegeSheet, frame: number): void {
    const texture = this.art.cell(sheet, frame);
    if (!texture) {
      sprite.visible = false;
      return;
    }
    if (sprite.texture !== texture) sprite.texture = texture;
    sprite.visible = true;
  }
}
