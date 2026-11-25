import "./cluster.css";
import { CellType, isFogCell, isPlayerCell, type MapCell } from "@/api/types";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { shieldUrl } from "@/game/alliance/allianceRules";
import { classicLook } from "@/game/classicLook";
import { mapRoomGrid } from "@/game/HexGrid";
import { gameIconUrl } from "@/ui/gameIcon";
import { appearanceOf, type MapViewerContext } from "../cellVisuals";
import { hexZoom } from "../lod";
import type { MarkerFilter } from "../markerPins";
import type { ZoneRecord } from "../ZoneStore";
import { clusterArtUrl } from "./clusterArt";
import { ClusterLayout, tokenSize, type Project, type ScreenRect, type ScreenToken } from "./clusterLayout";
import {
  CAMPS_SHOWN_FROM,
  FAR_ZOOM,
  LONE_CREST_TAP,
  STACK_ORDER,
  cellKey,
  countText,
  groupCells,
  sameStep,
  stepFor,
  type ClusterCell,
  type ClusterGroup,
  type ClusterStep,
  type Grouping,
} from "./clusterRules";

/**
 * Map pin clustering on Map Room 2 (beta 9, owner's option C, 25 Nov 2026): draws the plaques and
 * crests (`clusterRules.ts`, `clusterLayout.ts`) as painted pictures over the map, and leaves out
 * the markers they stand for (`MarkerFilter`).
 *
 * The tokens are plain elements over the canvas, under the HUD, that never take a pointer: a press
 * on one still pans the map, and a tap is asked here first (`tapAt`) before it selects a cell. So
 * they cost the map's picture nothing: a still map stays still (the render gate), and moving it
 * only moves these elements.
 *
 * Work per frame is only what changed: the players' cells are read again when the map's cells
 * change (at most every {@link CELLS_EVERY_MS}), grouped again when the zoom crosses a step, and
 * laid out again when the camera or the screen moved.
 */

/** Cells are read again at most this often while zones keep arriving. */
const CELLS_EVERY_MS = 300;

/** How long the hexes a tap zoomed to glow (neon, 25 Nov: so the player sees where they went). */
const PULSE_MS = 900;
/** At most this many hexes glow after a tap. */
const PULSE_MAX = 150;

export interface ClusterLayerDeps {
  /** The map's marker filter (`MapRenderer.markerFilter`). */
  filter: MarkerFilter;
  /** The loaded zones and a cell lookup (`ZoneStore`). */
  zones: () => Iterable<ZoneRecord>;
  getCell: (col: number, row: number) => MapCell | undefined;
  /** Goes up whenever the cells may show differently (`MapRenderer.cellsVersion`). */
  cellsVersion: () => number;
  viewer: () => MapViewerContext;
  /** The camera now. */
  camera: () => { zoom: number; x: number; y: number };
  /** Changes whenever the projection does apart from the camera (the tilt, the screen size). */
  projectionKey: () => unknown;
  /** Map point to canvas point, without allocating. */
  project: Project;
  /** The canvas in CSS pixels. */
  viewport: () => { width: number; height: number };
  /** The HUD's boxes over the map, canvas pixels (read rarely). */
  obstacles: () => ScreenRect[];
  /** Zooms in so this box of map pixels fills the screen (a tap on a token). */
  zoomToFit: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  /** Opens a cell's own panel (a lone crest's tap, when `LONE_CREST_TAP` is "info"). */
  openCell: (col: number, row: number) => void;
  /** A hex's size on the screen at a canvas height, relative to the flat map (the tilt), and its squash. */
  scaleAt: (y: number) => number;
  squash: () => number;
  /** The canvas; the tokens go just after it, over the map and under the HUD. */
  canvas: HTMLElement;
}

const art = clusterArtUrl;

const RANK: Record<ClusterGroup, number> = Object.fromEntries(STACK_ORDER.map((g, i) => [g, i + 1])) as Record<ClusterGroup, number>;

/** A token's element and what it shows now. */
interface Shown {
  readonly el: HTMLDivElement;
  readonly pic: HTMLImageElement;
  readonly count: HTMLSpanElement;
  kind: string;
  group: string;
  n: number;
  classic: boolean;
  aid: number;
  far: boolean;
  x: number;
  y: number;
}

export class ClusterLayer {
  private readonly layer = document.createElement("div");
  private readonly pulses = document.createElement("div");
  private readonly layout = new ClusterLayout();
  private readonly pool: Shown[] = [];
  private shownCount = 0;

  private cells: ClusterCell[] = [];
  private readonly seen = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);
  private cellsAt = -1;
  private cellsReadAt = -Infinity;
  private cellsDirty = true;

  private step: ClusterStep | null = null;
  private grouping: Grouping | null = null;
  private groupingDirty = true;

  // What the last layout was for: nothing moved means nothing to do.
  private laidZoom = Number.NaN;
  private laidX = Number.NaN;
  private laidY = Number.NaN;
  private laidW = 0;
  private laidH = 0;
  private laidKey: unknown = null;
  private laidClassic = false;

  private obstacleRects: ScreenRect[] = [];
  private obstaclesAt = -Infinity;
  private touch = false;
  private pulseUntil = 0;
  /** Numbers for the speed readout (dev only). */
  readonly stats = { tokens: 0, hiddenCells: 0, cells: 0, groupMs: 0, layoutMs: 0 };

  constructor(private readonly deps: ClusterLayerDeps) {
    this.layer.className = "mc-layer";
    this.layer.setAttribute("aria-hidden", "true");
    this.pulses.className = "mc-pulses";
    this.layer.append(this.pulses);
    deps.canvas.insertAdjacentElement("afterend", this.layer);
    try {
      this.touch = matchMedia("(pointer: coarse)").matches;
    } catch {
      this.touch = false;
    }
  }

  destroy(): void {
    this.layer.remove();
    this.deps.filter.setHidden([]);
    this.deps.filter.setCampsShown(true);
  }

  /**
   * Every frame, after the map drew. Returns true when the markers left out changed (the canvas
   * must draw again); the tokens themselves are elements and need no canvas draw.
   */
  update(): boolean {
    const { filter } = this.deps;
    const before = filter.version;
    const cam = this.deps.camera();
    const { width, height } = this.deps.viewport();
    const now = performance.now();

    filter.setCampsShown(cam.zoom >= CAMPS_SHOWN_FROM);
    if (this.pulseUntil !== 0) {
      if (now > this.pulseUntil) this.endPulse();
      else this.drawPulse();
    }

    const cellPx = mapRoomGrid.colStep * cam.zoom;
    const phone = width <= 620 || height <= 500;
    const step = stepFor(cam.zoom, cellPx, phone, cam.zoom >= hexZoom());
    if (!step) {
      if (this.step !== null || this.shownCount > 0) {
        this.step = null;
        this.grouping = null;
        filter.setHidden([]);
        this.show([]);
        this.laidZoom = Number.NaN;
      }
      return filter.version !== before;
    }

    const version = this.deps.cellsVersion();
    if (version !== this.cellsAt) this.cellsDirty = true;
    if (this.cellsDirty && now - this.cellsReadAt >= CELLS_EVERY_MS) {
      this.cellsAt = version;
      this.cellsReadAt = now;
      this.cellsDirty = false;
      this.readCells();
      this.groupingDirty = true;
    }
    if (this.groupingDirty || !sameStep(step, this.step)) {
      const started = performance.now();
      this.step = step;
      this.groupingDirty = false;
      this.grouping = groupCells(this.cells, step);
      filter.setHidden(this.grouping.hidden);
      this.stats.groupMs = performance.now() - started;
      this.stats.hiddenCells = this.grouping.hidden.length;
      this.laidZoom = Number.NaN;
    }

    const key = this.deps.projectionKey();
    const classic = classicLook();
    if (
      cam.zoom !== this.laidZoom ||
      cam.x !== this.laidX ||
      cam.y !== this.laidY ||
      width !== this.laidW ||
      height !== this.laidH ||
      key !== this.laidKey ||
      classic !== this.laidClassic
    ) {
      this.laidZoom = cam.zoom;
      this.laidX = cam.x;
      this.laidY = cam.y;
      this.laidW = width;
      this.laidH = height;
      this.laidKey = key;
      this.laidClassic = classic;
      if (now - this.obstaclesAt > 1000) {
        this.obstaclesAt = now;
        this.obstacleRects = this.deps.obstacles();
      }
      const started = performance.now();
      const shown = this.layout.layOut(this.grouping?.tokens ?? [], this.deps.project, {
        width,
        height,
        touch: this.touch,
        zoom: cam.zoom,
        obstacles: this.obstacleRects,
      });
      this.show(shown, classic, cam.zoom);
      this.stats.layoutMs = performance.now() - started;
    }
    return filter.version !== before;
  }

  /** The HUD moved or the screen changed: measured again at the next layout. */
  hudChanged(): void {
    this.obstaclesAt = -Infinity;
    this.laidZoom = Number.NaN;
  }

  /**
   * A tap at this canvas point: handled when it lands on a token (zooms in to it, or opens a lone
   * crest's cell, `LONE_CREST_TAP`). False lets the map select the cell under it as usual.
   */
  tapAt(x: number, y: number): boolean {
    if (this.shownCount === 0) return false;
    const hit = this.layout.hit(x, y, this.touch);
    if (!hit) return false;
    if (hit.kind === "crest" && LONE_CREST_TAP === "info") {
      const key = hit.token.cells[0]!;
      this.deps.openCell(key % WORLD_WIDTH, Math.floor(key / WORLD_WIDTH));
      return true;
    }
    this.deps.zoomToFit(hit);
    this.pulse(hit);
    return true;
  }

  /** Reads every player's cell from the loaded zones, once each (zones share their edges). */
  private readCells(): void {
    const viewer = this.deps.viewer();
    const nowSeconds = Date.now() / 1000;
    const out: ClusterCell[] = [];
    const seenKeys: number[] = [];
    for (const zone of this.deps.zones()) {
      for (const xs in zone.data) {
        const column = zone.data[xs];
        if (!column) continue;
        const col = Number(xs);
        for (const ys in column) {
          const row = Number(ys);
          const key = cellKey(col, row);
          if (this.seen[key] === 1) continue;
          this.seen[key] = 1;
          seenKeys.push(key);
          const cell = this.deps.getCell(col, row);
          if (!cell || isFogCell(cell) || !isPlayerCell(cell)) continue;
          const look = appearanceOf(cell, nowSeconds, viewer, { x: col, y: row });
          // The kit filter: only what stays bright is counted (#334); dimmed cells keep their markers.
          if (look.dimmed || look.relation === null) continue;
          const group = groupOf(look.relation, cell.b === CellType.HOME_CELL);
          if (!group) continue;
          const spot = mapRoomGrid.cellToPixel(col, row);
          out.push({ key, wx: spot.x, wy: spot.y, group, aid: cell.aid ?? 0 });
        }
      }
    }
    for (const key of seenKeys) this.seen[key] = 0;
    this.cells = out;
    this.stats.cells = out.length;
  }

  /** Puts the tokens on screen, reusing the elements; only a token whose content changed is redrawn. */
  private show(tokens: readonly ScreenToken[], classic = classicLook(), zoom = 0): void {
    const layer = this.layer;
    layer.classList.toggle("mc-layer--classic", classic);
    layer.classList.toggle("mc-layer--touch", this.touch);
    layer.classList.toggle("mc-layer--far", zoom <= FAR_ZOOM);
    while (this.pool.length < tokens.length) this.pool.push(this.makeToken());
    for (let i = 0; i < this.pool.length; i++) {
      const shown = this.pool[i]!;
      const token = tokens[i];
      if (!token) {
        if (i < this.shownCount) shown.el.hidden = true;
        continue;
      }
      if (i >= this.shownCount) shown.el.hidden = false;
      if (shown.x !== token.x || shown.y !== token.y) {
        shown.x = token.x;
        shown.y = token.y;
        shown.el.style.transform = `translate3d(${token.x.toFixed(1)}px,${token.y.toFixed(1)}px,0)`;
      }
      const aid = token.token.aid;
      const far = zoom <= FAR_ZOOM;
      if (
        shown.kind !== token.kind ||
        shown.group !== token.group ||
        shown.n !== token.count ||
        shown.classic !== classic ||
        shown.aid !== aid ||
        shown.far !== far
      ) {
        shown.kind = token.kind;
        shown.group = token.group;
        shown.n = token.count;
        shown.classic = classic;
        shown.aid = aid;
        shown.far = far;
        this.draw(shown, token, classic, zoom);
      }
    }
    this.shownCount = tokens.length;
    this.stats.tokens = tokens.length;
  }

  private makeToken(): Shown {
    const el = document.createElement("div");
    const pic = document.createElement("img");
    pic.className = "mc__pic";
    pic.alt = "";
    pic.decoding = "async";
    pic.draggable = false;
    const count = document.createElement("span");
    count.className = "mc__n";
    el.append(pic, count);
    el.hidden = true;
    this.layer.append(el);
    return { el, pic, count, kind: "", group: "", n: -1, classic: false, aid: -1, far: false, x: Number.NaN, y: Number.NaN };
  }

  private draw(shown: Shown, token: ScreenToken, classic: boolean, zoom: number): void {
    const { el, pic, count } = shown;
    const { hw, hh } = tokenSize(token.kind, token.group, token.count, this.touch, zoom);
    el.className = `mc mc--${token.kind} mc--${token.group}`;
    el.style.zIndex = String(RANK[token.group]);
    el.style.width = `${hw * 2}px`;
    el.style.height = `${hh * 2}px`;
    el.style.marginLeft = `${-hw}px`;
    el.style.marginTop = `${-hh}px`;
    if (token.kind === "crest") {
      pic.src = art(classic, `crest-${token.group as "home" | "you" | "hostile"}`);
      count.textContent = "";
      return;
    }
    el.style.setProperty("--mc-plaque", `url("${art(classic, token.group === "alliance" ? "plaque-alliance" : "plaque-other")}")`);
    // The bar's painted ends (30% of the picture each side) keep their shape.
    el.style.setProperty("--mc-cap", `${(hh * 2 * 0.85).toFixed(1)}px`);
    const emblem = token.group === "alliance" ? this.emblemOf(token.token.aid) : null;
    pic.src = emblem ?? (token.group === "alliance" ? gameIconUrl("alliance", 64) : art(classic, "icon-other"));
    count.textContent = countText(token.count);
  }

  /** The alliance's own shield picture, when the map knows it. */
  private emblemOf(aid: number): string | null {
    if (aid === 0) return null;
    const image = this.deps.viewer().allianceOf?.(aid)?.image;
    return image ? shieldUrl(image, "medium") : null;
  }

  /** The hexes a tap zoomed to glow for a moment, so the player sees where the plaque's cells are. */
  private pulse(hit: ScreenToken): void {
    const keys: number[] = [];
    const add = (cells: readonly number[]): void => {
      for (const key of cells) if (keys.length < PULSE_MAX) keys.push(key);
    };
    add(hit.token.cells);
    for (const more of hit.extra) add(more.cells);
    this.pulseCells = keys;
    this.pulseUntil = performance.now() + PULSE_MS;
    this.pulses.replaceChildren();
  }

  private pulseCells: number[] = [];
  private readonly pulsePoint = { x: 0, y: 0 };

  /** The rings on the tapped token's hexes, following the map while they glow (faded by CSS). */
  private drawPulse(): void {
    const rings = this.pulses.children;
    if (rings.length !== this.pulseCells.length) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < this.pulseCells.length; i++) {
        const ring = document.createElement("div");
        ring.className = "mc-pulse";
        frag.append(ring);
      }
      this.pulses.replaceChildren(frag);
    }
    const out = this.pulsePoint;
    const zoom = this.deps.camera().zoom;
    const squash = this.deps.squash();
    this.pulseCells.forEach((key, i) => {
      const ring = rings[i] as HTMLElement;
      const spot = mapRoomGrid.cellToPixel(key % WORLD_WIDTH, Math.floor(key / WORLD_WIDTH));
      if (!this.deps.project(spot.x, spot.y, out)) {
        ring.hidden = true;
        return;
      }
      ring.hidden = false;
      const scale = zoom * this.deps.scaleAt(out.y);
      const w = mapRoomGrid.cellWidth * scale;
      const h = mapRoomGrid.cellHeight * scale * squash;
      ring.style.width = `${w.toFixed(1)}px`;
      ring.style.height = `${h.toFixed(1)}px`;
      ring.style.transform = `translate3d(${(out.x - w / 2).toFixed(1)}px,${(out.y - h / 2).toFixed(1)}px,0)`;
    });
  }

  private endPulse(): void {
    this.pulseUntil = 0;
    this.pulseCells = [];
    this.pulses.replaceChildren();
  }
}

/** Which clustering group a relation falls in; friends and pinned friends are left alone. */
export const groupOf = (relation: string, home: boolean): ClusterGroup | null => {
  switch (relation) {
    case "you":
      return home ? "home" : "you";
    case "hostile":
    case "alliance":
    case "other":
      return relation;
    default:
      return null;
  }
};

