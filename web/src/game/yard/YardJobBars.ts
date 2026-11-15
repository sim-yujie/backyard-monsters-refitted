import { Container, Graphics, Text } from "pixi.js";
import { HELPERS_PER_JOB, helperBadgeOf, helperBadgeText, type HelperBadge } from "@/game/friends/helpModel";
import { formatCountdown } from "@/ui/format";
import { countdownProgress } from "./jobs";
import { damageOf, repairAt } from "./repair";
import { paintIcon } from "./yardIcons";
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
 *
 * A build, upgrade or fortify also wears a helper badge (beta 8, owner 15 Nov
 * 2026): the friends' painted critters and "2/5", how many friends have sped
 * the job up out of the 5 who may (`hl`, {@link helperBadgeOf}). It sits at
 * the right end of the job's bar; a fortify, which has no bar, wears it
 * beside its working mark. All 5 turns it green. It goes with the job.
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

/** The helper badge: a pill this size (world px at zoom 1), a gap off the bar's end. */
export const HELPER_BADGE_WIDTH = 50;
export const HELPER_BADGE_HEIGHT = 20;
const HELPER_BADGE_GAP = 3;
/** The painted critters' side, at the pill's left. */
const HELPER_ICON = 20;
/** Dark like the bar's track; all 5 helpers turn it green. */
const HELPER_FILL = 0x0f1c26;
const HELPER_RIM = 0xd6ecff;
const HELPER_FULL_FILL = 0x2f7a3a;
const HELPER_FULL_RIM = 0x7fdc6b;
/** Where a fortify's badge sits off its anchor: beside the 26 px working mark, 6 px over the art. */
const NO_BAR_X = 16;
const NO_BAR_Y = 19;

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

/**
 * Every helper badge the yard should show at `now` (server clock): one per
 * building with a build, upgrade or fortify still running. Friends help in
 * a main yard only (`controllers/friends/help.ts`), so none on an outpost or
 * the Inferno; none on a foreign yard.
 */
export const helperBadgeStates = (yard: Yard, now: number): HelperBadge[] => {
  if (yard.foreign || yard.kind !== "main") return [];
  const badges: HelperBadge[] = [];
  for (const building of yard.buildings) {
    const badge = helperBadgeOf(building, now);
    if (badge) badges.push(badge);
  }
  return badges;
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

interface HelperView {
  readonly root: Container;
  /** The helpers it was drawn for: a change redraws it. */
  helpers: number;
  done: boolean;
}

/**
 * Where a bar sits: the middle of the building, at the top of what is drawn
 * of it. Null when the building is not drawn (stored in the planner's drawer).
 */
export type JobBarAnchor = (id: number) => Point | null;

export class YardJobBars {
  readonly root = new Container();
  /** The helper badges: over the bars. Add to the scene after `root`. */
  readonly helperRoot = new Container();

  private yard: Yard | null = null;
  private clock: (() => number) | null = null;
  private readonly bars = new Map<number, BarView>();
  private readonly helpers = new Map<number, HelperView>();
  /** The whole second last drawn, so a frame inside the same second costs nothing. */
  private drawnSecond = Number.NaN;
  private zoom = 1;

  constructor(private readonly anchorOf: JobBarAnchor) {
    this.root.eventMode = "none";
    this.helperRoot.eventMode = "none";
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
    if (!clock || (this.bars.size === 0 && this.helpers.size === 0)) return;
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
    for (const helper of this.helpers.values()) helper.root.scale.set(scale);
    this.reposition();
  }

  /** Puts every bar back over its building: after a planner move or a drawer change. */
  reposition(): void {
    for (const [id, bar] of this.bars) {
      const anchor = this.anchorOf(id);
      bar.root.visible = anchor !== null && !bar.done;
      if (anchor) bar.root.position.set(anchor.x, anchor.y - BAR_GAP);
    }
    const scale = jobBarScale(this.zoom);
    for (const [id, helper] of this.helpers) {
      const anchor = this.anchorOf(id);
      const bar = this.bars.get(id);
      const onBar = bar !== undefined && bar.root.visible;
      helper.root.visible = anchor !== null && !helper.done && (onBar || bar === undefined);
      if (!anchor) continue;
      if (onBar) {
        helper.root.position.set(
          anchor.x + (BAR_WIDTH / 2 + HELPER_BADGE_GAP) * scale,
          anchor.y - BAR_GAP - (BAR_HEIGHT / 2) * scale,
        );
      } else {
        helper.root.position.set(anchor.x + NO_BAR_X, anchor.y - NO_BAR_Y);
      }
    }
  }

  /** The ids wearing a helper badge now, and what each says ("2/5"). */
  get helperBadges(): { id: number; text: string; full: boolean }[] {
    return [...this.helpers]
      .filter(([, view]) => view.root.visible)
      .map(([id, view]) => ({ id, text: helperBadgeText(view.helpers), full: view.helpers >= HELPERS_PER_JOB }));
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
    this.helperRoot.destroy({ children: true });
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
    for (const badge of helperBadgeStates(yard, now)) {
      const root = drawHelperBadge(badge);
      root.scale.set(scale);
      this.helperRoot.addChild(root);
      this.helpers.set(badge.id, { root, helpers: badge.helpers, done: false });
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
    const badges = new Set(helperBadgeStates(yard, now).map((badge) => badge.id));
    for (const [id, helper] of this.helpers) if (!badges.has(id)) helper.done = true;
    // Hides a bar whose time is up; its place is the art table's and holds still.
    this.reposition();
  }

  private clear(): void {
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    for (const child of this.helperRoot.removeChildren()) child.destroy({ children: true });
    this.bars.clear();
    this.helpers.clear();
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

/**
 * One helper badge, its left end at the origin and its middle on the
 * origin's line: a pill, the friends' painted critters (two drawn heads
 * until the picture is in) and "2/5".
 */
const drawHelperBadge = (badge: HelperBadge): Container => {
  const root = new Container();
  root.eventMode = "none";
  root.label = `helpers-${badge.id}`;
  const h = HELPER_BADGE_HEIGHT;
  const pill = new Graphics()
    .roundRect(0, -h / 2, HELPER_BADGE_WIDTH, h, h / 2)
    .fill({ color: badge.full ? HELPER_FULL_FILL : HELPER_FILL, alpha: 0.92 })
    .stroke({ width: 1.5, color: badge.full ? HELPER_FULL_RIM : HELPER_RIM, alpha: 0.8 });
  const iconX = 3 + HELPER_ICON / 2;
  // Two heads and shoulders, light on the dark pill, until the painting comes.
  const heads = new Graphics()
    .circle(iconX - 4, -3, 3.5)
    .fill({ color: HELPER_RIM })
    .roundRect(iconX - 9, 1, 10, 6, 3)
    .fill({ color: HELPER_RIM })
    .circle(iconX + 4, -2, 3)
    .fill({ color: HELPER_RIM, alpha: 0.8 })
    .roundRect(iconX, 2, 8, 5, 2.5)
    .fill({ color: HELPER_RIM, alpha: 0.8 });
  const text = new Text({
    text: helperBadgeText(badge.helpers),
    style: {
      fontFamily: "Titan One, sans-serif",
      fontSize: 13,
      fill: 0xffffff,
      stroke: { color: TRACK, width: 3 },
    },
    resolution: 2,
  });
  text.anchor.set(0.5, 0.5);
  text.position.set(3 + HELPER_ICON + (HELPER_BADGE_WIDTH - 3 - HELPER_ICON) / 2, 0);
  root.addChild(pill, heads, text);
  paintIcon(root, "friends", HELPER_ICON, { x: iconX, y: 0 }, heads);
  return root;
};
