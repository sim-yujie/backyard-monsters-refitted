import { writeAmount, type AmountChange } from "./amountChange";

/**
 * The painted icons that stand in for words on screen (owner, 28 Oct: "icons
 * ok"): a red heart for health, a red claw for damage, a winged shoe for
 * speed, and so on, drawn with a number beside them instead of a sentence.
 *
 * ## The art
 *
 * Painted with Codex in the style of the resource piles and the status
 * stickers (branch `art/game-icons`, `art-samples/icons/`), and made into
 * `public/ui/icons/<name>-<side>.webp` by `tools/game-icons/make.py`: one
 * square WebP per side in {@link GAME_ICON_SIDES}, each resized from the
 * painting and sharpened for its own size. An icon shown at 24 px fetches
 * the 24 px file on an ordinary screen and the 48 px one on a sharp screen
 * (`srcset`); nothing is fetched until an icon is drawn.
 *
 * These are pictures, not the line icons of `icons.ts`, which stay for the
 * yard's round buttons. Never draw a new line icon where a word is cut: the
 * owner wants them painted. A missing picture is new art, not new code.
 *
 * ## The word is still there
 *
 * Like `resourceIcon.ts`, every icon is `role="img"` with its word as the
 * `aria-label` and the `title`, so a screen reader still says "Health 480"
 * and a mouse can hover the picture to learn what it means.
 */

/**
 * Every icon and the word it stands for. The owner's picks (27 Oct) where
 * two were painted: damage is the red claw (`damage`, not `fist`), yard
 * damage is the broken brick wall (`yarddamage2`). Monsters lost, last army
 * and per hour keep their words for now; their pictures are here for later.
 *
 * The Map Room's ground (`art-samples/mr2-ground/icons`, waiting on the
 * owner's pick): tower range is the cannon tower with range rings (`range`;
 * `range2` is the cannonball and target), income the mixed resource pile,
 * height the hill with a flag. None carries an arrow, as its number can be a
 * gain or a loss.
 */
export const GAME_ICONS = {
  health: "Health",
  damage: "Damage",
  speed: "Speed",
  housing: "Housing space",
  time: "Time",
  yarddamage: "Yard damage",
  yarddamage2: "Yard damage",
  lost: "Monsters lost",
  lost2: "Monsters lost",
  storagefull: "Storage full",
  retreat: "Retreat",
  lastarmy: "Last army",
  lastarmy2: "Last army",
  resourcebomb: "Resource bomb",
  levelup: "Level up",
  shield: "Protection",
  production: "Per hour",
  production2: "Per hour",
  swords: "Attack",
  fist: "Damage",
  range: "Tower range",
  range2: "Tower range",
  income: "Income",
  height: "Height",
} as const satisfies Record<string, string>;

export type GameIconName = keyof typeof GAME_ICONS;

/** Every icon's name, in {@link GAME_ICONS}' order. */
export const GAME_ICON_NAMES = Object.keys(GAME_ICONS) as GameIconName[];

/** The sizes an icon is shown at, in CSS pixels. */
export type GameIconSize = 16 | 24 | 32;

/** The files shipped for each icon: the three sizes, and twice 24 and 32 for sharp screens. */
export const GAME_ICON_SIDES = [16, 24, 32, 48, 64] as const;

/** Where one size of an icon is served from. */
export const gameIconUrl = (name: GameIconName, side: (typeof GAME_ICON_SIDES)[number]): string =>
  `${import.meta.env.BASE_URL}ui/icons/${name}-${side}.webp`;

/** Every file of an icon, for the browser to pick the sharpest it needs. */
export const gameIconSrcset = (name: GameIconName): string =>
  GAME_ICON_SIDES.map((side) => `${gameIconUrl(name, side)} ${side}w`).join(", ");

/**
 * `size` is 24 px unless given. `label` replaces the word, for an icon that
 * means something narrower here ("Upgrade time" rather than "Time").
 * `decorative` drops the word from the accessibility tree and the tooltip,
 * for a control that already says it in its own label; `tooltip: false`
 * keeps the word for a screen reader but leaves hover to an ancestor whose
 * own `title` says more.
 */
export interface GameIconOptions {
  readonly size?: GameIconSize;
  readonly label?: string;
  readonly decorative?: boolean;
  readonly tooltip?: boolean;
  readonly className?: string;
}

/** One painted icon, `size` px square. */
export const gameIcon = (name: GameIconName, options: GameIconOptions = {}): HTMLImageElement => {
  const size = options.size ?? 24;
  const img = document.createElement("img");
  img.className = options.className ? `game-icon game-icon--${name} ${options.className}` : `game-icon game-icon--${name}`;
  img.dataset["icon"] = name;
  img.width = size;
  img.height = size;
  img.src = gameIconUrl(name, size);
  img.srcset = gameIconSrcset(name);
  img.sizes = `${size}px`;
  img.decoding = "async";
  img.draggable = false;
  if (options.decorative) {
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
  } else {
    const word = options.label ?? GAME_ICONS[name];
    img.alt = word;
    img.setAttribute("role", "img");
    img.setAttribute("aria-label", word);
    if (options.tooltip !== false) img.title = word;
  }
  return img;
};

export interface IconAmountOptions extends GameIconOptions {
  /** Spell a number short ("15.0M") instead of in full ("15,000,000"). */
  readonly compact?: boolean;
  /** Draw it as a `.chip`: the rounded label of a level or a count. */
  readonly chip?: boolean;
  /**
   * Something that happened, not a price or a level: "+300" in green for a
   * gain, "−300" in red for a loss, said as "300 gained" / "300 lost"
   * (`amountChange.ts`).
   */
  readonly change?: AmountChange;
}

/**
 * "icon 480": a painted icon and a number, kept together on one line; the
 * `resourceAmount` (resourceIcon.ts) of everything that is not a resource.
 * The icon is 16 px unless `size` says otherwise.
 *
 * A number is spelled in full unless `compact` asks otherwise. A string is
 * taken as already spelled, for "400 → 480", "35%" or "0/3". `change` signs
 * and colours it as a gain or a loss.
 */
export const iconAmount = (
  name: GameIconName,
  amount: number | string,
  options: IconAmountOptions = {},
): HTMLElement => {
  const wrapper = document.createElement("span");
  wrapper.className = ["icon-amount", options.chip ? "chip" : "", options.className ?? ""].filter(Boolean).join(" ");
  wrapper.dataset["icon"] = name;
  const icon = gameIcon(name, {
    size: options.size ?? 16,
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.decorative === undefined ? {} : { decorative: options.decorative }),
    ...(options.tooltip === undefined ? {} : { tooltip: options.tooltip }),
  });
  wrapper.append(icon);
  writeAmount(wrapper, "icon-amount", amount, options);
  return wrapper;
};

/** {@link iconAmount} as a chip: "[heart 480]". */
export const iconChip = (
  name: GameIconName,
  amount: number | string,
  options: Omit<IconAmountOptions, "chip"> = {},
): HTMLElement => iconAmount(name, amount, { ...options, chip: true });
