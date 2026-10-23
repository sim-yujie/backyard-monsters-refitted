import { svg } from "./dom";

/**
 * The dashboard's few line icons (24-unit grid, 2-unit stroke, drawn in the
 * text colour). A state is never told by colour alone: each status colour
 * comes with one of these and a word.
 */

const PATHS = {
  ok: ["M20 6 9 17l-5-5"],
  warn: ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"],
  bad: ["M12 8v5", "M12 16h.01", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"],
  refresh: ["M21 12a9 9 0 1 1-2.6-6.4L21 8", "M21 3v5h-5"],
  chevron: ["m9 6 6 6-6 6"],
  back: ["m15 6-6 6 6 6"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  image: ["M3 5h18v14H3z", "m3 16 5-5 4 4 3-3 6 6", "M15 9h.01"],
} as const;

export type IconName = keyof typeof PATHS;

export const icon = (name: IconName, size = 20): SVGSVGElement => {
  const root = svg("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: `icon icon-${name}`,
  });
  for (const d of PATHS[name]) root.append(svg("path", { d }));
  return root;
};
