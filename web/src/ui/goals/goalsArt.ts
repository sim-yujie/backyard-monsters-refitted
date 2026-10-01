const NS = "http://www.w3.org/2000/svg";

/** A trophy, in the dock's line style (`ui/icons.ts`): the Goals button's art (issue #227). */
const TROPHY = [
  "M8 4h8v5a4 4 0 0 1-8 0z",
  "M8 6H5v1a3 3 0 0 0 3 3",
  "M16 6h3v1a3 3 0 0 1-3 3",
  "M12 13v4",
  "M9 20h6",
  "M10 17h4v3h-4z",
];

/** The Goals icon, `size` px square, in the colour of its parent. */
export const goalsArt = (size: number): SVGSVGElement => {
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
  svg.setAttribute("class", "goals-dock-art");
  for (const d of TROPHY) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};
