import { FAR_ZOOM, STACK_ORDER, countText, type ClusterGroup, type WorldToken } from "./clusterRules";

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

    // Plaques of one kind squeezed together by the tilt (the far rows) become one.
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (a.kind !== "plaque" || a.merged) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (b.kind !== "plaque" || b.merged || b.group !== a.group) continue;
        if (Math.abs(a.x - b.x) >= a.hw + b.hw + GAP || Math.abs(a.y - b.y) >= a.hh + b.hh + GAP) continue;
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
    }
    let n = 0;
    for (const s of list) if (!s.merged) list[n++] = s;
    list.length = n;

    // Less important tokens step aside for more important ones, a little: a crest stays on its
    // outpost (10 px at most), a plaque may drift further (it stands for an area).
    for (let i = 1; i < list.length; i++) {
      const c = list[i]!;
      const ox = c.x;
      const oy = c.y;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let j = 0; j < i; j++) {
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
    }

    // The whole token on the screen, clear of the HUD. One cut by the edge or under a button steps
    // inside: a plaque (it stands for an area) up to PLAQUE_SHIFT px, as on a phone most plaques'
    // middles fall near an edge; a crest only CREST_SHIFT px, so it stays on its outpost (neon r1: a
    // crest left out showed a bare hex). The list runs crests first (most important), so a plaque
    // keeps clear of every token already kept (list[0..n)), and no crest covers a count.
    n = 0;
    for (const s of list) {
      const crest = s.kind === "crest";
      const keep = fits(s, view, list, crest ? 0 : n) || this.shiftIn(s, view, list, crest ? 0 : n, crest ? CREST_SHIFT : PLAQUE_SHIFT);
      if (keep) list[n++] = s;
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
  private shiftIn(s: ScreenToken, view: LayoutView, others: readonly ScreenToken[], kept: number, limit: number): boolean {
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
      if (!fits(s, view, others, kept)) return;
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
    for (let i = 0; i < kept; i++) {
      const q = others[i]!;
      around({ left: q.x - q.hw, top: q.y - q.hh, right: q.x + q.hw, bottom: q.y + q.hh }, GAP);
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

/** Whether a token is whole on the screen, clear of the HUD and of the first `kept` of `others`. */
const fits = (s: ScreenToken, view: LayoutView, others: readonly ScreenToken[], kept: number): boolean => {
  if (s.x - s.hw < EDGE || s.y - s.hh < EDGE || s.x + s.hw > view.width - EDGE || s.y + s.hh > view.height - EDGE) return false;
  if (underAny(s, view.obstacles)) return false;
  if (s.kind === "plaque" && view.avoid && underAny(s, view.avoid)) return false;
  for (let i = 0; i < kept; i++) {
    const q = others[i]!;
    if (Math.abs(s.x - q.x) < s.hw + q.hw + GAP && Math.abs(s.y - q.y) < s.hh + q.hh + GAP) return false;
  }
  return true;
};

const underAny = (s: ScreenToken, rects: readonly ScreenRect[]): boolean => {
  const gap = hudGap(s);
  for (const r of rects) {
    if (s.x + s.hw > r.left - gap && s.x - s.hw < r.right + gap && s.y + s.hh > r.top - gap && s.y - s.hh < r.bottom + gap) {
      return true;
    }
  }
  return false;
};
