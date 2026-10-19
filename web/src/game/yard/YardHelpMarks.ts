import { Container, Graphics } from "pixi.js";
import { jobBarScale } from "./YardJobBars";
import type { MarkAnchor } from "./YardHatchMarks";

/**
 * The wrench markers drawn over a friend's yard on a visit
 * (`docs/design/friends.md` §3.3, issue #374): one over each building the
 * help block says can be sped up or repaired now. The scene decides which
 * (`helpableIds`); this layer only draws them, and draws nothing once handed
 * an empty set.
 *
 * A badge sits where a job bar would (`YardRenderer.jobBarAnchor`), as the
 * hatchery numbers do, and grows against the zoom so it stays readable
 * zoomed out. A tap on a badge picks its building (`pick`), as a tap on the
 * building does.
 */

/** The badge's radius and its gap above the anchor, world pixels at zoom 1. */
const BADGE_RADIUS = 14;
const BADGE_GAP = 6;

/** Amber like the friends bar's wrench badge, a dark rim, a dark wrench. */
const FILL = 0xf5b94a;
const RIM = 0x0f1c26;
const WRENCH = 0x2a1a00;

export class YardHelpMarks {
  readonly root = new Container();

  private ids: ReadonlySet<number> = new Set();
  private zoom = 1;
  private readonly badges = new Map<number, Container>();

  constructor(private readonly anchorOf: MarkAnchor) {
    this.root.eventMode = "none";
  }

  /** Whether any wrench is drawn. */
  get active(): boolean {
    return this.badges.size > 0;
  }

  /** The buildings wearing a wrench, by id. */
  get drawn(): number[] {
    return [...this.badges.keys()];
  }

  /** Draws a wrench over these buildings and no others; returns whether anything changed. */
  set(ids: ReadonlySet<number>): boolean {
    if (ids.size === this.ids.size && [...ids].every((id) => this.ids.has(id))) return false;
    this.ids = new Set(ids);
    this.rebuild();
    return true;
  }

  setZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    const scale = jobBarScale(zoom);
    for (const badge of this.badges.values()) badge.scale.set(scale);
    this.reposition();
  }

  /** Puts every badge back over its building: after art arrives. */
  /** The building whose badge is under a world point, or null. */
  pick(worldX: number, worldY: number): number | null {
    const scale = jobBarScale(this.zoom);
    const radius = BADGE_RADIUS * scale;
    for (const [id, badge] of this.badges) {
      if (!badge.visible) continue;
      const dx = worldX - badge.x;
      const dy = worldY - (badge.y - (BADGE_RADIUS + BADGE_GAP) * scale);
      if (dx * dx + dy * dy <= radius * radius) return id;
    }
    return null;
  }

  reposition(): void {
    for (const [id, badge] of this.badges) {
      const anchor = this.anchorOf(id);
      badge.visible = anchor !== null;
      if (anchor) badge.position.set(anchor.x, anchor.y);
    }
  }

  destroy(): void {
    this.clear();
    this.root.destroy({ children: true });
  }

  private rebuild(): void {
    this.clear();
    const scale = jobBarScale(this.zoom);
    for (const id of this.ids) {
      const badge = new Container();
      badge.scale.set(scale);
      const y = -BADGE_RADIUS - BADGE_GAP;
      const disc = new Graphics()
        .circle(0, y, BADGE_RADIUS)
        .fill({ color: FILL })
        .stroke({ width: 2, color: RIM, alpha: 0.85 });
      // A spanner: a handle, a round head, and the jaw's gap cut in the disc's colour.
      const wrench = new Graphics()
        .roundRect(-2.5, -1, 5, 13, 2)
        .fill({ color: WRENCH })
        .circle(0, -4, 5.5)
        .fill({ color: WRENCH })
        .rect(-2, -10.5, 4, 6)
        .fill({ color: FILL });
      wrench.position.set(0, y);
      wrench.rotation = Math.PI / 4;
      badge.addChild(disc, wrench);
      this.root.addChild(badge);
      this.badges.set(id, badge);
    }
    this.reposition();
  }

  private clear(): void {
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    this.badges.clear();
  }
}
