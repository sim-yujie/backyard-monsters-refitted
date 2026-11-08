import {
  ALLIANCES_LIVE,
  BORDER_RIM_COLOUR,
  type BorderStyle,
  cssHex,
  legendRows,
  type PlayerRelation,
  RELATION_LOOK,
} from "@/game/maproom/relationLook";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { button, el } from "@/ui/maproom1/icons";

/**
 * The map's key (owner, 8 Nov 2026): a "Key" button in the Map Room 2 tool row that opens a
 * small card explaining the border colours - yours, friend, pinned friend, alliance (once
 * alliances exist), hostile and neutral. Each row is a hex in that border's colour and line, the
 * painted icon the rest of the game uses for that kind of player, and one or two words.
 *
 * The button's picture is three little bordered hexes in the key's own colours: no painted "key"
 * icon exists yet, and the swatches say "colours" better than a key would.
 *
 * Escape, a press outside, or the button again closes the card.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** The swatch's ground: the painted map's grass. */
const SWATCH_GROUND = "#4d7b0d";

/** The painted icon beside each row; neutral has none. */
const ROW_ICON: Partial<Record<PlayerRelation, GameIconName>> = {
  you: "townhall",
  friend: "friends",
  pinned: "pin",
  alliance: "alliance",
  hostile: "swords",
};

/** A few words under the row, only where the word alone is not enough. */
export const LEGEND_HINT: Partial<Record<PlayerRelation, string>> = {
  you: "Yard and outposts",
  hostile: "Attacked either way, no truce",
};

export const MAP_LEGEND_TEXT = {
  button: "Key",
  title: "Map key",
  tooltip: "What the border colours mean",
} as const;

/** A pointy-top hex's corners inside a `w` by `h` box, inset by `inset`. */
const hexPoints = (w: number, h: number, inset: number): string => {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - inset;
  const ry = h / 2 - inset;
  return [
    [cx, cy - ry],
    [cx + rx, cy - ry / 2],
    [cx + rx, cy + ry / 2],
    [cx, cy + ry],
    [cx - rx, cy + ry / 2],
    [cx - rx, cy - ry / 2],
  ]
    .map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`)
    .join(" ");
};

const polygon = (points: string, attrs: Record<string, string>): SVGPolygonElement => {
  const shape = document.createElementNS(SVG_NS, "polygon");
  shape.setAttribute("points", points);
  for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
  return shape;
};

/** Stroke width of each line style in the swatch, matching the map's weights. */
const STROKE: Record<BorderStyle, number> = {
  thick: 3.6,
  solid: 2.6,
  thin: 1.6,
  double: 1.4,
  doubleBold: 2,
  dashed: 2.6,
};

/**
 * One hex in a relation's border: the grass, the dark rim under the line, then the line itself
 * (one solid line, two thin lines for friends, or dashes for hostile).
 */
export const relationSwatch = (relation: PlayerRelation, size = 28): SVGSVGElement => {
  const look = RELATION_LOOK[relation];
  const w = size;
  const h = Math.round(size * 1.12);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("mr2-key__swatch");
  svg.dataset["style"] = look.style;

  const colour = cssHex(look.colour);
  const rim = cssHex(BORDER_RIM_COLOUR);
  const width = STROKE[look.style];
  const outer = hexPoints(w, h, 2.5);
  svg.append(
    polygon(outer, {
      fill: SWATCH_GROUND,
      stroke: rim,
      "stroke-width": String(width + 2.4),
      "stroke-linejoin": "round",
    }),
  );

  if (look.style === "double" || look.style === "doubleBold") {
    const gap = width + 2.2;
    svg.append(
      polygon(hexPoints(w, h, 2.5 + gap), {
        fill: "none",
        stroke: rim,
        "stroke-width": String(width + 1.6),
      }),
    );
    svg.append(
      polygon(outer, {
        fill: "none",
        stroke: colour,
        "stroke-width": String(width),
        "stroke-linejoin": "round",
      }),
    );
    svg.append(
      polygon(hexPoints(w, h, 2.5 + gap), {
        fill: "none",
        stroke: colour,
        "stroke-width": String(width),
        "stroke-linejoin": "round",
      }),
    );
  } else {
    const attrs: Record<string, string> = {
      fill: "none",
      stroke: colour,
      "stroke-width": String(width),
      "stroke-linejoin": "round",
    };
    if (look.style === "dashed") attrs["stroke-dasharray"] = "5 3.2";
    svg.append(polygon(outer, attrs));
  }
  return svg;
};

/** The button's picture: three small hexes in the key's colours. */
const buttonPicture = (): HTMLElement => {
  const wrap = el("span", "mr2-key__icon");
  wrap.setAttribute("aria-hidden", "true");
  for (const relation of ["you", "friend", "hostile"] as const)
    wrap.append(relationSwatch(relation, 14));
  return wrap;
};

export class MapLegend {
  /** The tool row's "Key" button. */
  readonly toggle: HTMLButtonElement;
  /** The card it opens; goes just after {@link toggle}. */
  readonly element: HTMLElement;

  constructor(options: { alliances?: boolean } = {}) {
    this.element = el("section", "mr2-float mr2-key");
    this.element.id = "mr2-key";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", MAP_LEGEND_TEXT.title);
    this.element.append(el("h2", "mr2-key__title", MAP_LEGEND_TEXT.title));

    const list = el("ul", "mr2-key__list");
    for (const relation of legendRows(options.alliances ?? ALLIANCES_LIVE)) {
      const row = el("li", "mr2-key__row");
      row.dataset["relation"] = relation;
      const iconName = ROW_ICON[relation];
      const iconSlot = el("span", "mr2-key__picture");
      if (iconName) iconSlot.append(gameIcon(iconName, { size: 24, decorative: true }));
      const words = el("span", "mr2-key__words");
      words.append(el("span", "mr2-key__label", RELATION_LOOK[relation].label));
      const hint = LEGEND_HINT[relation];
      if (hint) words.append(el("span", "mr2-key__hint", hint));
      row.append(relationSwatch(relation), iconSlot, words);
      list.append(row);
    }
    this.element.append(list);

    this.toggle = button("mr2-tool mr2-key__toggle");
    this.toggle.append(buttonPicture(), el("span", "mr2-tool__label", MAP_LEGEND_TEXT.button));
    this.toggle.title = MAP_LEGEND_TEXT.tooltip;
    this.toggle.setAttribute("aria-controls", this.element.id);
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.addEventListener("click", () => this.setOpen(!this.open));
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
  }

  get open(): boolean {
    return !this.element.hidden;
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
  }

  /** A press outside the button and the card, or Escape, closes the card. */
  private readonly dismiss = (event: Event): void => {
    if (!this.open) return;
    if (event instanceof KeyboardEvent) {
      if (event.key === "Escape") this.setOpen(false);
      return;
    }
    const target = event.target;
    if (
      target instanceof Node &&
      (this.element.contains(target) || this.toggle.contains(target))
    )
      return;
    this.setOpen(false);
  };
}
