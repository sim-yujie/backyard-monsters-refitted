import { Container, Graphics, Text } from "pixi.js";
import { savingTag, type HelpMark } from "@/game/friends/helpModel";
import { paintIcon } from "./yardIcons";
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
 *   (`ground`, under the buildings, so it rings the building's foot);
 * - a big amber **wrench** disc with the painted tools in it, bobbing gently,
 *   where a job bar would stand (`root`, over the buildings);
 * - under the wrench, a small green **tag** with what a speed-up would take
 *   off ("-18m").
 *
 * A building that only takes a repair keeps today's small amber wrench, with
 * no ring and no tag (owner, 15 Nov 2026: Help all and the bar's count are
 * speed-ups only; a repair is still given from the building's panel).
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
/** The painted tools' side inside the disc. */
const TOOLS_SIDE = 30;
/** How high the wrench bobs, and how long one bob takes (seconds). */
const BOB_HEIGHT = 5;
const BOB_PERIOD = 1.4;
/** One pulse of the ring, seconds, and its faintest. */
const PULSE_PERIOD = 1.6;
const PULSE_LOW = 0.6;
/** The ring stands this much wider than the footprint, so it shows round the building's foot. */
const RING_SPREAD = 1.25;

/** The mock-up's amber, a cream rim and a dark wrench (until the painted tools come). */
const AMBER = 0xf2a51a;
const RIM = 0xfff3d6;
const WRENCH = 0x3a2200;
/** The tag: dark green, a bright green edge, white words. */
const TAG_FILL = 0x143c1e;
const TAG_EDGE = 0x57e389;
const TAG_HEIGHT = 20;

/** Where a building's footprint is drawn now, or null when it is not. */
export type MarkCorners = (id: number) => Corners | null;

interface MarkView {
  /** Placed at the anchor; scaled against the zoom. */
  readonly badge: Container;
  /** The disc and its tag, moved by the bob. */
  readonly bob: Container;
  readonly tag: Text | null;
  /** The ground ring, at the footprint's middle; none for a repair only. */
  readonly ring: Graphics | null;
  readonly kind: HelpMark["kind"];
  saving: number | null;
}

export interface HelpMarksOptions {
  readonly reducedMotion?: boolean;
}

export class YardHelpMarks {
  /** The wrenches and their tags: over the buildings. */
  readonly root = new Container();
  /** The rings: under the buildings, over the ground. */
  readonly ground = new Container();

  private marks: readonly HelpMark[] = [];
  private zoom = 1;
  private time = 0;
  private readonly views = new Map<number, MarkView>();
  private readonly reducedMotion: boolean;

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
    return this.views.size > 0;
  }

  /** The buildings wearing a wrench, by id. */
  get drawn(): number[] {
    return [...this.views.keys()];
  }

  /** The tag on each wrench now ("-18m"), or null with none; by id. */
  get tags(): Map<number, string | null> {
    return new Map([...this.views].map(([id, view]) => [id, view.tag?.text ?? null]));
  }

  /**
   * Draws these marks and no others; returns whether anything changed. Only
   * a different set of buildings redraws them all; a new saving only
   * rewrites its tag.
   */
  set(marks: readonly HelpMark[]): boolean {
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
    const scale = jobBarScale(zoom);
    for (const view of this.views.values()) view.badge.scale.set(scale);
    this.reposition();
  }

  /** Advances the pulse and the bob; called every frame while any mark is drawn. */
  update(deltaSeconds: number): void {
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
    const scale = jobBarScale(this.zoom);
    for (const [id, view] of this.views) {
      if (!view.badge.visible) continue;
      const big = view.kind === "speedup";
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
      if (anchor) view.badge.position.set(anchor.x, anchor.y);
      if (!view.ring) continue;
      const corners = this.cornersOf(id);
      view.ring.visible = corners !== null;
      if (corners) {
        const middle = middleOf(corners);
        view.ring.position.set(middle.x, middle.y);
      }
    }
  }

  destroy(): void {
    this.clear();
    this.root.destroy({ children: true });
    this.ground.destroy({ children: true });
  }

  private rebuild(): void {
    this.clear();
    const scale = jobBarScale(this.zoom);
    for (const mark of this.marks) {
      const badge = new Container();
      badge.scale.set(scale);
      const bob = new Container();
      badge.addChild(bob);
      this.root.addChild(badge);

      if (mark.kind === "repair") {
        bob.addChild(...smallWrench());
        this.views.set(mark.id, { badge, bob, tag: null, ring: null, kind: mark.kind, saving: null });
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

      const ring = new Graphics();
      drawRing(ring, this.cornersOf(mark.id));
      this.ground.addChild(ring);
      this.views.set(mark.id, { badge, bob, tag, ring, kind: mark.kind, saving: mark.saving });
    }
    this.update(0);
    this.reposition();
  }

  private clear(): void {
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    for (const child of this.ground.removeChildren()) child.destroy({ children: true });
    this.views.clear();
  }
}

/** Today's small wrench (#374), for a building that only takes a repair. */
const smallWrench = (): Graphics[] => {
  const y = -SMALL_RISE;
  const disc = new Graphics()
    .circle(0, y, SMALL_RADIUS)
    .fill({ color: SMALL_FILL })
    .stroke({ width: 2, color: SMALL_RIM, alpha: 0.85 });
  // A spanner: a handle, a round head, and the jaw's gap cut in the disc's colour.
  const wrench = new Graphics()
    .roundRect(-2.5, -1, 5, 13, 2)
    .fill({ color: SMALL_WRENCH })
    .circle(0, -4, 5.5)
    .fill({ color: SMALL_WRENCH })
    .rect(-2, -10.5, 4, 6)
    .fill({ color: SMALL_FILL });
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
 * an amber glow inside, a soft halo and a bright edge.
 */
const drawRing = (ring: Graphics, corners: Corners | null): void => {
  ring.clear();
  if (!corners) return;
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const rx = ((Math.max(...xs) - Math.min(...xs)) / 2) * RING_SPREAD;
  const ry = ((Math.max(...ys) - Math.min(...ys)) / 2) * RING_SPREAD;
  ring
    .ellipse(0, 0, rx, ry)
    .fill({ color: AMBER, alpha: 0.12 })
    .ellipse(0, 0, rx * 0.78, ry * 0.78)
    .fill({ color: AMBER, alpha: 0.14 })
    .ellipse(0, 0, rx * 0.5, ry * 0.5)
    .fill({ color: AMBER, alpha: 0.16 })
    .ellipse(0, 0, rx + 3, ry + 3)
    .stroke({ width: 10, color: AMBER, alpha: 0.28 })
    .ellipse(0, 0, rx, ry)
    .stroke({ width: 4, color: AMBER, alpha: 1 });
};
