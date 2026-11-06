/**
 * The little icons over a creep that is under an effect (beta.5): poisoned,
 * burning, enraged, puttied, in Krallen's loot aura.
 *
 * ## What Flash did
 *
 * A `CStatusEffect` (`client/scripts/com/monsters/monsters/components/statusEffects/CStatusEffect.as`)
 * hung its icon on the monster while it lasted and took it off when it ended
 * or the monster died: Korath's flame (`effects/flame_icon.png`) and Fang's
 * venom (`effects/venom_icon.v2.png`). Two or more sat side by side above the
 * graphic, the first in the middle and the rest alternating right and left,
 * 5 px apart (`updatePosition`). Auras and boosts had no icon there, only a
 * glow filter.
 *
 * ## What this does
 *
 * Every effect the engine reports on a {@link CreepSnapshot} gets its painted
 * sticker (`public/status-icons/<id>.webp`, a symbol with a white sticker
 * edge, 2x the size it shows at), the row centred over the health bar in
 * {@link STATUS_EFFECTS}' order so the icons never swap places as effects
 * come and go. The code only places,
 * stacks and fades them; the look is all in the pictures.
 *
 * ## Adding an effect
 *
 * One line in {@link STATUS_EFFECTS}: the snapshot flag that says it is on.
 * Its picture is the file named after its id. The stickers a slow, a stun and
 * a freeze need are shipped already, waiting for the engine to have those
 * effects:
 *
 *     { id: "slowed", label: "Slowed", stacks: (c) => (c.slowed ? 1 : 0) },
 *
 * ## Towers (owner, beta 6)
 *
 * Towers carry the same stickers, placed the same way: a row centred over the
 * tower's health bar ({@link TowerStatusIcons}). The first is "weakened", a
 * tower that killed a ranked Octo-ooze ({@link TOWER_STATUS_EFFECTS}).
 *
 * Drawing only; nothing here reaches the battle.
 */

import { Assets, Container, Sprite, Texture } from "pixi.js";
import type { CreepSnapshot } from "@/game/combat/rules";

/** A sticker: its picture and what a player would call it. */
export interface StatusIcon {
  /** Also the picture's name: `status-icons/<id>.webp`. */
  readonly id: string;
  /** What a player would call it; for tests and the review page. */
  readonly label: string;
}

export interface StatusEffect<T = CreepSnapshot> extends StatusIcon {
  /** How strongly it is on the creep (or tower): 0 when it is not, its stacks when it stacks. */
  readonly stacks: (on: T) => number;
}

/** Every effect with an icon, in the order the row shows them left to right. */
export const STATUS_EFFECTS: readonly StatusEffect[] = [
  { id: "poisoned", label: "Poisoned", stacks: (c) => c.poisonStacks ?? 0 },
  { id: "burning", label: "Burning", stacks: (c) => (c.burning ? 1 : 0) },
  { id: "enraged", label: "Enraged", stacks: (c) => (c.enraged ? 1 : 0) },
  { id: "puttied", label: "Putty boost", stacks: (c) => (c.puttied ? 1 : 0) },
  { id: "lootBoosted", label: "Loot boost", stacks: (c) => (c.lootBoosted ? 1 : 0) },
  // The revamp's Lab abilities (owner, beta 6): a ranked Pokey in a swarm of 5,
  // and a monster that killed a defending ranked Octo-ooze.
  { id: "swarming", label: "Swarming", stacks: (c) => (c.swarming ? 1 : 0) },
  { id: "weakened", label: "Weakened", stacks: (c) => (c.weakened ? 1 : 0) },
];

/** What a tower's stickers read: the engine's word on it this frame. */
export interface TowerStatusState {
  /** It killed a ranked Octo-ooze and deals less for a while (`Battle.weakenedTowers`). */
  readonly weakened: boolean;
}

/** Every effect a tower can show, left to right. */
export const TOWER_STATUS_EFFECTS: readonly StatusEffect<TowerStatusState>[] = [
  { id: "weakened", label: "Weakened", stacks: (t) => (t.weakened ? 1 : 0) },
];

/** The pictures in `public/status-icons/`: the effects above and the ones still waiting for the engine. */
export const STATUS_ICON_FILES = [
  "poisoned",
  "burning",
  "enraged",
  "puttied",
  "lootBoosted",
  "swarming",
  "weakened",
  "slowed",
  "stunned",
  "frozen",
] as const;

/** Where an effect's picture is served from. */
export const statusIconUrl = (id: string): string => `${import.meta.env.BASE_URL}status-icons/${id}.webp`;

/** One icon to show: the effect and how many stacks it has. */
export interface ActiveStatus {
  readonly effect: StatusIcon;
  readonly stacks: number;
}

/** The effects on a creep, in {@link STATUS_EFFECTS}' order; empty for none or no creep. */
export const statusesOf = (
  creep: CreepSnapshot | null,
  effects: readonly StatusEffect[] = STATUS_EFFECTS,
): ActiveStatus[] => activeOf(creep, effects);

/** The effects on anything, a creep or a tower, in `effects`' order; empty for none. */
export const activeOf = <T>(on: T | null, effects: readonly StatusEffect<T>[]): ActiveStatus[] => {
  if (!on) return [];
  const active: ActiveStatus[] = [];
  for (const effect of effects) {
    const stacks = effect.stacks(on);
    if (stacks > 0) active.push({ effect, stacks });
  }
  return active;
};

/** An icon's width and height in world px (the files are 48 px); a creep's health bar is 18 wide. */
export const ICON_SIZE = 12;
/** A tower's icons: its health bar is 51 wide, so they are drawn a little larger. */
export const TOWER_ICON_SIZE = 18;
/** The space between two icons, and between the row and the bar under it. */
export const ICON_GAP = 1;
/** A stacking effect's icon grows this much a stack past the first, up to {@link MAX_GROWTH_STACKS}. */
const STACK_GROWTH = 0.08;
const MAX_GROWTH_STACKS = 5;

/** An icon's scale for its stacks: 1 for one, a little bigger for each more, capped. */
export const badgeScale = (stacks: number): number =>
  1 + (Math.min(Math.max(stacks, 1), MAX_GROWTH_STACKS) - 1) * STACK_GROWTH;

/**
 * Where each of `count` icons `size` across goes: a row centred on
 * `centreX`, its icons' centres on one line `ICON_GAP` above `barTop`, so a
 * long row spreads both ways as Flash's did rather than running off one side.
 */
export const statusRow = (
  count: number,
  centreX: number,
  barTop: number,
  size = ICON_SIZE,
): { x: number; y: number }[] => {
  const step = size + ICON_GAP;
  const first = centreX - ((count - 1) * step) / 2;
  const y = barTop - ICON_GAP - size / 2;
  return Array.from({ length: count }, (_, index) => ({ x: first + index * step, y }));
};

/** Fetches one picture; `Assets.load` in the client, something else in a test. */
export type StatusIconLoader = (url: string) => Promise<Texture>;

/**
 * The icon pictures, fetched on first need and shared by every creep. `get`
 * never blocks: null until the file is in, and a file that failed is asked
 * for once.
 */
export class StatusIconTextures {
  private readonly ready = new Map<string, Texture>();
  private readonly asked = new Set<string>();

  constructor(
    // Mipmaps: a 48 px picture is drawn at a quarter of that zoomed out, and shimmers without them.
    private readonly load: StatusIconLoader = (url) =>
      Assets.load<Texture>({ src: url, data: { autoGenerateMipmaps: true } }),
  ) {}

  get(effect: StatusIcon): Texture | null {
    const url = statusIconUrl(effect.id);
    const ready = this.ready.get(url);
    if (ready) return ready;
    if (!this.asked.has(url)) {
      this.asked.add(url);
      this.load(url)
        .then((texture) => {
          this.ready.set(url, texture);
        })
        .catch((caught: unknown) => {
          console.warn(`Status icon ${url} did not load.`, caught);
        });
    }
    return null;
  }
}

const sharedTextures = new StatusIconTextures();

/**
 * A creep's row of icons: one Sprite per effect it has carried, made on
 * first need and kept with the creep's pooled view, shown or hidden each frame.
 */
export class StatusIconRow {
  readonly container = new Container();
  private readonly icons = new Map<string, Sprite>();

  constructor(
    private readonly textures: StatusIconTextures = sharedTextures,
    private readonly size = ICON_SIZE,
  ) {
    this.container.eventMode = "none";
    this.container.visible = false;
  }

  /** The icons showing now, by effect id, left to right; for tests. */
  get shown(): string[] {
    return [...this.icons.entries()]
      .filter(([, icon]) => icon.visible)
      .sort(([, one], [, other]) => one.x - other.x)
      .map(([id]) => id);
  }

  /**
   * Shows `statuses` in a row centred on `centreX` above a bar whose top is
   * `barTop`. An icon whose picture is still on its way keeps its place in the
   * row, so the others do not shift when it arrives.
   */
  show(statuses: readonly ActiveStatus[], centreX: number, barTop: number, alpha = 1): void {
    if (statuses.length === 0 || alpha <= 0) {
      this.hide();
      return;
    }
    for (const icon of this.icons.values()) icon.visible = false;
    const spots = statusRow(statuses.length, centreX, barTop, this.size);
    statuses.forEach(({ effect, stacks }, index) => {
      const texture = this.textures.get(effect);
      if (!texture) return;
      const icon = this.icon(effect);
      const spot = spots[index] as { x: number; y: number };
      if (icon.texture !== texture) icon.texture = texture;
      icon.visible = true;
      icon.position.set(Math.round(spot.x), Math.round(spot.y));
      icon.scale.set((this.size / Math.max(1, texture.width, texture.height)) * badgeScale(stacks));
    });
    this.container.alpha = alpha;
    this.container.visible = true;
  }

  hide(): void {
    this.container.visible = false;
    for (const icon of this.icons.values()) icon.visible = false;
  }

  destroy(): void {
    // The pictures are shared; only the Sprites over them go.
    for (const icon of this.icons.values()) icon.destroy();
    this.icons.clear();
    this.container.destroy();
  }

  private icon(effect: StatusIcon): Sprite {
    const ready = this.icons.get(effect.id);
    if (ready) return ready;
    const icon = new Sprite(Texture.EMPTY);
    icon.anchor.set(0.5);
    icon.eventMode = "none";
    this.icons.set(effect.id, icon);
    this.container.addChild(icon);
    return icon;
  }
}

/**
 * The towers' rows of stickers (owner, beta 6): one {@link StatusIconRow} per
 * tower that has had an effect, centred over where its health bar sits.
 * `barOf` is the bar's top centre in world px, or null for a tower not drawn.
 */
export class TowerStatusIcons {
  /** Add to the battle overlay, over the health bars. */
  readonly root = new Container();
  private readonly rows = new Map<number, StatusIconRow>();

  constructor(
    private readonly barOf: (id: number) => { x: number; y: number } | null,
    private readonly textures: StatusIconTextures = sharedTextures,
  ) {
    this.root.eventMode = "none";
  }

  /** The towers showing a sticker now, and which; for tests. */
  get shown(): Record<number, string[]> {
    const out: Record<number, string[]> = {};
    for (const [id, row] of this.rows) if (row.shown.length > 0) out[id] = row.shown;
    return out;
  }

  /** Shows the stickers of the towers in `weakened` and hides every other row. */
  sync(weakened: readonly number[]): void {
    const on = new Set(weakened);
    for (const [id, row] of this.rows) if (!on.has(id)) row.hide();
    for (const id of on) {
      const bar = this.barOf(id);
      if (!bar) continue;
      let row = this.rows.get(id);
      if (!row) {
        row = new StatusIconRow(this.textures, TOWER_ICON_SIZE);
        this.rows.set(id, row);
        this.root.addChild(row.container);
      }
      row.show(activeOf({ weakened: true }, TOWER_STATUS_EFFECTS), bar.x, bar.y);
    }
  }

  destroy(): void {
    for (const row of this.rows.values()) row.destroy();
    this.rows.clear();
    this.root.destroy({ children: true });
  }
}
