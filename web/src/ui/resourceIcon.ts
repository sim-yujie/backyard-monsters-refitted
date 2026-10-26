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
 * The four resources are piles drawn for the game (`/assets/popups/resource*.png`,
 * 128 x 128 with a transparent ground): sticks, grey stones, purple putty,
 * green goo. The old popup art was a sack spilling its contents and had to be
 * cropped to the pile on the right; these are all pile, so the whole width
 * shows. Only the empty rows above and below are trimmed, by one band shared
 * by every pile so all four are drawn at the same scale. The trim is done with
 * `background-size`/`background-position` on the one served image, so there is
 * no second copy of the art to keep in step.
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

/**
 * Which four resources the screen is showing: the surface's, or the Inferno's
 * while the player is on their Inferno yard (Inferno WP 1.19). The Inferno's
 * are Bone, Coal, Sulfur and Magma in the same four slots, as Flash swaps
 * `GLOBAL._resourceNames` for the loaded yard; Shiny is the same in both.
 *
 * The yard scene sets it when it opens a yard and puts it back when it leaves
 * ({@link setResourceRealm}), so every panel drawn meanwhile names and draws
 * the Inferno's without being told. A node already on screen keeps what it was
 * drawn with; {@link restyleIcon} brings a long-lived one (the HUD) up to date.
 */
export type ResourceRealm = "surface" | "inferno";

let realm: ResourceRealm = "surface";

/** The resources the screen shows now. */
export const resourceRealm = (): ResourceRealm => realm;

/** Shows the Inferno's resources from now on, or the surface's again. */
export const setResourceRealm = (next: ResourceRealm): void => {
  realm = next;
};

const SURFACE_NAMES: Readonly<Record<ResourceKey, string>> = {
  r1: "Twigs",
  r2: "Pebbles",
  r3: "Putty",
  r4: "Goo",
  shiny: "Shiny",
};

/** The Inferno's four (`#r_bone#`.. in Flash's keys), Shiny unchanged. */
export const INFERNO_RESOURCE_NAMES: Readonly<Record<ResourceKey, string>> = {
  r1: "Bone",
  r2: "Coal",
  r3: "Sulfur",
  r4: "Magma",
  shiny: "Shiny",
};

/** A resource's name in `inRealm`, the screen's own by default. */
export const resourceName = (key: ResourceKey, inRealm: ResourceRealm = realm): string =>
  (inRealm === "inferno" ? INFERNO_RESOURCE_NAMES : SURFACE_NAMES)[key];

/**
 * Each resource's name in the screen's realm: "Twigs" on the surface, "Bone"
 * in the Inferno. Read when used, so it follows {@link setResourceRealm}.
 */
export const RESOURCE_NAMES: Readonly<Record<ResourceKey, string>> = Object.defineProperties(
  {},
  Object.fromEntries(
    (Object.keys(SURFACE_NAMES) as ResourceKey[]).map((key) => [
      key,
      { enumerable: true, get: () => resourceName(key) },
    ]),
  ),
) as Readonly<Record<ResourceKey, string>>;

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

/**
 * The rows every pile sits within: measured from the alpha of all four, and of
 * the Inferno's bone, coal, sulfur and magma drawn to the same frame.
 */
const PILE_CROP = [0, 22, 128, 84] as const;

const pile = (url: string): IconArt => ({ url, width: 128, height: 128, crop: PILE_CROP });

const ART: Readonly<Record<ResourceKey, IconArt>> = {
  r1: pile("/assets/popups/resourcetwigs.png"),
  r2: pile("/assets/popups/resourcepebbles.png"),
  r3: pile("/assets/popups/resourceputty.png"),
  r4: pile("/assets/popups/resourcegoo.png"),
  shiny: { url: "/assets/alliances/shiny-icon.png", width: 40, height: 41, crop: [0, 0, 40, 41] },
};

/**
 * The Inferno's icons. Flash's are vector art inside `assets.swf`, which was
 * not recovered (`docs/design/inferno.md` §4, art track A2), so they are piles
 * painted for the game in the surface's frame: bone, coal, sulfur and magma,
 * 128 x 128, trimmed by the same band as the surface's.
 */
export const INFERNO_ICON_FILES: Readonly<Record<"r1" | "r2" | "r3" | "r4", string>> = {
  r1: "/assets/popups/resourcebone.png",
  r2: "/assets/popups/resourcecoal.png",
  r3: "/assets/popups/resourcesulfur.png",
  r4: "/assets/popups/resourcemagma.png",
};

const INFERNO_ART: Readonly<Record<ResourceKey, IconArt>> = {
  r1: pile(INFERNO_ICON_FILES.r1),
  r2: pile(INFERNO_ICON_FILES.r2),
  r3: pile(INFERNO_ICON_FILES.r3),
  r4: pile(INFERNO_ICON_FILES.r4),
  shiny: ART.shiny,
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
  inRealm: ResourceRealm = realm,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string; aspectRatio: string } => {
  const { url, width, height, crop } = (inRealm === "inferno" ? INFERNO_ART : ART)[key];
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
 * `title` says more, which the icon's would otherwise hide. `realm` draws it
 * as that realm's whatever the screen's is: an Inferno fight's loot on the
 * attack screen, which shows the surface's (Inferno WP 1.13).
 */
export interface ResourceIconOptions {
  readonly decorative?: boolean;
  readonly tooltip?: boolean;
  readonly realm?: ResourceRealm;
}

export const resourceIcon = (key: ResourceKey, options: ResourceIconOptions = {}): HTMLElement => {
  const icon = document.createElement("span");
  icon.className = `res-icon res-icon--${key}`;
  if (options.decorative) icon.setAttribute("aria-hidden", "true");
  else icon.setAttribute("role", "img");
  if (options.tooltip === false) icon.dataset["notip"] = "";
  restyleIcon(icon, key, options.realm);
  return icon;
};

/**
 * Draws `icon` as `key` in the screen's realm, or `inRealm`, and names it so:
 * for an icon made before the realm changed, like the HUD's, which outlives
 * the yard.
 */
export const restyleIcon = (icon: HTMLElement, key: ResourceKey, inRealm: ResourceRealm = realm): void => {
  Object.assign(icon.style, iconStyle(key, inRealm));
  icon.dataset["realm"] = inRealm;
  if (icon.getAttribute("aria-hidden") === "true") return;
  const name = resourceName(key, inRealm);
  icon.setAttribute("aria-label", name);
  if (icon.dataset["notip"] === undefined) icon.title = name;
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
 * room for them. `options.realm` draws a realm's icons whatever the screen's
 * is: a main-yard Inferno building's price in Bone, Coal, Sulfur and Magma.
 */
export const costAmounts = (
  cost: ResourceCost,
  format: (value: number) => string = formatAmount,
  options: ResourceIconOptions = {},
): HTMLElement | null => {
  const parts = RESOURCE_KEYS.filter((key) => (cost[key] ?? 0) > 0).map((key) =>
    resourceAmount(key, format(cost[key] ?? 0), options),
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
