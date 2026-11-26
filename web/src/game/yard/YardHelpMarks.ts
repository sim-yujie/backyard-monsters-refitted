import { Container, Graphics, Text } from "pixi.js";
import { savingTag, type HelpMark, type HelpMarkKind } from "@/game/friends/helpModel";
import { paintIcon } from "./yardIcons";
import { HELP_FLARE } from "./helpGlow";
import { jobBarScale } from "./YardJobBars";
import type { MarkAnchor } from "./YardHatchMarks";
import type { Corners } from "./planner/marquee";

/**
 * The marks drawn over a friend's yard on a visit (`docs/design/friends.md`
 * §3.3, issue #374; beta 8's bigger marks, owner 15 Nov 2026, mock-up "D
 * without Next"): over each building the help block says can be sped up
 * now,
 *
 * - a pulsing amber **ring on the ground**, around the building's footprint
 *   (`ground`, under the buildings, so it rings the building's foot). Only
 *   on the ground, all of it: a wall, tower or monster in front hides its
 *   part of the ring as it would hide the grass (owner's pick F, 26 Nov
 *   2026; the front-half copy over the buildings from 15 Nov is gone);
 * - the building itself **lit amber** with a soft amber glow round it
 *   (`lit`, drawn by `YardBuildings.setHelpLit`), so a building behind a
 *   wall still reads as one to help;
 * - a big amber **wrench** disc with the painted tools in it, bobbing gently,
 *   where a job bar would stand (`root`, over the buildings);
 * - under the wrench, a small green **tag** with what a speed-up would take
 *   off ("-18m").
 *
 * A building that only takes a repair keeps today's small amber wrench, with
 * no ring and no tag (owner, 15 Nov 2026: Help all and the bar's count are
 * speed-ups only; a repair is still given from the building's panel).
 * A building still damaged whose repair is used up for today (one repair a
 * friend's yard a day) keeps that small wrench in grey, still tappable: the
 * wrench is the visit's clear sign of which buildings are damaged, so
 * without it the rest of the yard looks repaired (owner's bug report,
 * 16 Nov 2026).
 *
 * The scene decides which buildings and what each saves (`helpMarksOf`);
 * this layer only draws them, and draws nothing once handed none. The wrench
 * grows against the zoom as the job bars do, so it stays readable zoomed
 * out. A tap on a wrench picks its building (`pick`), as a tap on the
 * building does; the bob moves only the picture, never the place a tap hits.
 * Under `prefers-reduced-motion` nothing pulses or bobs.
 */

/** The wrench disc's radius and its gap above the anchor, world pixels at zoom 1. */
export const WRENCH_RADIUS = 22;
const WRENCH_GAP = 10;
/** The disc's centre over its anchor. */
const WRENCH_RISE = WRENCH_RADIUS + WRENCH_GAP;
/** A repair-only building's small wrench (the #374 badge): radius and gap. */
export const SMALL_RADIUS = 14;
const SMALL_GAP = 6;
const SMALL_RISE = SMALL_RADIUS + SMALL_GAP;
/** The small wrench's amber and its dark rim. */
const SMALL_FILL = 0xf5b94a;
const SMALL_RIM = 0x0f1c26;
const SMALL_WRENCH = 0x2a1a00;
/** The small wrench in grey, for a repair used up today: still damaged, no help to give now. */
const SPENT_FILL = 0x9aa1a8;
const SPENT_WRENCH = 0x3a4047;
/** The painted tools' side inside the disc. */
const TOOLS_SIDE = 30;
/** How high the wrench bobs, and how long one bob takes (seconds). */
const BOB_HEIGHT = 5;
const BOB_PERIOD = 1.4;
/**
 * How far a wrench and its tag reach above their anchor, in screen pixels at
 * zoom 1 and below (the wrench keeps its screen size zoomed out): the disc's
 * rise and radius, the bob and a little air.
 */
export const MARK_HEADROOM = WRENCH_RISE + WRENCH_RADIUS + BOB_HEIGHT + 6;
/** Half a big wrench's width, in the same screen pixels. */
export const MARK_HALF_WIDTH = WRENCH_RADIUS + 4;

/**
 * A big wrench's scale at a zoom: its full size on screen at any zoom out,
 * with no floor (lead's check, 15 Nov 2026: on a phone on its side the job
 * bars' cap left it 15 px across and its tag unreadable), and growing with
 * the yard past zoom 1. The small repair wrench keeps the job bars' scale.
 */
export const helpMarkScale = (zoom: number): number => (zoom > 0 ? Math.max(1, 1 / zoom) : 1);

const scaleOf = (kind: HelpMarkKind, zoom: number): number =>
  kind === "speedup" ? helpMarkScale(zoom) : jobBarScale(zoom);

/** One pulse of the ring, seconds, and its faintest. */
const PULSE_PERIOD = 1.6;
const PULSE_LOW = 0.75;
/**
 * The ring's size against the ellipse through the footprint's corners: a
 * little inside it, so it sits on the building's own tile and neighbouring
 * rings neither stack in open ground nor reach under the next building
 * (1.25 before neon's three reviews, 26 Nov 2026; under 0.8 a walled
 * tower's ring would vanish under its own base).
 */
const RING_SPREAD = 0.85;

/** The mock-up's amber, a cream rim and a dark wrench (until the painted tools come). */
const AMBER = 0xf2a51a;
/** The ring's brighter edge and the dark line round it, so it reads on grass and lava alike. */
const RING_EDGE = 0xffc93c;
const RING_DARK = 0x4a2a00;
const RIM = 0xfff3d6;
const WRENCH = 0x3a2200;
/** The tag: dark green, a bright green edge, white words. */
const TAG_FILL = 0x143c1e;
const TAG_EDGE = 0x57e389;
const TAG_HEIGHT = 20;

/** The world rectangle the marks take, and the highest building's foot (`YardHelpMarks.worldBox`). */
export interface HelpMarksBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly footTop: number;
  /** Each big wrench's x. */
  readonly xs: readonly number[];
}

/** Where a building's footprint is drawn now, or null when it is not. */
export type MarkCorners = (id: number) => Corners | null;

interface MarkView {
  /** The building it stands over. */
  readonly id: number;
  /** Placed at the anchor; scaled against the zoom. */
  readonly badge: Container;
  /** The disc and its tag, moved by the bob. */
  readonly bob: Container;
  readonly tag: Text | null;
  /** The ground ring, at the footprint's middle; none for a repair only. */
  readonly ring: Graphics | null;
  /** How lit the building is drawn (`lit`): 1 standing, flaring and fading as it leaves; 0 for a repair only. */
  glow: number;
  readonly kind: HelpMarkKind;
  saving: number | null;
}

export interface HelpMarksOptions {
  readonly reducedMotion?: boolean;
}

/**
 * How a held wrench leaves once its help has landed ({@link YardHelpMarks.leave}):
 * `pop` bumps the disc and pops it while the tag rises off the building and
 * the ring flares; `fade` fades it all.
 * Under `prefers-reduced-motion` every exit is a plain fade.
 */
export type HelpMarkExit = "pop" | "fade";

/** A wrench on its way out: drawn on, out of `views`, until its exit ends. */
interface LeavingView {
  readonly view: MarkView;
  readonly exit: HelpMarkExit;
  /** The tag and its plate, lifted out of the bob so they can rise on their own. */
  readonly tagBox: Container | null;
  /** The pop's burst ring; none for a fade. */
  readonly overlay: Graphics | null;
  age: number;
}

/** Each exit's length, seconds. */
export const EXIT_SECONDS: Readonly<Record<HelpMarkExit, number>> = { pop: 0.9, fade: 0.3 };

export class YardHelpMarks {
  /** The wrenches and their tags: over the buildings. */
  readonly root = new Container();
  /** The rings: under the buildings, over the ground, and nowhere else. */
  readonly ground = new Container();

  private marks: readonly HelpMark[] = [];
  private zoom = 1;
  private time = 0;
  private readonly views = new Map<number, MarkView>();
  /** The marks the scene last handed over (`set`), before any held ones are added. */
  private given: readonly HelpMark[] = [];
  /** Wrenches kept drawn after their help landed, until `leave` (Help all's effects). */
  private readonly held = new Map<number, HelpMark>();
  private readonly leaving: LeavingView[] = [];
  private readonly reducedMotion: boolean;
  /** The world y of the top of the clear band (under the visit's top column), or null. */
  private viewTop: number | null = null;

  constructor(
    private readonly anchorOf: MarkAnchor,
    private readonly cornersOf: MarkCorners = () => null,
    options: HelpMarksOptions = {},
  ) {
    this.root.eventMode = "none";
    this.ground.eventMode = "none";
    this.reducedMotion = options.reducedMotion ?? false;
  }

  /** Whether any mark is drawn. */
  get active(): boolean {
    return this.views.size > 0 || this.leaving.length > 0;
  }

  /** The buildings wearing a wrench, by id: amber or grey. */
  get drawn(): number[] {
    return [...this.views.keys()];
  }

  /** The buildings wearing the grey wrench (a repair used up today), by id. */
  get drawnSpent(): number[] {
    return [...this.views].filter(([, view]) => view.kind === "spent").map(([id]) => id);
  }

  /** The tag on each wrench now ("-18m"), or null with none; by id. */
  get tags(): Map<number, string | null> {
    return new Map([...this.views].map(([id, view]) => [id, view.tag?.text ?? null]));
  }

  /** Each big wrench's disc as drawn: centre and radius in world pixels, and whether it shows. For checks. */
  get discs(): { id: number; x: number; y: number; radius: number; visible: boolean }[] {
    return [...this.views]
      .filter(([, view]) => view.kind === "speedup")
      .map(([id, view]) => {
        const scale = scaleOf(view.kind, this.zoom);
        return { id, x: view.badge.x, y: view.badge.y - WRENCH_RISE * scale, radius: WRENCH_RADIUS * scale, visible: view.badge.visible };
      });
  }

  /**
   * Draws these marks and no others; returns whether anything changed. Only
   * a different set of buildings redraws them all; a new saving only
   * rewrites its tag.
   */
  set(given: readonly HelpMark[]): boolean {
    this.given = given;
    const marks = this.withHeld(given);
    const same =
      marks.length === this.marks.length &&
      marks.every((mark) => this.views.get(mark.id)?.kind === mark.kind);
    if (same) {
      let changed = false;
      for (const mark of marks) {
        const view = this.views.get(mark.id);
        if (!view || sameTag(view.saving, mark.saving)) continue;
        if ((view.saving === null) !== (mark.saving === null)) {
          // A tag comes or goes: draw this one again.
          this.marks = marks;
          this.rebuild();
          return true;
        }
        view.saving = mark.saving;
        if (view.tag && mark.saving !== null) setTagText(view.tag, mark.saving);
        changed = true;
      }
      this.marks = marks;
      return changed;
    }
    this.marks = marks;
    this.rebuild();
    return true;
  }

  setZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    for (const view of this.views.values()) view.badge.scale.set(scaleOf(view.kind, zoom));
    this.reposition();
  }

  /**
   * The world y under which a big wrench must stand: the bottom of the
   * visit's top column, or null for none. A wrench that would reach above it
   * slides down until its building's foot passes under the column too
   * (`reposition`).
   */
  setViewTop(worldY: number | null): void {
    this.viewTop = worldY;
  }

  /**
   * Keeps these buildings' wrenches drawn as they are now, even once a help
   * takes them out of the marks the scene hands over, until each {@link leave}s
   * (Help all's effects play each wrench out in turn, not all at once).
   */
  hold(ids: readonly number[]): void {
    for (const id of ids) {
      const mark = this.marks.find((one) => one.id === id);
      if (mark) this.held.set(id, mark);
    }
  }

  /**
   * Lets a held wrench go: it plays `exit` where it stands, then is gone. A
   * wrench the scene still hands over stays. Without `exit` it simply goes.
   */
  leave(id: number, exit?: HelpMarkExit): void {
    const wasHeld = this.held.delete(id);
    const view = this.views.get(id);
    if (!wasHeld || !view || this.given.some((mark) => mark.id === id)) return;
    if (exit) {
      this.views.delete(id);
      const played = this.reducedMotion ? "fade" : exit;
      this.leaving.push({ view, exit: played, ...readyToLeave(view, played), age: 0 });
    }
    this.marks = this.withHeld(this.given);
    this.rebuild();
  }

  /** Lets every held wrench go at once, with no exit (a visit left mid-way). */
  releaseHeld(): void {
    if (this.held.size === 0) return;
    this.held.clear();
    this.marks = this.given;
    this.rebuild();
  }

  /**
   * How lit each building is drawn, by id, for `YardBuildings.setHelpLit`:
   * every big wrench's building, held ones too, at 1; one whose wrench is
   * leaving flares with its pop and fades with it. A repair's building is
   * not lit: it has no ring either.
   */
  get lit(): Map<number, number> {
    const out = new Map<number, number>();
    for (const [id, view] of this.views) if (view.glow > 0) out.set(id, view.glow);
    for (const { view } of this.leaving) if (view.glow > 0 && !out.has(view.id)) out.set(view.id, view.glow);
    return out;
  }

  /** Advances the pulse and the bob; called every frame while any mark is drawn. */
  update(deltaSeconds: number): void {
    this.playLeaving(Math.max(0, deltaSeconds));
    if (this.reducedMotion || this.views.size === 0) return;
    this.time += Math.max(0, deltaSeconds);
    const pulse = PULSE_LOW + (1 - PULSE_LOW) * (0.5 - 0.5 * Math.cos((2 * Math.PI * this.time) / PULSE_PERIOD));
    const bob = -BOB_HEIGHT * (0.5 - 0.5 * Math.cos((2 * Math.PI * this.time) / BOB_PERIOD));
    for (const view of this.views.values()) {
      if (!view.ring) continue;
      view.ring.alpha = pulse;
      view.bob.y = bob;
    }
  }

  /** The building whose wrench is under a world point, or null. */
  pick(worldX: number, worldY: number): number | null {
    for (const [id, view] of this.views) {
      if (!view.badge.visible) continue;
      const big = view.kind === "speedup";
      const scale = scaleOf(view.kind, this.zoom);
      const radius = (big ? WRENCH_RADIUS : SMALL_RADIUS) * scale;
      const dx = worldX - view.badge.x;
      const dy = worldY - (view.badge.y - (big ? WRENCH_RISE : SMALL_RISE) * scale);
      if (dx * dx + dy * dy <= radius * radius) return id;
    }
    return null;
  }

  /** Puts every mark back over its building: after art arrives, and each frame. */
  reposition(): void {
    for (const [id, view] of this.views) {
      const anchor = this.anchorOf(id);
      view.badge.visible = anchor !== null;
      const corners = view.ring ? this.cornersOf(id) : null;
      if (anchor) {
        const placed = this.underViewTop(view, anchor.y, corners);
        view.badge.visible = placed !== null;
        view.badge.position.set(anchor.x, placed ?? anchor.y);
      }
      if (!view.ring) continue;
      view.ring.visible = corners !== null;
      if (corners) {
        const middle = middleOf(corners);
        view.ring.position.set(middle.x, middle.y);
      }
    }
  }

  /**
   * Where a big wrench stands so it is not under the visit's top column: at
   * its anchor, or slid down to just under the column while its building's
   * foot is still below it; null (hidden) once the foot has gone under too.
   */
  private underViewTop(view: MarkView, anchorY: number, corners: Corners | null): number | null {
    const top = this.viewTop;
    if (top === null || view.kind !== "speedup") return anchorY;
    const reach = (WRENCH_RISE + WRENCH_RADIUS + BOB_HEIGHT) * scaleOf(view.kind, this.zoom);
    if (anchorY - reach >= top) return anchorY;
    const foot = corners ? Math.max(...corners.map(([, y]) => y)) : anchorY;
    return foot < top ? null : top + reach;
  }

  /**
   * The world rectangle the big wrenches' buildings take: from the highest wrench
   * anchor (the wrench and tag stand above it, in screen pixels:
   * {@link MARK_HEADROOM}) to the lowest ring; and `footTop`, the highest
   * building's foot (its footprint's lowest corner), which is as far up as a
   * wrench can be slid under the top column (`setViewTop`). Null with no mark
   * placed.
   */
  worldBox(): HelpMarksBox | null {
    let box: HelpMarksBox | null = null;
    for (const [id, view] of this.views) {
      // The big wrenches only: a repair is not what the visit frames.
      if (view.kind !== "speedup") continue;
      const anchor = this.anchorOf(id);
      const corners = this.cornersOf(id) ?? [];
      const points: (readonly [number, number])[] = [...(anchor ? [[anchor.x, anchor.y] as const] : []), ...corners];
      if (points.length === 0) continue;
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const foot = Math.max(...ys);
      const at = anchor ? [anchor.x] : [];
      const next = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: foot, footTop: foot, xs: at };
      box = box
        ? {
            left: Math.min(box.left, next.left),
            top: Math.min(box.top, next.top),
            right: Math.max(box.right, next.right),
            bottom: Math.max(box.bottom, next.bottom),
            footTop: Math.min(box.footTop, next.footTop),
            xs: [...box.xs, ...next.xs],
          }
        : next;
    }
    return box;
  }

  destroy(): void {
    for (const leaving of this.leaving.splice(0)) dropView(leaving.view);
    this.clear();
    this.root.destroy({ children: true });
    this.ground.destroy({ children: true });
  }

  /** The marks handed over, plus each held wrench the scene no longer hands over. */
  private withHeld(given: readonly HelpMark[]): readonly HelpMark[] {
    const extra = [...this.held.values()].filter((mark) => !given.some((one) => one.id === mark.id));
    return extra.length === 0 ? given : [...given, ...extra];
  }

  /** Plays each leaving wrench's exit on by `dt` seconds; drops the finished ones. */
  private playLeaving(dt: number): void {
    for (let index = this.leaving.length - 1; index >= 0; index -= 1) {
      const leaving = this.leaving[index]!;
      leaving.age += dt;
      const t = Math.min(1, leaving.age / EXIT_SECONDS[leaving.exit]);
      paintExit(leaving, t, leaving.age);
      if (t >= 1) {
        dropView(leaving.view);
        this.leaving.splice(index, 1);
      }
    }
  }

  private rebuild(): void {
    this.clear();
    for (const mark of this.marks) {
      const badge = new Container();
      badge.scale.set(scaleOf(mark.kind, this.zoom));
      const bob = new Container();
      badge.addChild(bob);
      this.root.addChild(badge);

      if (mark.kind !== "speedup") {
        bob.addChild(...smallWrench(mark.kind === "spent"));
        this.views.set(mark.id, { id: mark.id, badge, bob, tag: null, ring: null, glow: 0, kind: mark.kind, saving: null });
        continue;
      }

      const y = -WRENCH_RISE;
      const disc = new Graphics()
        // A soft shadow under the disc, then the disc with its cream rim.
        .ellipse(0, y + WRENCH_RADIUS * 0.15 + 3, WRENCH_RADIUS, WRENCH_RADIUS * 0.95)
        .fill({ color: 0x000000, alpha: 0.35 })
        .circle(0, y, WRENCH_RADIUS)
        .fill({ color: AMBER })
        .stroke({ width: 3, color: RIM, alpha: 0.95 });
      // A spanner, drawn until the painted tools are in.
      const wrench = new Graphics()
        .roundRect(-3.5, -1.5, 7, 19, 3)
        .fill({ color: WRENCH })
        .circle(0, -6, 8)
        .fill({ color: WRENCH })
        .rect(-3, -15.5, 6, 9)
        .fill({ color: AMBER });
      wrench.position.set(0, y);
      wrench.rotation = Math.PI / 4;
      bob.addChild(disc, wrench);
      paintIcon(bob, "tools", TOOLS_SIDE, { x: 0, y }, wrench);

      let tag: Text | null = null;
      if (mark.saving !== null) {
        tag = new Text({
          text: savingTag(mark.saving),
          style: { fontFamily: "Titan One, sans-serif", fontSize: 14, fill: 0xffffff },
          resolution: 2,
        });
        tag.anchor.set(0.5, 0.5);
        const tagY = y + WRENCH_RADIUS + TAG_HEIGHT / 2 - 2;
        tag.position.set(0, tagY);
        const plate = new Graphics();
        plate.label = "tag-plate";
        bob.addChild(plate, tag);
        drawTagPlate(plate, tag, tagY);
      }

      const corners = this.cornersOf(mark.id);
      const ring = new Graphics();
      drawRing(ring, corners);
      this.ground.addChild(ring);
      this.views.set(mark.id, { id: mark.id, badge, bob, tag, ring, glow: 1, kind: mark.kind, saving: mark.saving });
    }
    this.update(0);
    this.reposition();
  }

  private clear(): void {
    // A wrench on its way out plays on: only the standing marks go.
    for (const view of this.views.values()) dropView(view);
    this.views.clear();
  }
}

/** Takes a mark's pictures off the yard for good. */
const dropView = (view: MarkView): void => {
  view.badge.destroy({ children: true });
  view.ring?.destroy();
};

/**
 * Readies a wrench to leave: its tag and plate move out of the bob into
 * their own box on the badge, where they stood, so they can rise on their
 * own; the disc scales about its own centre; and a cream burst ring (pop)
 * is laid over it.
 */
const readyToLeave = (view: MarkView, exit: HelpMarkExit): Pick<LeavingView, "tagBox" | "overlay"> => {
  const disc = view.bob;
  let tagBox: Container | null = null;
  if (view.tag) {
    tagBox = new Container();
    tagBox.position.set(disc.x, disc.y);
    const plate = disc.children.find((child) => child.label === "tag-plate");
    if (plate) tagBox.addChild(plate);
    tagBox.addChild(view.tag);
    view.badge.addChild(tagBox);
  }
  disc.pivot.set(0, -WRENCH_RISE);
  disc.position.set(disc.x, disc.y - WRENCH_RISE);
  let overlay: Graphics | null = null;
  if (exit === "pop") {
    overlay = new Graphics().circle(0, 0, WRENCH_RADIUS).stroke({ width: 4, color: RIM });
    overlay.position.set(disc.x, disc.y);
    overlay.alpha = 0;
    view.badge.addChildAt(overlay, 0);
  }
  return { tagBox, overlay };
};

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** Help all's pop: the building's light rises to its flare in this long, holds, then fades in step with the tag (seconds). */
const FLARE_RISE = 0.13;
const FLARE_HOLD = 0.05;
const FLARE_FADE = 0.5;

/**
 * One frame of a wrench's exit, `age` seconds in, `t` from 0 to 1 over the exit's length.
 * - pop (0.9 s): the disc swells to 1.3x in the first 0.12 s, then pops
 *   (shrinks and fades) by 0.3 s while a cream ring bursts out of it; the
 *   ground ring flares to full and fades by 0.3 s, the building's light
 *   flares to {@link HELP_FLARE} by 0.13 s, holds, and eases out by 0.68 s; the tag rises 26 px off
 *   the building and fades over the last 0.25 s.
 * - fade (0.3 s): everything fades, the building's light too.
 */
const paintExit = (leaving: LeavingView, t: number, age: number): void => {
  const { view, exit, tagBox, overlay } = leaving;
  const disc = view.bob;
  const ring = (alpha: number): void => {
    if (view.ring) view.ring.alpha = alpha;
  };
  if (exit === "pop") {
    const swell = 0.12;
    const popEnd = 0.3;
    if (age < swell) {
      disc.scale.set(1 + 0.3 * easeOut(age / swell));
    } else {
      const p = Math.min(1, (age - swell) / (popEnd - swell));
      disc.scale.set(1.3 - 0.7 * p);
      disc.alpha = 1 - p;
      if (overlay) {
        overlay.scale.set(1.2 + 0.9 * easeOut(p));
        overlay.alpha = p < 1 ? 1 - p : 0;
      }
    }
    ring(age < 0.08 ? 1 : Math.max(0, 1 - (age - 0.08) / 0.22));
    // The building's light flares with the pop, then eases out while the tag rises (neon, 26 Nov 2026).
    if (view.ring) {
      const fadeFrom = FLARE_RISE + FLARE_HOLD;
      view.glow =
        age < FLARE_RISE
          ? 1 + (HELP_FLARE - 1) * easeOut(age / FLARE_RISE)
          : age < fadeFrom
            ? HELP_FLARE
            : HELP_FLARE * (1 - easeOut(Math.min(1, (age - fadeFrom) / FLARE_FADE)));
    }
    if (tagBox) {
      tagBox.y = disc.y + WRENCH_RISE - 26 * easeOut(Math.min(1, age / 0.5));
      const fadeFrom = EXIT_SECONDS.pop - 0.25;
      tagBox.alpha = age < fadeFrom ? 1 : Math.max(0, 1 - (age - fadeFrom) / 0.25);
      tagBox.scale.set(age < 0.12 ? 1 + 0.15 * (age / 0.12) : 1.15 - 0.15 * Math.min(1, (age - 0.12) / 0.2));
    }
    return;
  }
  disc.alpha = 1 - t;
  if (tagBox) tagBox.alpha = 1 - t;
  ring(1 - t);
  if (view.ring) view.glow = 1 - t;
};

/**
 * Today's small wrench (#374), for a building that only takes a repair; in
 * grey (`spent`) for one whose repair is used up for today.
 */
const smallWrench = (spent: boolean): Graphics[] => {
  const fill = spent ? SPENT_FILL : SMALL_FILL;
  const ink = spent ? SPENT_WRENCH : SMALL_WRENCH;
  const y = -SMALL_RISE;
  const disc = new Graphics()
    .circle(0, y, SMALL_RADIUS)
    .fill({ color: fill })
    .stroke({ width: 2, color: SMALL_RIM, alpha: 0.85 });
  // A spanner: a handle, a round head, and the jaw's gap cut in the disc's colour.
  const wrench = new Graphics()
    .roundRect(-2.5, -1, 5, 13, 2)
    .fill({ color: ink })
    .circle(0, -4, 5.5)
    .fill({ color: ink })
    .rect(-2, -10.5, 4, 6)
    .fill({ color: fill });
  wrench.position.set(0, y);
  wrench.rotation = Math.PI / 4;
  return [disc, wrench];
};

/** Two savings that read the same on a tag. */
const sameTag = (a: number | null, b: number | null): boolean =>
  a === b || (a !== null && b !== null && savingTag(a) === savingTag(b));

/** The tag's plate, as wide as its words. */
const drawTagPlate = (plate: Graphics, tag: Text, y: number): void => {
  // Titan One at 14 px runs about 9 px a character; measuring would need a canvas.
  const width = Math.max(34, tag.text.length * 9 + 14);
  plate
    .clear()
    .roundRect(-width / 2, y - TAG_HEIGHT / 2, width, TAG_HEIGHT, 7)
    .fill({ color: TAG_FILL, alpha: 0.92 })
    .stroke({ width: 2, color: TAG_EDGE });
};

/** New words on a tag, its plate following their width. */
const setTagText = (tag: Text, saving: number): void => {
  const text = savingTag(saving);
  if (tag.text === text) return;
  tag.text = text;
  const plate = tag.parent?.children.find((child) => child.label === "tag-plate");
  if (plate instanceof Graphics) drawTagPlate(plate, tag, tag.y);
};

const middleOf = (corners: Corners): { x: number; y: number } => {
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};

/**
 * The ground ring around a footprint, drawn about the footprint's middle: an
 * ellipse through the diamond's corners, widened by {@link RING_SPREAD}, with
 * an amber glow inside and a bright edge over a dark band.
 */
/** The ring's two radii about the footprint's middle. */
const ringRadii = (corners: Corners): { rx: number; ry: number } => {
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    rx: ((Math.max(...xs) - Math.min(...xs)) / 2) * RING_SPREAD,
    ry: ((Math.max(...ys) - Math.min(...ys)) / 2) * RING_SPREAD,
  };
};

const drawRing = (ring: Graphics, corners: Corners | null): void => {
  ring.clear();
  if (!corners) return;
  const { rx, ry } = ringRadii(corners);
  ring
    // A soft warm pool over the ground, about 0.17 in the middle down to 0.06 at the edge.
    .ellipse(0, 0, rx, ry)
    .fill({ color: AMBER, alpha: 0.06 })
    .ellipse(0, 0, rx * 0.72, ry * 0.72)
    .fill({ color: RING_EDGE, alpha: 0.06 })
    .ellipse(0, 0, rx * 0.42, ry * 0.42)
    .fill({ color: RING_EDGE, alpha: 0.06 })
    // A light dark band under the edge, so it reads on grass, then a thin bright edge:
    // softer than before (neon, 26 Nov 2026), the lit building is the main sign now.
    .ellipse(0, 0, rx, ry)
    .stroke({ width: 5.5, color: RING_DARK, alpha: 0.38 })
    .ellipse(0, 0, rx, ry)
    .stroke({ width: 3, color: RING_EDGE, alpha: 0.8 });
};
