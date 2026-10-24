import { h, svg } from "./dom";
import { count, dayLabel, shortDay } from "./format";

/**
 * The dashboard's charts: one series each, drawn as plain SVG at the size the
 * card really has (no chart library; the page has no other dependency and
 * needs only bars and a line). Tapping, hovering or arrowing to a day shows
 * its number in the line under the chart, which otherwise shows the latest.
 *
 * A year of days is too many bars for a phone, so past 120 days each bar or
 * point is a week. Totals that only grow (players in all) may start the scale
 * just under their lowest value, so the growth shows; counts per day always
 * stand on zero.
 *
 * `layoutChart` and `byWeek` do the arithmetic and touch no DOM, so they are
 * tested on their own; `chart` draws what they say.
 */

export interface ChartPoint {
  /** A UTC day, `YYYY-MM-DD`; for a week, its first day. */
  day: string;
  /** Null: not known for that day (a gap, not a zero). */
  value: number | null;
  /** How many days the point stands for (7 for a week). */
  days?: number;
}

export interface ChartOptions {
  kind: "bar" | "line";
  /** What the number counts, for the caption: "new players". */
  unit: string;
  /** Pixel height of the drawing. */
  height?: number;
  /**
   * How a week is made from its days: added up (counts per day), the last
   * day (a running total) or the average (players on an average day).
   */
  week?: "sum" | "last" | "mean";
  /** False: the scale may start above zero (lines only). */
  zero?: boolean;
}

export interface ChartLayout {
  width: number;
  height: number;
  /** The plot area inside the axis labels. */
  plot: { left: number; top: number; right: number; bottom: number };
  /** The bottom of the scale: 0, or a round number under the smallest value. */
  min: number;
  /** The top of the scale (a round number at or above the largest value). */
  max: number;
  /** Gridline values, bottom to top. */
  ticks: number[];
  /** Centre x of each day's slot. */
  xs: number[];
  /** Each day's y, or null for a gap. */
  ys: (number | null)[];
  /** Bar width (bars only use it). */
  barWidth: number;
  /** Line path: "M x y L x y ..." with a fresh "M" after every gap. */
  path: string;
  /** Which days get an axis label (first, middle, last). */
  labelled: number[];
  /** The run of unknown days at the start, as [first, last] index, if long. */
  leadingGap: [number, number] | null;
}

/** The smallest of 1, 2, 5 × 10ⁿ at or above `value` (at least 1). */
export const niceMax = (value: number): number => {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
};

/** Past this many days, a chart shows weeks. */
export const WEEKS_FROM = 120;

/**
 * Days grouped into weeks, the last week ending on the last day (so the
 * newest bar is a whole week). A week with no known day is a gap.
 */
export const byWeek = (
  points: readonly ChartPoint[],
  how: "sum" | "last" | "mean",
): ChartPoint[] => {
  const weeks: ChartPoint[] = [];
  for (let end = points.length; end > 0; end -= 7) {
    const days = points.slice(Math.max(0, end - 7), end);
    const known = days.map((p) => p.value).filter((v): v is number => v !== null);
    const value = !known.length
      ? null
      : how === "sum"
        ? known.reduce((a, b) => a + b, 0)
        : how === "last"
          ? known[known.length - 1]!
          : Math.round(known.reduce((a, b) => a + b, 0) / known.length);
    weeks.unshift({ day: days[0]!.day, value, days: days.length });
  }
  return weeks;
};

const LEFT = 40;
const TOP = 10;
const RIGHT = 8;
const BOTTOM = 24;

/** Three round gridline values from just under `low` to at or over `high`. */
const scaleAbove = (low: number, high: number): [number, number] => {
  let step = niceMax(Math.max(1, (high - low) / 2));
  for (;;) {
    const bottom = Math.floor(low / step) * step;
    if (bottom + 2 * step >= high) return [bottom, step];
    step = niceMax(step * 1.01);
  }
};

export const layoutChart = (
  points: readonly ChartPoint[],
  width: number,
  height: number,
  zero = true,
): ChartLayout => {
  const plot = { left: LEFT, top: TOP, right: width - RIGHT, bottom: height - BOTTOM };
  const known = points.map((p) => p.value).filter((v): v is number => v !== null);
  const highest = Math.max(0, ...known);
  const lowest = known.length ? Math.min(...known) : 0;
  let min = 0;
  let max = niceMax(highest);
  let ticks = [0, max / 2, max];
  // A total that barely moves would be a flat line on a scale from zero.
  if (!zero && lowest > 0 && highest > lowest) {
    const [bottom, step] = scaleAbove(lowest, highest);
    min = bottom;
    max = bottom + 2 * step;
    ticks = [bottom, bottom + step, max];
  }
  const slot = points.length ? (plot.right - plot.left) / points.length : 0;
  const xs = points.map((_, i) => plot.left + slot * (i + 0.5));
  const y = (v: number) => plot.bottom - ((v - min) / (max - min)) * (plot.bottom - plot.top);
  const ys = points.map((p) => (p.value === null ? null : y(p.value)));

  let path = "";
  let pen = false;
  ys.forEach((value, i) => {
    if (value === null) {
      pen = false;
      return;
    }
    path += `${pen ? " L" : path ? " M" : "M"} ${xs[i]!.toFixed(1)} ${value.toFixed(1)}`;
    pen = true;
  });

  const last = points.length - 1;
  const labelled =
    last < 0 ? [] : last === 0 ? [0] : [...new Set([0, Math.floor(last / 2), last])];
  // Thin bars with air between them; never wider than 18 px.
  const barWidth = Math.max(1, Math.min(18, slot * 0.7, slot - 2));

  let gapEnd = 0;
  while (gapEnd < points.length && points[gapEnd]!.value === null) gapEnd++;
  const leadingGap: [number, number] | null =
    gapEnd >= Math.max(3, points.length * 0.15) && gapEnd < points.length ? [0, gapEnd - 1] : null;

  return { width, height, plot, min, max, ticks, xs, ys, barWidth, path, labelled, leadingGap };
};

/** The axis number: "1.2K" past a thousand, so it fits the left margin. */
export const tickLabel = (value: number): string =>
  value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(Number(value.toFixed(1)));

/** A bar with rounded top corners, standing on the baseline. */
const barPath = (x: number, top: number, width: number, bottom: number): string => {
  const r = Math.min(4, width / 2, bottom - top);
  const left = x - width / 2;
  const right = x + width / 2;
  return `M ${left} ${bottom} V ${top + r} Q ${left} ${top} ${left + r} ${top} H ${right - r} Q ${right} ${top} ${right} ${top + r} V ${bottom} Z`;
};

/** When a point is: "Thu 22 Oct", or "Week of 12 Oct". */
export const whenLabel = (point: ChartPoint): string =>
  (point.days ?? 1) > 1 ? `Week of ${shortDay(point.day)}` : dayLabel(point.day);

/** The words under a chart for one day: the number first, then the day. */
export const captionFor = (point: ChartPoint, unit: string): string =>
  `${point.value === null ? "Not counted" : `${count(point.value)} ${unit}`} · ${whenLabel(point)}`;

const draw = (
  host: HTMLElement,
  caption: HTMLElement,
  points: readonly ChartPoint[],
  options: ChartOptions,
): void => {
  const width = Math.max(240, Math.floor(host.clientWidth || 320));
  const layout = layoutChart(points, width, options.height ?? 168, options.zero ?? true);
  const { plot } = layout;
  const root = svg("svg", {
    width,
    height: layout.height,
    viewBox: `0 0 ${width} ${layout.height}`,
    class: "chart-svg",
    role: "img",
    tabindex: 0,
    "aria-label": `${options.unit}, ${points.length ? `${whenLabel(points[0]!)} to ${whenLabel(points[points.length - 1]!)}` : "no days yet"}. Arrow keys step through the days.`,
  });

  for (const tick of layout.ticks) {
    const ty =
      plot.bottom - ((tick - layout.min) / (layout.max - layout.min)) * (plot.bottom - plot.top);
    root.append(
      svg("line", {
        x1: plot.left,
        x2: plot.right,
        y1: ty,
        y2: ty,
        class: tick === layout.min ? "baseline" : "grid",
      }),
    );
    const label = svg("text", {
      x: plot.left - 8,
      y: ty + 4,
      "text-anchor": "end",
      class: "tick",
    });
    label.textContent = tickLabel(tick);
    root.append(label);
  }
  for (const i of layout.labelled) {
    const anchor =
      i === 0 && points.length > 1 ? "start" : i === points.length - 1 && i ? "end" : "middle";
    const x = anchor === "start" ? plot.left : anchor === "end" ? plot.right : layout.xs[i]!;
    const label = svg("text", {
      x,
      y: layout.height - 6,
      "text-anchor": anchor,
      class: "tick",
    });
    label.textContent = shortDay(points[i]!.day);
    root.append(label);
  }
  if (layout.leadingGap) {
    const [from, to] = layout.leadingGap;
    const label = svg("text", {
      x: (layout.xs[from]! + layout.xs[to]!) / 2,
      y: (plot.top + plot.bottom) / 2,
      "text-anchor": "middle",
      class: "gap-label",
    });
    label.textContent = "Not counted yet";
    root.append(label);
  }

  const marks: SVGElement[] = [];
  if (options.kind === "bar") {
    layout.ys.forEach((y, i) => {
      const bar = svg("path", {
        d:
          y === null || y >= plot.bottom
            ? ""
            : barPath(layout.xs[i]!, y, layout.barWidth, plot.bottom),
        class: "mark bar",
      });
      marks.push(bar);
      root.append(bar);
    });
  } else {
    root.append(svg("path", { d: layout.path, class: "mark line" }));
  }
  const guide = svg("line", {
    y1: plot.top,
    y2: plot.bottom,
    class: "guide",
    visibility: "hidden",
  });
  const dot = svg("circle", { r: 4.5, class: "dot", visibility: "hidden" });
  root.append(guide, dot);

  const lastKnown = (() => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i]!.value !== null) return i;
    return points.length - 1;
  })();
  let current = lastKnown;

  const show = (i: number, active: boolean) => {
    const point = points[i];
    if (!point) {
      caption.replaceChildren("No days yet");
      return;
    }
    current = i;
    caption.replaceChildren(
      h(
        "strong",
        {},
        point.value === null ? "Not counted" : `${count(point.value)} ${options.unit}`,
      ),
      h("span", {}, whenLabel(point)),
    );
    marks.forEach((mark, j) => mark.classList.toggle("on", active && j === i));
    const x = layout.xs[i]!;
    const y = layout.ys[i] ?? null;
    guide.setAttribute("x1", String(x));
    guide.setAttribute("x2", String(x));
    guide.setAttribute("visibility", active ? "visible" : "hidden");
    // A line keeps a dot on its newest value, and moves it to the day shown.
    if (options.kind === "line" && y !== null) {
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("visibility", "visible");
    } else {
      dot.setAttribute("visibility", "hidden");
    }
  };

  const indexAt = (event: PointerEvent): number => {
    const box = root.getBoundingClientRect();
    const x = ((event.clientX - box.left) / (box.width || width)) * width;
    const slot = (plot.right - plot.left) / Math.max(1, points.length);
    return Math.min(points.length - 1, Math.max(0, Math.floor((x - plot.left) / slot)));
  };
  root.addEventListener("pointermove", (event) => show(indexAt(event), true));
  root.addEventListener("pointerdown", (event) => show(indexAt(event), true));
  root.addEventListener("pointerleave", () => {
    if (document.activeElement !== root) show(lastKnown, false);
  });
  root.addEventListener("blur", () => show(lastKnown, false));
  root.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -points.length, End: points.length }[
      event.key
    ];
    if (step === undefined || !points.length) return;
    event.preventDefault();
    show(Math.min(points.length - 1, Math.max(0, current + step)), true);
  });

  host.replaceChildren(root);
  show(lastKnown, false);
};

/**
 * One chart's drawing and its caption line. It redraws itself when its box
 * changes width (a phone turned sideways, a window resized).
 */
export const chart = (days: readonly ChartPoint[], options: ChartOptions): HTMLElement => {
  const points = days.length > WEEKS_FROM ? byWeek(days, options.week ?? "sum") : days;
  const host = h("div", { class: "chart" });
  const caption = h("p", { class: "chart-caption", attrs: { "aria-live": "polite" } });
  const figure = h("figure", { class: "chart-figure" }, host, caption);
  let drawnWidth = -1;
  const redraw = () => {
    const width = Math.floor(host.clientWidth);
    if (width === drawnWidth) return;
    drawnWidth = width;
    draw(host, caption, points, options);
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(redraw).observe(host);
  // First draw once the card is in the page and has a width.
  requestAnimationFrame(redraw);
  return figure;
};
