/**
 * Line icons for the yard's round buttons (#171) and the Housing panel
 * (#170): a 24-unit grid, stroked in the button's own colour, drawn as SVG
 * elements rather than fetched, so they cannot arrive late and they follow
 * `currentColor`.
 *
 * Each icon is a list of shapes; a string is a path's `d`.
 */

type Shape = string | { readonly rect: readonly [number, number, number, number]; readonly rx?: number } | {
  readonly circle: readonly [number, number, number];
};

const ICONS = {
  build: ["M14.5 5.5l4 4", "M3.5 20.5l9.2-9.2", "M11 6.5l3.5-3.5 6.5 6.5-3.5 3.5z"],
  layout: [
    { rect: [3.5, 3.5, 7, 7], rx: 1.5 },
    { rect: [13.5, 3.5, 7, 7], rx: 1.5 },
    { rect: [3.5, 13.5, 7, 7], rx: 1.5 },
    { rect: [13.5, 13.5, 7, 7], rx: 1.5 },
  ],
  map: ["M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z", "M9 4v14", "M15 6v14"],
  home: ["M3.5 11.5L12 4.5l8.5 7", "M6 10v10h12V10", "M10 20v-5.5h4V20"],
  yards: ["M5 21V4", "M5 4.5h12l-2.5 4 2.5 4H5"],
  attack: [
    "M14.5 17.5L3 6V3h3l11.5 11.5",
    "M13 19l6-6",
    "M16 16l4 4",
    "M19 21l2-2",
    "M14.5 6.5L18 3h3v3l-3.5 3.5",
    "M5 14l4 4",
    "M7 17l-3 3",
    "M3 19l2 2",
  ],
  close: ["M6 6l12 12", "M18 6L6 18"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  overview: [
    "M3.5 8V5.5a2 2 0 0 1 2-2H8",
    "M16 3.5h2.5a2 2 0 0 1 2 2V8",
    "M20.5 16v2.5a2 2 0 0 1-2 2H16",
    "M8 20.5H5.5a2 2 0 0 1-2-2V16",
    { rect: [8, 8, 8, 8], rx: 1.5 },
  ],
  warning: ["M12 4l9 16H3z", "M12 10v4.5", "M12 17.5h.01"],
  drop: ["M12 3c-4 0-7 6-7 11a7 7 0 0 0 14 0c0-5-3-11-7-11z"],
  paw: [
    { circle: [6.5, 10, 2] },
    { circle: [12, 6.5, 2] },
    { circle: [17.5, 10, 2] },
    "M7.5 17.5c0-3 2-5.5 4.5-5.5s4.5 2.5 4.5 5.5c0 2-2 2.5-4.5 2.5s-4.5-.5-4.5-2.5z",
  ],
  more: [{ circle: [5, 12, 1.2] }, { circle: [12, 12, 1.2] }, { circle: [19, 12, 1.2] }],
  back: ["M15 5l-7 7 7 7"],
  // An arrow coming down into a tray: Collect all (#198, the owner's pick).
  collect: ["M12 3.5v11", "M7.5 10.5l4.5 4.5 4.5-4.5", "M3.5 14.5v3.5a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-3.5"],
  // A crate: the outpost Starter Kits (#188).
  kits: ["M3.5 8L12 4l8.5 4v8.5L12 20.5l-8.5-4z", "M3.5 8l8.5 4 8.5-4", "M12 12v8.5", "M7.8 6l8.4 4"],
  // An envelope: the mailbox (#193).
  mail: [{ rect: [3.5, 5.5, 17, 13], rx: 2 }, "M4 7l8 6 8-6"],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

const NS = "http://www.w3.org/2000/svg";

/** A decorative line icon, `size` px square, in the colour of its parent. */
export const icon = (name: IconName, size: number, className?: string): SVGSVGElement => {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) svg.setAttribute("class", className);
  for (const shape of ICONS[name] as readonly Shape[]) {
    if (typeof shape === "string") {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", shape);
      svg.append(path);
    } else if ("rect" in shape) {
      const [x, y, width, height] = shape.rect;
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(height));
      if (shape.rx !== undefined) rect.setAttribute("rx", String(shape.rx));
      svg.append(rect);
    } else {
      const [cx, cy, r] = shape.circle;
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", String(r));
      svg.append(circle);
    }
  }
  return svg;
};
