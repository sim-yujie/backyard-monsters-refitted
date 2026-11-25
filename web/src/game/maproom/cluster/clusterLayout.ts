import { CREST_STACK, FAR_ZOOM, STACK_ORDER, countText, type ClusterGroup, type WorldToken } from "./clusterRules";

/**
 * Where the cluster tokens stand on the screen (map pin clustering, `clusterRules.ts`). Runs when
 * the camera moves, so it allocates nothing once its pool has grown: the tokens come from
 * `groupCells` (worked out only when the zoom step or the cells change) and are only projected,
 * merged where the tilt squeezes plaques together, pushed off each other, and dropped where they
 * would be cut by the screen's edge or sit under the HUD.
 */

/** A box on the screen, canvas pixels. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the layout needs to know about the screen. */
export interface LayoutView {
  width: number;
  height: number;
  /** A touch screen: bigger tokens and gaps. */
  touch: boolean;
  zoom: number;
  /** The HUD's bars and buttons over the map, canvas pixels: no token goes under them. */
  obstacles: readonly ScreenRect[];
  /** Boxes plaques keep off (a tapped plaque's unpacked outposts); crests ignore them. */
  avoid?: readonly ScreenRect[] | undefined;
}

/** Projects a map point to the canvas into `out`; false when it is behind the camera. */
export type Project = (wx: number, wy: number, out: { x: number; y: number }) => boolean;

/** One token as placed on the screen. */
export interface ScreenToken {
  /** The first world token it stands for (more when plaques merged on the screen). */
  token: WorldToken;
  kind: WorldToken["kind"];
  group: ClusterGroup;
  count: number;
  /** Its middle on the canvas. */
  x: number;
  y: number;
  /** Half its drawn width and height. */
  hw: number;
  hh: number;
  /** The box round every cell it stands for, map pixels. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Merged into another plaque this layout. */
  merged: boolean;
  /** Further world tokens merged into it this layout (only filled on a merge). */
  readonly extra: WorldToken[];
}

/** Space kept between tokens, and to the screen's edges and the HUD. */
const GAP = 4;
const EDGE = 4;
const HUD_GAP = 8;
/** A crest needs less: it stands on its outpost, and neon r2 saw crests above the kit bar dropped. */
const CREST_HUD_GAP = 3;
const hudGap = (s: ScreenToken): number => (s.kind === "crest" ? CREST_HUD_GAP : HUD_GAP);
/** How far a plaque may step in from the screen's edge or off the HUD. */
const PLAQUE_SHIFT = 60;
/** How far a token may be pushed off its spot: a crest stays on its outpost. */
const MAX_PUSH = { crest: 10, plaque: 48 } as const;
/** A crest cut by the edge or touching the HUD may step in this far (neon r1: none may vanish). */
const CREST_SHIFT = 12;
/** Smallest tap target on a touch screen, CSS pixels. */
export const TOUCH_TARGET = 44;

/** A token's drawn size (half width, half height), shared by the layout and the drawing. */
export const tokenSize = (
  kind: WorldToken["kind"],
  group: ClusterGroup,
  count: number,
  touch: boolean,
  zoom: number,
): { hw: number; hh: number } => {
  if (kind === "plaque") {
    // Shield, then the count: a plaque widens with its digits.
    const digits = countText(count).length;
    const h = touch ? 30 : 26;
    return { hw: (h + 8 + digits * (touch ? 10 : 9) + 10) / 2, hh: h / 2 };
  }
  const far = zoom <= FAR_ZOOM;
  const base = touch ? (far ? 34 : 40) : far ? 26 : 32;
  // The main yard anchors the map: a third bigger (neon r1).
  const w = group === "home" ? Math.round(base * 1.35) : base;
  return { hw: w / 2, hh: (w * 1.12) / 2 };
};

const RANK: Record<ClusterGroup, number> = Object.fromEntries(STACK_ORDER.map((g, i) => [g, i])) as Record<ClusterGroup, number>;

/** Most important first (home, hostile, yours, alliance, neutral), then bigger counts. */
const byImportance = (a: ScreenToken, b: ScreenToken): number => RANK[b.group] - RANK[a.group] || b.count - a.count;

export class ClusterLayout {
  private readonly pool: ScreenToken[] = [];
  private used = 0;
  /** The tokens on screen after the last `layOut`, most important first. */
  readonly shown: ScreenToken[] = [];
  private readonly point = { x: 0, y: 0 };
  private readonly placedGrid = new Grid();
  private readonly mergeGrid = new Grid();
  private readonly keptGrid = new Grid();
  /** Neighbour lists, reused. */
  private readonly near: number[] = [];
  private readonly shiftNear: number[] = [];

  layOut(tokens: readonly WorldToken[], project: Project, view: LayoutView): readonly ScreenToken[] {
    this.used = 0;
    this.shown.length = 0;
    const margin = 80;
    for (const token of tokens) {
      if (!project(token.wx, token.wy, this.point)) continue;
      const { x, y } = this.point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < -margin || y < -margin || x > view.width + margin || y > view.height + margin) continue;
      const s = this.take(token);
      s.x = x;
      s.y = y;
      this.size(s, view);
      this.shown.push(s);
    }
    const list = this.shown;
    list.sort(byImportance);

    // Plaques of one kind squeezed together by the tilt (the far rows) become one; so do crests
    // of one side that would overlap (owner 25 Nov, CREST_STACK: one crest with a count, never own
    // with hostile, never the main yard). Leaders are found through a grid, so many crests stay cheap.
    const leaders = this.mergeGrid;
    leaders.reset(view.width, view.height, list.length);
    const near = this.near;
    for (let i = 0; i < list.length; i++) {
      const b = list[i]!;
      const stacks = b.kind === "plaque" || (CREST_STACK && b.group !== "home");
      if (!stacks) continue;
      leaders.near(b.x, b.y, b.hw + MAX_HALF + GAP, near);
      let into: ScreenToken | null = null;
      for (const j of near) {
        const a = list[j]!;
        if (a.kind !== b.kind || a.group !== b.group) continue;
        const pad = a.kind === "plaque" ? GAP : 0;
        if (Math.abs(a.x - b.x) >= a.hw + b.hw + pad || Math.abs(a.y - b.y) >= a.hh + b.hh + pad) continue;
        into = a;
        break;
      }
      if (!into) {
        leaders.insert(i, b.x, b.y);
        continue;
      }
      const a = into;
      const total = a.count + b.count;
      a.x = (a.x * a.count + b.x * b.count) / total;
      a.y = (a.y * a.count + b.y * b.count) / total;
      a.count = total;
      a.minX = Math.min(a.minX, b.minX);
      a.minY = Math.min(a.minY, b.minY);
      a.maxX = Math.max(a.maxX, b.maxX);
      a.maxY = Math.max(a.maxY, b.maxY);
      a.extra.push(b.token);
      for (const more of b.extra) a.extra.push(more);
      b.merged = true;
      this.size(a, view);
    }
    let n = 0;
    for (const s of list) if (!s.merged) list[n++] = s;
    list.length = n;

    // Less important tokens step aside for more important ones, a little: a crest stays on its
    // outpost (10 px at most), a plaque may drift further (it stands for an area).
    // Neighbours come from a grid of the tokens already placed, so thousands of crests stay cheap.
    const placed = this.placedGrid;
    placed.reset(view.width, view.height, list.length);
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!;
      const ox = c.x;
      const oy = c.y;
      for (let pass = 0; i > 0 && pass < 3; pass++) {
        let moved = false;
        placed.near(c.x, c.y, c.hw + MAX_HALF + GAP, near);
        for (const j of near) {
          const q = list[j]!;
          const overX = c.hw + q.hw + GAP - Math.abs(c.x - q.x);
          const overY = c.hh + q.hh + GAP - Math.abs(c.y - q.y);
          if (overX <= 0 || overY <= 0) continue;
          // Out along the shorter way.
          if (overX < overY) c.x += c.x >= q.x ? overX : -overX;
          else c.y += c.y >= q.y ? overY : -overY;
          moved = true;
        }
        if (!moved) break;
      }
      const cap = MAX_PUSH[c.kind];
      const dx = c.x - ox;
      const dy = c.y - oy;
      const d = Math.hypot(dx, dy);
      if (d > cap) {
        c.x = ox + (dx / d) * cap;
        c.y = oy + (dy / d) * cap;
      }
      placed.insert(i, c.x, c.y);
    }

    // The whole token on the screen, clear of the HUD. One cut by the edge or under a button steps
    // inside: a plaque (it stands for an area) up to PLAQUE_SHIFT px, as on a phone most plaques'
    // middles fall near an edge; a crest only CREST_SHIFT px, so it stays on its outpost (neon r1: a
    // crest left out showed a bare hex). The list runs crests first (most important), so a plaque
    // keeps clear of every token already kept (list[0..n)), and no crest covers a count.
    const kept = this.keptGrid;
    kept.reset(view.width, view.height, list.length);
    n = 0;
    for (const s of list) {
      const crest = s.kind === "crest";
      const others = crest ? null : kept;
      let keep = fits(s, view, list, others, near) || this.shiftIn(s, view, list, others, crest ? CREST_SHIFT : PLAQUE_SHIFT);
      // A plaque whose middle is on the screen is never dropped, or its outposts (markers and
      // borders left out) would vanish: it stays, kept inside the edges, even if crowded.
      if (!keep && !crest && s.x >= 0 && s.y >= 0 && s.x <= view.width && s.y <= view.height) {
        s.x = Math.min(Math.max(s.x, EDGE + s.hw), view.width - EDGE - s.hw);
        s.y = Math.min(Math.max(s.y, EDGE + s.hh), view.height - EDGE - s.hh);
        keep = true;
      }
      if (keep) {
        kept.insert(n, s.x, s.y);
        list[n++] = s;
      }
    }
    list.length = n;
    return list;
  }

  /** The token a tap at this canvas point lands on (the most important one), or null. */
  hit(x: number, y: number, touch: boolean): ScreenToken | null {
    for (const s of this.shown) {
      const hw = touch ? Math.max(s.hw, TOUCH_TARGET / 2) : s.hw;
      const hh = touch ? Math.max(s.hh, TOUCH_TARGET / 2) : s.hh;
      if (Math.abs(x - s.x) <= hw && Math.abs(y - s.y) <= hh) return s;
    }
    return null;
  }

  /**
   * Moves a token the least way that puts it whole on the screen, clear of the HUD and of the first
   * `kept` tokens of `others`; false when that is further than `limit`.
   */
  private shiftIn(s: ScreenToken, view: LayoutView, list: readonly ScreenToken[], kept: Grid | null, limit: number): boolean {
    const near = this.shiftNear;
    const x0 = s.x;
    const y0 = s.y;
    const inX = (x: number): number => Math.min(Math.max(x, EDGE + s.hw), view.width - EDGE - s.hw);
    const inY = (y: number): number => Math.min(Math.max(y, EDGE + s.hh), view.height - EDGE - s.hh);
    let bestX = x0;
    let bestY = y0;
    let best = Infinity;
    const tryAt = (x: number, y: number): void => {
      const d = Math.hypot(x - x0, y - y0);
      if (d >= best || d > limit) return;
      s.x = x;
      s.y = y;
      if (!fits(s, view, list, kept, this.near)) return;
      best = d;
      bestX = x;
      bestY = y;
    };
    tryAt(inX(x0), inY(y0));
    // Off each box it sits under: below, above, left of or right of it.
    const around = (r: ScreenRect, gap: number): void => {
      tryAt(inX(x0), inY(r.bottom + gap + s.hh + 1));
      tryAt(inX(x0), inY(r.top - gap - s.hh - 1));
      tryAt(inX(r.left - gap - s.hw - 1), inY(y0));
      tryAt(inX(r.right + gap + s.hw + 1), inY(y0));
    };
    for (const r of view.obstacles) around(r, hudGap(s));
    if (s.kind === "plaque" && view.avoid) for (const r of view.avoid) around(r, HUD_GAP);
    if (kept) {
      kept.near(x0, y0, limit + s.hw + MAX_HALF + GAP, near);
      for (const i of near) {
        const q = list[i]!;
        around({ left: q.x - q.hw, top: q.y - q.hh, right: q.x + q.hw, bottom: q.y + q.hh }, GAP);
      }
    }
    s.x = bestX;
    s.y = bestY;
    return best !== Infinity;
  }

  private size(s: ScreenToken, view: LayoutView): void {
    const { hw, hh } = tokenSize(s.kind, s.group, s.count, view.touch, view.zoom);
    s.hw = hw;
    s.hh = hh;
  }

  private take(token: WorldToken): ScreenToken {
    let s = this.pool[this.used];
    if (!s) {
      s = {
        token,
        kind: token.kind,
        group: token.group,
        count: 0,
        x: 0,
        y: 0,
        hw: 0,
        hh: 0,
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        merged: false,
        extra: [],
      };
      this.pool.push(s);
    }
    this.used++;
    s.token = token;
    s.kind = token.kind;
    s.group = token.group;
    s.count = token.cells.length;
    s.minX = token.minX;
    s.minY = token.minY;
    s.maxX = token.maxX;
    s.maxY = token.maxY;
    s.merged = false;
    s.extra.length = 0;
    return s;
  }
}

/** Whether a token is whole on the screen, clear of the HUD and of the tokens in `kept` (indices into `list`). */
const fits = (s: ScreenToken, view: LayoutView, list: readonly ScreenToken[], kept: Grid | null, near: number[]): boolean => {
  if (s.x - s.hw < EDGE || s.y - s.hh < EDGE || s.x + s.hw > view.width - EDGE || s.y + s.hh > view.height - EDGE) return false;
  if (underAny(s, view.obstacles)) return false;
  if (s.kind === "plaque" && view.avoid && underAny(s, view.avoid)) return false;
  if (!kept) return true;
  kept.near(s.x, s.y, s.hw + MAX_HALF + GAP, near);
  for (const i of near) {
    const q = list[i]!;
    if (Math.abs(s.x - q.x) < s.hw + q.hw + GAP && Math.abs(s.y - q.y) < s.hh + q.hh + GAP) return false;
  }
  return true;
};

/** Half the widest token can be (a 4-digit touch plaque), for how far to look for neighbours. */
const MAX_HALF = 60;

/**
 * A grid of token middles on the screen (indices into the layout's list), so a token's neighbours
 * are found without looking at every other token. Reused between layouts.
 */
class Grid {
  private head = new Int32Array(0);
  private next = new Int32Array(0);
  private cols = 0;
  private rows = 0;
  private static readonly SIZE = 96;
  /** Tokens up to this far off the screen are kept (the layout's projection margin and more). */
  private static readonly OFF = 192;

  reset(width: number, height: number, capacity: number): void {
    this.cols = Math.ceil((width + Grid.OFF * 2) / Grid.SIZE) + 1;
    this.rows = Math.ceil((height + Grid.OFF * 2) / Grid.SIZE) + 1;
    const cells = this.cols * this.rows;
    if (this.head.length < cells) this.head = new Int32Array(cells);
    this.head.fill(-1, 0, cells);
    if (this.next.length < capacity) this.next = new Int32Array(Math.max(capacity, this.next.length * 2));
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x + Grid.OFF) / Grid.SIZE)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y + Grid.OFF) / Grid.SIZE)));
  }

  insert(index: number, x: number, y: number): void {
    const cell = this.row(y) * this.cols + this.col(x);
    this.next[index] = this.head[cell]!;
    this.head[cell] = index;
  }

  /** The indices with a middle within `reach` (a box) of this point, into `out`. */
  near(x: number, y: number, reach: number, out: number[]): void {
    out.length = 0;
    const c0 = this.col(x - reach);
    const c1 = this.col(x + reach);
    const r0 = this.row(y - reach);
    const r1 = this.row(y + reach);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (let i = this.head[r * this.cols + c]!; i !== -1; i = this.next[i]!) out.push(i);
      }
    }
  }
}

const underAny = (s: ScreenToken, rects: readonly ScreenRect[]): boolean => {
  const gap = hudGap(s);
  for (const r of rects) {
    if (s.x + s.hw > r.left - gap && s.x - s.hw < r.right + gap && s.y + s.hh > r.top - gap && s.y - s.hh < r.bottom + gap) {
      return true;
    }
  }
  return false;
};
