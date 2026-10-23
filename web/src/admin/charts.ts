import { h, svg } from "./dom";
import { count, dayLabel, shortDay } from "./format";

/**
 * The dashboard's charts: one series each, drawn as plain SVG at the size the
 * card really has (no chart library; the page has no other dependency and
 * needs only bars and a line). Tapping or hovering a day shows its number in
 * the line under the chart, which otherwise shows the latest day.
 *
 * `layoutChart` does the arithmetic and touches no DOM, so it is tested on
 * its own; `chart` draws what it says.
 */

export interface ChartPoint {
  /** A UTC day, `YYYY-MM-DD`. */
  day: string;
  /** Null: not known for that day (a gap, not a zero). */
  value: number | null;
}

export interface ChartOptions {
  kind: "bar" | "line";
  /** What the number counts, for the caption: "new players". */
  unit: string;
  /** Pixel height of the drawing. */
  height?: number;
}

export interface ChartLayout {
  width: number;
  height: number;
  /** The plot area inside the axis labels. */
  plot: { left: number; top: number; right: number; bottom: number };
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
}

/** The smallest of 1, 2, 5 × 10ⁿ at or above `value` (at least 1). */
export const niceMax = (value: number): number => {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
};

const LEFT = 40;
const TOP = 8;
const RIGHT = 6;
const BOTTOM = 22;

export const layoutChart = (
  points: readonly ChartPoint[],
  width: number,
  height: number,
): ChartLayout => {
  const plot = { left: LEFT, top: TOP, right: width - RIGHT, bottom: height - BOTTOM };
  const known = points.map((p) => p.value).filter((v): v is number => v !== null);
  const max = niceMax(Math.max(0, ...known));
  const ticks = [0, max / 2, max];
  const slot = points.length ? (plot.right - plot.left) / points.length : 0;
  const xs = points.map((_, i) => plot.left + slot * (i + 0.5));
  const y = (v: number) => plot.bottom - (v / max) * (plot.bottom - plot.top);
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
  // Thin bars with a gap between them; never wider than 18 px.
  const barWidth = Math.max(1, Math.min(18, slot * 0.7, slot - 2));
  return { width, height, plot, max, ticks, xs, ys, barWidth, path, labelled };
};

/** The axis number: "1.2K" past a thousand, so it fits the left margin. */
export const tickLabel = (value: number): string =>
  value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(Number(value.toFixed(1)));

/** A bar with rounded top corners, standing on the baseline. */
const barPath = (x: number, top: number, width: number, bottom: number): string => {
  const r = Math.min(3, width / 2, bottom - top);
  const left = x - width / 2;
  const right = x + width / 2;
  return `M ${left} ${bottom} V ${top + r} Q ${left} ${top} ${left + r} ${top} H ${right - r} Q ${right} ${top} ${right} ${top + r} V ${bottom} Z`;
};

/** The words under a chart for one day. */
export const captionFor = (point: ChartPoint, unit: string): string =>
  `${dayLabel(point.day)}: ${point.value === null ? "not known" : `${count(point.value)} ${unit}`}`;

const draw = (
  host: HTMLElement,
  caption: HTMLElement,
  points: readonly ChartPoint[],
  options: ChartOptions,
): void => {
  const width = Math.max(240, Math.floor(host.clientWidth || 320));
  const layout = layoutChart(points, width, options.height ?? 160);
  const { plot } = layout;
  const root = svg("svg", {
    width,
    height: layout.height,
    viewBox: `0 0 ${width} ${layout.height}`,
    class: "chart-svg",
    role: "img",
    "aria-label": `${options.unit} per day`,
  });

  for (const tick of layout.ticks) {
    const ty = plot.bottom - (tick / layout.max) * (plot.bottom - plot.top);
    root.append(
      svg("line", {
        x1: plot.left,
        x2: plot.right,
        y1: ty,
        y2: ty,
        class: tick ? "grid" : "baseline",
      }),
    );
    const label = svg("text", {
      x: plot.left - 6,
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
  const dot = svg("circle", { r: 4, class: "dot", visibility: "hidden" });
  root.append(guide, dot);

  const lastKnown = (() => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i]!.value !== null) return i;
    return points.length - 1;
  })();

  const show = (i: number, active: boolean) => {
    const point = points[i];
    if (!point) {
      caption.textContent = "No days yet";
      return;
    }
    caption.textContent = captionFor(point, options.unit);
    marks.forEach((mark, j) => mark.classList.toggle("on", active && j === i));
    const x = layout.xs[i]!;
    const y = layout.ys[i] ?? null;
    guide.setAttribute("x1", String(x));
    guide.setAttribute("x2", String(x));
    guide.setAttribute("visibility", active ? "visible" : "hidden");
    if (options.kind === "line" && y !== null) {
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("visibility", active ? "visible" : "hidden");
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
  root.addEventListener("pointerleave", () => show(lastKnown, false));

  host.replaceChildren(root);
  show(lastKnown, false);
};

/**
 * One chart card's drawing and its caption line. It redraws itself when its
 * box changes width (a phone turned sideways, a window resized).
 */
export const chart = (points: readonly ChartPoint[], options: ChartOptions): HTMLElement => {
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
