/**
 * The line icons the approved Map Room 1 mock-ups draw with, as inline SVG
 * in the text's colour and hidden from assistive technology (the control
 * beside it carries the words).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  map: ["M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z", "M9 4v14", "M15 6v14"],
  list: ["M8 6h12", "M8 12h12", "M8 18h12", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  eye: [
    "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z",
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  ],
  attack: ["M14.5 17.5L3 6V3h3l11.5 11.5", "M13 19l6-6", "M16 16l4 4", "M19 21l2-2"],
  lock: [
    "M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z",
    "M8 11V8a4 4 0 0 1 8 0v3",
  ],
  shield: ["M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"],
  home: ["M3.5 11L12 4l8.5 7", "M5.5 9.5V20h13V9.5"],
  target: [
    "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
    "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    "M12 2v3",
    "M12 19v3",
    "M2 12h3",
    "M19 12h3",
  ],
  flinger: ["M4 20l7-7", "M11 13l3-8 5 5-8 3z"],
  wrench: [
    "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z",
  ],
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"],
  respawn: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"],
  truce: ["M7 11l3-3 4 1 3 3", "M3 12l4-4", "M21 12l-4-4", "M7 11l5 5 5-5"],
  chevronRight: ["M9 6l6 6-6 6"],
  chevronLeft: ["M15 6l-6 6 6 6"],
} as const;

export type IconName = keyof typeof PATHS;

export const icon = (name: IconName, size = 18, className = "mr1-icon"): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
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
  svg.setAttribute("class", className);
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};

/** An element with a class and optional text, the one-liner every view needs. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** A `type="button"` button. */
export const button = (className: string, text?: string): HTMLButtonElement => {
  const element = el("button", className, text);
  element.type = "button";
  return element;
};
