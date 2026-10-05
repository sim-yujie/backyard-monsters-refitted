import { Container, Graphics, Text } from "pixi.js";
import { jobBarScale } from "./YardJobBars";
import type { Point } from "./YardGrid";

/**
 * The hatchery numbers drawn over the yard while the Hatch tab is open
 * (#268, option B): each hatchery shows the number the tab gives its line, so
 * "Hatchery 2" in the window is the building with a 2 over it, and the one a
 * batch goes to wears the window's cyan, with an outline round its footprint
 * (the outline is the renderer's chrome, `YardRenderer.drawChrome`).
 *
 * The tab decides everything (`hatcheryNumbers`, `hatchPlan.ts`, and which
 * line is chosen) and hands it over through the scene's `markHatcheries`
 * hook; this layer only draws it, and draws nothing once handed null.
 *
 * A badge sits where a job bar would (`YardRenderer.jobBarAnchor`), raised
 * over the bar when the hatchery has one, and grows against the zoom as the
 * bars do, so a number stays readable zoomed out.
 */

/** What the Hatch tab asks the yard to show. */
export interface HatcheryMarks {
  /** Each hatchery's number by building id, as the tab numbers its lines. */
  readonly numbers: ReadonlyMap<number, number>;
  /** The hatchery a batch goes to, outlined and in cyan; null for none. */
  readonly chosen: number | null;
}

/** Whether two sets of marks draw the same. */
export const sameMarks = (a: HatcheryMarks | null, b: HatcheryMarks | null): boolean => {
  if (a === b) return true;
  if (!a || !b || a.chosen !== b.chosen || a.numbers.size !== b.numbers.size) return false;
  for (const [id, number] of a.numbers) if (b.numbers.get(id) !== number) return false;
  return true;
};

/** The badge's radius and its gap above the anchor, world pixels at zoom 1. */
export const BADGE_RADIUS = 13;
const BADGE_GAP = 6;

/** The window's colours: `--colour-accent` for the chosen, amber for the rest. */
export const CHOSEN_FILL = 0x3dd6f5;
const CHOSEN_TEXT = 0x04212a;
const OTHER_FILL = 0xf5b94a;
const OTHER_TEXT = 0x2a1a00;
const RIM = 0x0f1c26;

/** Where a badge goes, or null when the building is not drawn. */
export type MarkAnchor = (id: number) => Point | null;

export class YardHatchMarks {
  readonly root = new Container();

  private marks: HatcheryMarks | null = null;
  private zoom = 1;
  private readonly badges = new Map<number, Container>();

  constructor(private readonly anchorOf: MarkAnchor) {
    this.root.eventMode = "none";
  }

  /** The marks being drawn, or null. */
  get current(): HatcheryMarks | null {
    return this.marks;
  }

  /** The badge drawn over each hatchery, by id: its number, and whether it is the chosen one. */
  get drawn(): { id: number; number: number; chosen: boolean }[] {
    const marks = this.marks;
    if (!marks) return [];
    return [...this.badges.keys()].map((id) => ({
      id,
      number: marks.numbers.get(id) ?? 0,
      chosen: id === marks.chosen,
    }));
  }

  /** Draws these marks, or none; returns whether anything changed. */
  set(marks: HatcheryMarks | null): boolean {
    if (sameMarks(this.marks, marks)) return false;
    this.marks = marks;
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

  /** Puts every badge back over its hatchery: after art arrives or a bar comes and goes. */
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
    const marks = this.marks;
    if (!marks) return;
    const scale = jobBarScale(this.zoom);
    // The chosen one last, so it is on top where two badges overlap.
    const order = [...marks.numbers].sort(
      ([a], [b]) => Number(a === marks.chosen) - Number(b === marks.chosen),
    );
    for (const [id, number] of order) {
      const chosen = id === marks.chosen;
      const badge = new Container();
      badge.scale.set(scale);
      const y = -BADGE_RADIUS - BADGE_GAP;
      const disc = new Graphics()
        .circle(0, y, BADGE_RADIUS)
        .fill({ color: chosen ? CHOSEN_FILL : OTHER_FILL })
        .stroke({ width: 2, color: RIM, alpha: 0.85 });
      const label = new Text({
        text: String(number),
        style: {
          // Titan One (#223) has one weight, already bold; no fontWeight, or
          // the browser fakes a heavier cut on a face that cannot get bolder.
          fontFamily: "Titan One, sans-serif",
          fontSize: 16,
          fill: chosen ? CHOSEN_TEXT : OTHER_TEXT,
        },
        resolution: 2,
      });
      label.anchor.set(0.5, 0.5);
      label.position.set(0, y);
      badge.addChild(disc, label);
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
