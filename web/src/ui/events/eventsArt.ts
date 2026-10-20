const NS = "http://www.w3.org/2000/svg";

/**
 * Line icons for the Events page, in the dock's style (`ui/icons.ts`,
 * `ui/goals/goalsArt.ts`): stroked paths in the colour of their parent.
 */
const ART = {
  /** A pumpkin with its stalk: the Events button. */
  pumpkin: [
    "M12 7c-5 0-8 3-8 7s3 6.5 8 6.5 8-2.5 8-6.5-3-7-8-7z",
    "M12 7c-2 0-3.5 3-3.5 6.8S10 20.5 12 20.5s3.5-3 3.5-6.7S14 7 12 7z",
    "M12 7V4.5c0-.8.6-1.5 1.5-1.5",
  ],
  /** A clock: a speed-up. */
  clock: ["M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z", "M12 7.5V12l3 2"],
  /** A wrench: a store buff such as Sharper Tools. */
  tools: ["M14.5 4.5a4.5 4.5 0 0 0 4.9 6l-8.9 8.9a2 2 0 0 1-2.9-2.9l8.9-8.9a4.5 4.5 0 0 0-2-3.1z"],
  /** A tick: a claimed day. */
  tick: ["M5 12.5l4.5 4.5L19 7.5"],
  /** A padlock: a day not open yet. */
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M5.5 11h13v9.5h-13z"],
  /** A gift: a reward with no picture of its own. */
  gift: ["M4 9.5h16v4H4z", "M5.5 13.5h13v7h-13z", "M12 9.5v11", "M12 9.5C10 5 6.5 5.5 7.5 8c.5 1.2 2.5 1.5 4.5 1.5", "M12 9.5c2-4.5 5.5-4 4.5-1.5-.5 1.2-2.5 1.5-4.5 1.5"],
} as const;

export type EventsArtName = keyof typeof ART;

/** The `name` icon, `size` px square. */
export const eventsArt = (name: EventsArtName, size: number, className = "events-art"): SVGSVGElement => {
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
  svg.setAttribute("class", className);
  for (const d of ART[name]) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};
