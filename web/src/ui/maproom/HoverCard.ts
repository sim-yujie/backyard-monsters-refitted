import { CellType, isPlayerCell, isWaterCell, type MapCell } from "@/api/types";
import { avatarOf, avatarUrl } from "@/game/avatars";
import { cellsText, type ReachAnswer } from "@/game/maproom/attackRange";
import { TRIBE_COLOURS } from "@/game/maproom/cellVisuals";
import { tribePictureUrl } from "@/game/maproom/tribeAvatars";
import { el, icon } from "@/ui/maproom1/icons";

/**
 * The card that names a cell under the pointer (#176, R-MR2-Map-A): the map
 * itself carries no names, so hovering a camp or a yard shows its picture,
 * "Legionnaire camp · Level 34", and how it stands against the player's range
 * ("In range · 3 cells away · click for more", or "Out of range · 2 cells too
 * far", R-MR2-Range).
 *
 * A view only, placed in screen pixels by the scene. Pointer devices only: on
 * a touch screen a tap opens the cell panel, which says all of this and more.
 */

export interface HoverCardContent {
  /** The tribe's portrait or the owner's critter. */
  readonly picture: string | null;
  /** The picture's ring: the tribe's colour, or the accent for the player's own. */
  readonly ring: string | null;
  readonly title: string;
  readonly detail: string;
  /** The detail is a warning: out of range. */
  readonly warn: boolean;
}

/** Gap between the hovered cell's edge and the card, in screen pixels. */
const GAP = 10;

export class HoverCard {
  readonly element: HTMLElement;

  private readonly picture: HTMLElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly detailText: HTMLElement;

  constructor() {
    this.element = el("div", "mr2-float mr2-hover");
    this.element.setAttribute("role", "tooltip");
    this.element.hidden = true;
    this.picture = el("span", "mr2-hover__picture");
    this.title = el("span", "mr2-hover__title");
    this.detailText = el("span");
    this.detail = el("span", "mr2-hover__detail");
    this.detail.append(icon("range", 14, "map-icon mr2-hover__icon"), this.detailText);
    const text = el("span", "mr2-hover__text");
    text.append(this.title, this.detail);
    this.element.append(this.picture, text);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /**
   * Shows the card beside a cell: to its right, or to its left when that
   * would run off the screen. `left`/`right` are the cell's screen edges and
   * `middle` its centre line.
   */
  show(content: HoverCardContent, at: { left: number; right: number; middle: number }): void {
    this.title.textContent = content.title;
    this.detailText.textContent = content.detail;
    this.detail.classList.toggle("mr2-hover__detail--warn", content.warn);
    this.picture.hidden = content.picture === null;
    this.picture.replaceChildren();
    if (content.picture) {
      const image = document.createElement("img");
      image.src = content.picture;
      image.alt = "";
      this.picture.append(image);
    }
    if (content.ring) this.picture.style.setProperty("--ring", content.ring);
    else this.picture.style.removeProperty("--ring");

    this.element.hidden = false;
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const room = this.element.parentElement?.clientWidth ?? window.innerWidth;
    const x = at.right + GAP + width <= room ? at.right + GAP : Math.max(0, at.left - GAP - width);
    this.element.style.transform = `translate(${Math.round(x)}px, ${Math.round(at.middle - height / 2)}px)`;
  }

  hide(): void {
    this.element.hidden = true;
  }

  destroy(): void {
    this.element.remove();
  }
}

/** A camp's or a yard's name and level as the card titles it. */
export const hoverTitle = (payload: MapCell): string | null => {
  if (isWaterCell(payload)) return null;
  if (!isPlayerCell(payload)) return `${payload.n} camp · Level ${payload.l}`;
  const outpost = payload.b === CellType.OUTPOST;
  const name = payload.mine === 1 ? (outpost ? "Your outpost" : "Your yard") : payload.n;
  return `${name} · Level ${payload.l}`;
};

/**
 * What the card says about a cell, or null for water and a zone still loading.
 * `reach` is how the cell stands against the player's range (`attackRange.ts`).
 */
export const hoverContentFor = (
  payload: MapCell | undefined,
  reach: ReachAnswer,
): HoverCardContent | null => {
  if (!payload || isWaterCell(payload)) return null;
  const title = hoverTitle(payload);
  if (!title) return null;

  let picture: string | null;
  let ring: string | null;
  if (isPlayerCell(payload)) {
    picture = avatarUrl(avatarOf(payload.pic_square, payload.uid), "small");
    ring = payload.mine === 1 ? "var(--colour-accent)" : null;
  } else {
    picture = tribePictureUrl(payload.n);
    const colour = TRIBE_COLOURS[payload.n];
    ring = colour === undefined ? null : `#${colour.toString(16).padStart(6, "0")}`;
  }

  const mine = isPlayerCell(payload) && payload.mine === 1;
  if (mine || !reach.source) {
    return { picture, ring, title, detail: "Click for more", warn: false };
  }
  if (!reach.inRange) {
    return {
      picture,
      ring,
      title,
      detail: `Out of range · ${cellsText(reach.steps)} too far`,
      warn: true,
    };
  }
  return {
    picture,
    ring,
    title,
    detail: `In range · ${cellsText(reach.steps)} away · click for more`,
    warn: false,
  };
};
