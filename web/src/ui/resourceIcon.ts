import { formatAmount, formatCompact } from "./format";

/**
 * The resource icons every amount on screen is drawn with (issue #93).
 *
 * The owner asked for the resource's picture where a number of it is shown,
 * rather than the word, so the HUD, the attack panels, the map's cell panel
 * and the planner all spell "12,500 twigs" the same way: a small pile of twigs
 * and the number. One helper, so a change of art or size lands everywhere.
 *
 * ## The art
 *
 * The four resources come from the popup art (`/assets/popups/resource*.png`,
 * byte-identical to `archived/bag_*.png`): a sack spilling its contents,
 * about 2:1. At 18 px tall the whole picture is mostly sack, and four brown
 * sacks side by side read as one icon four times. So each is cropped to the
 * spilled pile on the right, which is where the four differ — sticks, grey
 * stones, purple putty, green goo — and which is close to square. The crop is
 * done with `background-size`/`background-position` on the one served image,
 * so there is no second copy of the art to keep in step.
 *
 * Shiny is the coin stack from `/assets/alliances/shiny-icon.png`, used whole:
 * it is already square and small, and it reads as money at any size, where
 * `missionicon/icon_shiny.png` is a flat heap in a 256-colour palette that
 * turns to a yellow smudge under 20 px.
 *
 * ## The word is still there
 *
 * Every icon is `role="img"` with the resource's name as its `aria-label` and
 * `title`, so a screen reader says "Twigs 12,500" and a mouse can hover the
 * picture to learn what it is. Plain-text surfaces — native tooltips, notices,
 * the attack report the server stores — cannot hold a picture and keep the
 * words.
 */

export type ResourceKey = "r1" | "r2" | "r3" | "r4" | "shiny";

/** The four harvested resources in the order the game has always shown them. */
export const RESOURCE_KEYS = ["r1", "r2", "r3", "r4"] as const;

export const RESOURCE_NAMES: Readonly<Record<ResourceKey, string>> = {
  r1: "Twigs",
  r2: "Pebbles",
  r3: "Putty",
  r4: "Goo",
  shiny: "Shiny",
};

/** The key a bomb's numeric `resource` (1 twigs, 2 pebbles, 3 putty) names. */
export const resourceKeyOf = (resource: number): ResourceKey =>
  resource === 1 ? "r1" : resource === 2 ? "r2" : resource === 3 ? "r3" : "r4";

interface IconArt {
  readonly url: string;
  /** The image's natural size. */
  readonly width: number;
  readonly height: number;
  /** The part shown: left, top, width, height, in image pixels. */
  readonly crop: readonly [number, number, number, number];
}

/** Crops measured from each image's alpha: the pile, without the sack. */
const ART: Readonly<Record<ResourceKey, IconArt>> = {
  r1: { url: "/assets/popups/resourcetwigs.png", width: 182, height: 95, crop: [102, 26, 79, 68] },
  r2: { url: "/assets/popups/resourcepebbles.png", width: 190, height: 101, crop: [106, 30, 83, 70] },
  r3: { url: "/assets/popups/resourceputty.png", width: 191, height: 95, crop: [107, 31, 84, 63] },
  r4: { url: "/assets/popups/resourcegoo.png", width: 192, height: 98, crop: [108, 31, 83, 65] },
  shiny: { url: "/assets/alliances/shiny-icon.png", width: 40, height: 41, crop: [0, 0, 40, 41] },
};

/** A percentage with no more digits than a stylesheet needs. */
const percent = (value: number): string => `${+value.toFixed(3)}%`;

/**
 * The CSS that shows `art`'s crop filling a box of the crop's own shape.
 *
 * `background-size` scales the image so the crop's width is the box's width;
 * `background-position` as a percentage lines up that fraction of the image
 * with the same fraction of the box, which for a crop at `x` is
 * `x / (imageWidth - cropWidth)`. A crop that is the whole image has nothing
 * to line up and sits at 0.
 */
export const iconStyle = (
  key: ResourceKey,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string; aspectRatio: string } => {
  const { url, width, height, crop } = ART[key];
  const [x, y, w, h] = crop;
  const along = (offset: number, image: number, part: number): string =>
    image === part ? "0%" : percent((offset / (image - part)) * 100);
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${percent((width / w) * 100)} ${percent((height / h) * 100)}`,
    backgroundPosition: `${along(x, width, w)} ${along(y, height, h)}`,
    aspectRatio: `${w} / ${h}`,
  };
};

/**
 * One resource's icon. Sized by the stylesheet to the surrounding text, so it
 * sits in a HUD readout and in a sentence alike.
 *
 * `decorative` drops the name from the accessibility tree and the tooltip, for
 * a control that already carries the name in its own label. `tooltip: false`
 * keeps the name for a screen reader but leaves hover to an ancestor whose own
 * `title` says more, which the icon's would otherwise hide.
 */
export interface ResourceIconOptions {
  readonly decorative?: boolean;
  readonly tooltip?: boolean;
}

export const resourceIcon = (key: ResourceKey, options: ResourceIconOptions = {}): HTMLElement => {
  const icon = document.createElement("span");
  icon.className = `res-icon res-icon--${key}`;
  Object.assign(icon.style, iconStyle(key));
  if (options.decorative) {
    icon.setAttribute("aria-hidden", "true");
  } else {
    const name = RESOURCE_NAMES[key];
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", name);
    if (options.tooltip !== false) icon.title = name;
  }
  return icon;
};

export interface ResourceAmountOptions extends ResourceIconOptions {
  readonly className?: string;
  /**
   * Spell a number short ("15.0M") instead of in full ("15,000,000", the
   * default, issue #134). Only for a control with no room to grow.
   */
  readonly compact?: boolean;
}

/**
 * "icon 15,000,000": the icon and an amount, kept together on one line.
 *
 * A number is spelled in full unless `compact` asks otherwise. A string is
 * taken as already spelled, for "12,500 of 40,000" or a placeholder dash.
 */
export const resourceAmount = (
  key: ResourceKey,
  amount: number | string,
  options: ResourceAmountOptions = {},
): HTMLElement => {
  const wrapper = document.createElement("span");
  wrapper.className = options.className ? `res-amount ${options.className}` : "res-amount";
  wrapper.dataset["resource"] = key;
  const value = document.createElement("span");
  value.className = "res-amount__value";
  value.textContent =
    typeof amount === "string" ? amount : (options.compact ? formatCompact : formatAmount)(amount);
  wrapper.append(resourceIcon(key, options), value);
  return wrapper;
};

/** The four resources of a cost; any may be missing. */
export interface ResourceCost {
  readonly r1?: number;
  readonly r2?: number;
  readonly r3?: number;
  readonly r4?: number;
}

/**
 * A cost as a row of "icon amount" pairs, leaving out whatever costs nothing,
 * or null when it all costs nothing so the caller can say so in its own words.
 *
 * Amounts are in full by default; pass `formatCompact` where the row has no
 * room for them.
 */
export const costAmounts = (
  cost: ResourceCost,
  format: (value: number) => string = formatAmount,
): HTMLElement | null => {
  const parts = RESOURCE_KEYS.filter((key) => (cost[key] ?? 0) > 0).map((key) =>
    resourceAmount(key, format(cost[key] ?? 0)),
  );
  if (parts.length === 0) return null;
  const list = document.createElement("span");
  list.className = "res-list";
  list.append(...parts);
  return list;
};

/**
 * What a screen reader would read out: text, with every icon replaced by its
 * `aria-label` and a space around it. The tests compare against this rather
 * than `textContent`, which would drop the resource names altogether.
 */
export const spokenText = (node: Node): string => {
  const walk = (current: Node): string => {
    if (current.nodeType === 3) return current.textContent ?? "";
    if (!(current instanceof Element)) return "";
    if (current.getAttribute("aria-hidden") === "true") return "";
    if (current.getAttribute("role") === "img") return ` ${current.getAttribute("aria-label") ?? ""} `;
    return [...current.childNodes].map(walk).join("");
  };
  return walk(node).replace(/\s+/g, " ").trim();
};
