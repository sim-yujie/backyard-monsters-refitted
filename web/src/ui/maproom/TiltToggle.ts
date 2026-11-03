import { button } from "@/ui/maproom1/icons";

/**
 * The map's "Tilted map" button beside the zoom buttons (MR2 look plan step 4,
 * owner 3 Nov 2026: the tilt is on by default in Modern, opt-out). Pressed
 * while the map is tilted; a press switches the map flat or back, and the
 * scene stores the choice on the account.
 *
 * Hidden when the map cannot tilt at all: in Classic, which is always flat,
 * and while the server's MR2_TILT switch is off.
 *
 * A view only: the scene decides whether the map is tilted and calls `set`.
 */

export const TILT_TOGGLE_TEXT = {
  tilted: "Tilted map: on. Press for a flat map.",
  flat: "Tilted map: off. Press to tilt the map.",
} as const;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The icon: the ground seen at an angle, a grid narrower at the far edge,
 * when tilted; the same grid seen from straight above when flat.
 */
const ICON_PATHS = {
  tilted: ["M7 6h10l4 13H3z", "M12 6v13", "M5 12.5h14"],
  flat: ["M4 4h16v16H4z", "M12 4v16", "M4 12h16"],
} as const;

const drawIcon = (shape: keyof typeof ICON_PATHS): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "map-icon");
  for (const d of ICON_PATHS[shape]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};

export class TiltToggle {
  readonly element: HTMLButtonElement;
  private tilted = false;

  constructor(onToggle: (tilted: boolean) => void) {
    this.element = button("mr2-tool mr2-tilt-toggle");
    this.element.hidden = true;
    this.element.addEventListener("click", () => onToggle(!this.tilted));
    this.render();
  }

  get isTilted(): boolean {
    return this.tilted;
  }

  /** Shows the map's state: whether the button is there at all, and whether it is pressed. */
  set(state: { available: boolean; tilted: boolean }): void {
    this.element.hidden = !state.available;
    if (state.tilted === this.tilted && this.element.childElementCount > 0) return;
    this.tilted = state.tilted;
    this.render();
  }

  private render(): void {
    const text = this.tilted ? TILT_TOGGLE_TEXT.tilted : TILT_TOGGLE_TEXT.flat;
    this.element.setAttribute("aria-pressed", String(this.tilted));
    this.element.setAttribute("aria-label", text);
    this.element.title = text;
    this.element.replaceChildren(drawIcon(this.tilted ? "tilted" : "flat"));
  }
}
