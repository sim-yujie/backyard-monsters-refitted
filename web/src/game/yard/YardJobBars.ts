import { Container, Graphics, Text } from "pixi.js";
import { formatCountdown } from "@/ui/format";
import { countdownProgress } from "./jobs";
import { damageOf, repairAt } from "./repair";
import type { Point } from "./YardGrid";
import type { Yard, YardBuilding } from "./yardModel";

/**
 * A small progress bar with the time left, drawn just above every building
 * that has a build or upgrade running (#139), the way the original drew one
 * over a building while it worked.
 *
 * Only on the player's own yard: the layer draws nothing until the scene
 * hands it a clock (`YardRenderer.setJobClock`), which the yard scene does for
 * its own yard and nobody does for a visit or an attack; a yard marked
 * `foreign` gets no bars even with one.
 *
 * The bars are rebuilt whenever the yard is shown, which the yard scene does
 * on every store change, so a job that finishes — predicted at zero or
 * answered by the server — takes its bar with it. Between changes the bars
 * are redrawn once a second from the same progress reading the building
 * panel uses (`countdownProgress`, `jobs.ts`), so the two cannot disagree.
 *
 * A building being repaired gets a bar too (#279), green, filling with its
 * health and showing the time to full health. The original drew "Repairing"
 * over the building with its health bar filling under it, in place of the
 * build or upgrade bar (`client/scripts/com/monsters/display/BuildingOverlay.as:124-126`,
 * `:225-232`), so a repair's bar stands in for the paused countdown's.
 *
 * The layer sits above every building, so a bar is never hidden behind the
 * building in front; bars are added in the yard's depth order, so where two
 * overlap the nearer building's bar is on top.
 */

/** Bar size in world pixels at zoom 1. */
export const BAR_WIDTH = 64;
export const BAR_HEIGHT = 8;
/** Gap between the top of the building's art and the bottom of its bar. */
const BAR_GAP = 4;
/** Below this zoom the time text is noise; the bar alone stays. */
export const TEXT_MIN_ZOOM = 0.5;
/**
 * The most a bar is enlarged against the zoom. Zoomed out the yard shrinks
 * and a bar drawn at world size would vanish with it; enlarging it without a
 * limit would cover the yard in bars.
 */
const MAX_COUNTER_SCALE = 1.8;

const BUILD_FILL = 0xffd479;
const UPGRADE_FILL = 0x8fd0ff;
const REPAIR_FILL = 0x7fdc6b;
const PAUSED_FILL = 0x9aa4ad;
const TRACK = 0x0f1c26;

/** What one bar reads at a moment. */
export interface JobBarState {
  readonly id: number;
  readonly kind: "build" | "upgrade" | "repair";
  /** 0 just started, 1 done; for a repair, the health now over full health. */
  readonly fraction: number;
  readonly remaining: number;
  readonly paused: boolean;
  /** The text over the bar: the time left, or "Paused". */
  readonly label: string;
}

/** The job kinds a bar is drawn for; the rest (fortify, rebuild) have no route yet. */
const hasBar = (building: YardBuilding): building is YardBuilding & {
  countdown: { kind: "build" | "upgrade" };
} => building.countdown?.kind === "build" || building.countdown?.kind === "upgrade";

/**
 * A running repair's bar at `now`, read the way the building panel reads it
 * (`damageOf`, `repairAt`); null when the repair is done by then (the store
 * is about to flip it), and undefined when the building is not repairing, so
 * its countdown's bar is drawn instead.
 */
const repairBar = (
  building: YardBuilding,
  savedAt: number,
  now: number,
): JobBarState | null | undefined => {
  if (!building.raw.rE) return undefined;
  const health = building.hp === null ? null : { [String(building.id)]: building.hp };
  const damage = damageOf(building.raw, { buildinghealthdata: health }, String(building.id));
  if (!damage) return undefined;
  const at = repairAt(damage, { savetime: savedAt, currenttime: savedAt }, now);
  if (at.now >= at.max) return null;
  return {
    id: building.id,
    kind: "repair",
    fraction: at.now / at.max,
    remaining: at.secondsLeft,
    paused: false,
    label: formatCountdown(at.secondsLeft),
  };
};

/**
 * Every bar the yard should show at `now` (server clock), in depth order:
 * one per building with a build or upgrade still running or a repair under
 * way. None on a foreign yard. A job whose time is up is left out: the store
 * is about to flip it.
 */
export const jobBarStates = (yard: Yard, now: number): JobBarState[] => {
  if (yard.foreign) return [];
  const bars: JobBarState[] = [];
  for (const building of yard.buildings) {
    const repair = repairBar(building, yard.savedAt, now);
    if (repair !== undefined) {
      if (repair) bars.push(repair);
      continue;
    }
    if (!hasBar(building)) continue;
    const progress = countdownProgress(building, now, yard.kind);
    if (!progress) continue;
    const paused = building.countdown.paused;
    if (!paused && progress.remaining <= 0) continue;
    bars.push({
      id: building.id,
      kind: building.countdown.kind,
      fraction: progress.fraction,
      remaining: progress.remaining,
      paused,
      label: paused ? "Paused" : formatCountdown(progress.remaining),
    });
  }
  return bars;
};

/** How much a bar is enlarged at a zoom: 1 at zoom 1 and closer, growing as the yard shrinks, to a limit. */
export const jobBarScale = (zoom: number): number =>
  zoom > 0 ? Math.min(MAX_COUNTER_SCALE, Math.max(1, 1 / zoom)) : MAX_COUNTER_SCALE;

/** Whether the time text is shown at a zoom. */
export const showsJobBarText = (zoom: number): boolean => zoom >= TEXT_MIN_ZOOM;

interface BarView {
  readonly root: Container;
  readonly fill: Graphics;
  readonly text: Text;
  /** The job's time is up; the bar stays hidden until the next `show` drops it. */
  done: boolean;
}

/**
 * Where a bar sits: the middle of the building, at the top of what is drawn
 * of it. Null when the building is not drawn (stored in the planner's drawer).
 */
export type JobBarAnchor = (id: number) => Point | null;

export class YardJobBars {
  readonly root = new Container();

  private yard: Yard | null = null;
  private clock: (() => number) | null = null;
  private readonly bars = new Map<number, BarView>();
  /** The whole second last drawn, so a frame inside the same second costs nothing. */
  private drawnSecond = Number.NaN;
  private zoom = 1;

  constructor(private readonly anchorOf: JobBarAnchor) {
    this.root.eventMode = "none";
  }

  /** Starts drawing bars against a server clock, or stops when passed null. */
  setClock(clock: (() => number) | null): void {
    this.clock = clock;
    this.rebuild();
  }

  /** Replaces the bars with the ones this yard needs. */
  show(yard: Yard): void {
    this.yard = yard;
    this.rebuild();
  }

  /** Called every frame; redraws only when the second has turned. */
  update(): void {
    const clock = this.clock;
    if (!clock || this.bars.size === 0) return;
    const second = Math.floor(clock());
    if (second === this.drawnSecond) return;
    this.drawnSecond = second;
    this.redraw(clock());
  }

  setZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    const scale = jobBarScale(zoom);
    const text = showsJobBarText(zoom);
    for (const bar of this.bars.values()) {
      bar.root.scale.set(scale);
      bar.text.visible = text;
    }
  }

  /** Puts every bar back over its building: after a planner move, or once art has arrived. */
  reposition(): void {
    for (const [id, bar] of this.bars) {
      const anchor = this.anchorOf(id);
      bar.root.visible = anchor !== null && !bar.done;
      if (anchor) bar.root.position.set(anchor.x, anchor.y - BAR_GAP);
    }
  }

  /** The ids with a bar showing, in drawing order. */
  get ids(): number[] {
    return [...this.bars].filter(([, bar]) => bar.root.visible).map(([id]) => id);
  }

  /** Every id given a bar by the last rebuild, showing or not. */
  get barIds(): ReadonlySet<number> {
    return new Set(this.bars.keys());
  }

  destroy(): void {
    this.clear();
    this.root.destroy({ children: true });
  }

  private rebuild(): void {
    this.clear();
    const yard = this.yard;
    const clock = this.clock;
    if (!yard || !clock) return;

    const now = clock();
    const scale = jobBarScale(this.zoom);
    const text = showsJobBarText(this.zoom);
    for (const state of jobBarStates(yard, now)) {
      const root = new Container();
      root.scale.set(scale);

      const track = new Graphics()
        .roundRect(-BAR_WIDTH / 2 - 1, -BAR_HEIGHT - 1, BAR_WIDTH + 2, BAR_HEIGHT + 2, 4)
        .fill({ color: TRACK, alpha: 0.85 });
      const fill = new Graphics();
      const label = new Text({
        text: state.label,
        style: {
          // Titan One (#223) has one weight, already bold; no fontWeight, or
          // the browser fakes a heavier cut on a face that cannot get bolder.
          fontFamily: "Titan One, sans-serif",
          fontSize: 13,
          fill: 0xffffff,
          stroke: { color: TRACK, width: 3 },
        },
        // The yard is often looked at closer than 1:1, where a 1x glyph is soft.
        resolution: 2,
      });
      label.anchor.set(0.5, 1);
      label.position.set(0, -BAR_HEIGHT - 3);
      label.visible = text;

      root.addChild(track, fill, label);
      this.root.addChild(root);
      const bar: BarView = { root, fill, text: label, done: false };
      this.bars.set(state.id, bar);
      paint(bar, state);
    }
    this.drawnSecond = Math.floor(now);
    this.reposition();
  }

  private redraw(now: number): void {
    const yard = this.yard;
    if (!yard) return;
    const states = new Map(jobBarStates(yard, now).map((state) => [state.id, state]));
    for (const [id, bar] of this.bars) {
      const state = states.get(id);
      // Time is up: the store flips the building within the second and the
      // next `show` drops the bar for good.
      if (!state) bar.done = true;
      else paint(bar, state);
    }
    // Art that has arrived since moves a bar up to its real top.
    this.reposition();
  }

  private clear(): void {
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    this.bars.clear();
    this.drawnSecond = Number.NaN;
  }
}

/** Draws a bar's fill and text for a state. */
const paint = (bar: BarView, state: JobBarState): void => {
  const color = state.paused
    ? PAUSED_FILL
    : state.kind === "repair"
      ? REPAIR_FILL
      : state.kind === "build"
        ? BUILD_FILL
        : UPGRADE_FILL;
  const width = Math.max(0, Math.min(1, state.fraction)) * BAR_WIDTH;
  bar.fill.clear();
  if (width > 0) {
    const radius = Math.min(3, width / 2);
    bar.fill.roundRect(-BAR_WIDTH / 2, -BAR_HEIGHT, width, BAR_HEIGHT, radius).fill({ color });
  }
  if (bar.text.text !== state.label) bar.text.text = state.label;
};
