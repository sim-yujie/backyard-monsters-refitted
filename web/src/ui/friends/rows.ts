import { avatarOf, avatarUrl } from "@/game/avatars";
import { levelLabel } from "@/game/friends/friendText";
import { onlineDot } from "@/ui/onlineDot";
import { spokenText } from "@/ui/resourceIcon";

/**
 * The pieces every Friends tab builds its rows from (issue #370): a row
 * with the player's critter, name and level, a line under them, and buttons
 * on the right; a section heading; a status line. `friends.css` styles them.
 */

export const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A row's button with words; `primary` for the one thing to do, `danger` to confirm a removal. */
export const button = (
  label: string,
  onClick: () => void,
  kind: "primary" | "outline" | "ghost" | "danger" = "outline",
): HTMLButtonElement => {
  const node = make("button", `btn btn--${kind} friends-row__action`, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

/** Who a row is about. */
export interface RowPlayer {
  readonly userid: number;
  readonly username: string;
  readonly pic: string | null;
  readonly level: number;
}

/** A corner mark on a row's critter, as the friends bar wears them. */
export type RowBadge = "wrench" | "gift";

const BADGE_TEXT: Readonly<Record<RowBadge, { readonly icon: string; readonly title: string }>> = {
  wrench: { icon: "🔧", title: "Can help today" },
  gift: { icon: "🎁", title: "No gift sent today" },
};

/**
 * One player's row: critter, name (with the green dot when `online`),
 * "Level 12", an optional line under them ("Seen today"), and the actions.
 * `badges` puts the bar's wrench and gift marks on the critter. `data-userid`
 * lets a test find it.
 */
export const playerRow = (
  player: RowPlayer,
  options: {
    readonly online?: boolean;
    readonly note?: string;
    readonly noteClass?: string;
    readonly actions?: readonly HTMLElement[];
    readonly badges?: readonly RowBadge[];
  } = {},
): HTMLLIElement => {
  const row = make("li", "friends-row");
  row.dataset["userid"] = String(player.userid);

  const face = make("img", "friends-row__face");
  face.src = avatarUrl(avatarOf(player.pic, player.userid), "small");
  face.alt = "";
  face.decoding = "async";
  face.loading = "lazy";
  const faceBox = make("span", "friends-row__face-box");
  faceBox.append(face);
  for (const kind of options.badges ?? []) {
    const { icon, title } = BADGE_TEXT[kind];
    const badge = make("span", `friends-row__badge friends-row__badge--${kind}`, icon);
    badge.title = title;
    badge.setAttribute("aria-label", title);
    faceBox.append(badge);
  }

  const words = make("div", "friends-row__text");
  const top = make("span", "friends-row__top");
  top.append(make("span", "friends-row__name", player.username));
  if (options.online) top.append(onlineDot());
  words.append(top);
  const level = levelLabel(player.level);
  const meta = make("span", "friends-row__meta");
  if (level) meta.append(make("span", "friends-row__level", level));
  if (options.note) meta.append(make("span", `friends-row__note ${options.noteClass ?? ""}`.trim(), options.note));
  if (meta.childElementCount > 0) words.append(meta);

  const actions = make("div", "friends-row__actions");
  actions.append(...(options.actions ?? []));
  row.append(faceBox, words, actions);
  return row;
};

/** A section's heading and its list. */
export const section = (title: string, rows: readonly HTMLElement[], empty: string): HTMLElement => {
  const wrapper = make("section", "friends-section");
  wrapper.append(make("h3", "friends-section__title", title));
  if (rows.length === 0) {
    wrapper.append(make("p", "friends-section__empty", empty));
  } else {
    const listNode = make("ul", "friends-list");
    listNode.append(...rows);
    wrapper.append(listNode);
  }
  return wrapper;
};

/** A tab's status line: loading, a refusal, a thank-you. Hidden while empty. */
export class StatusLine {
  readonly element: HTMLElement;

  constructor() {
    this.element = make("p", "friends-status");
    this.element.setAttribute("role", "status");
    this.element.hidden = true;
  }

  /** The line as a screen reader says it: a resource icon reads as its name. */
  get text(): string {
    return this.element.hidden ? "" : spokenText(this.element);
  }

  /**
   * Shows a line, words or nodes ("Sent to Bob · [twig] 1,000"); `error`
   * colours it as a refusal. Null hides it.
   */
  set(text: string | Node | null, kind: "info" | "error" = "info"): void {
    this.element.hidden = text === null;
    this.element.replaceChildren(text ?? "");
    this.element.classList.toggle("friends-status--error", kind === "error" && text !== null);
  }
}

/** What every tab offers the screen. */
export interface FriendsTabView {
  readonly element: HTMLElement;
  /** The tab came forward: fetch fresh. */
  show(): Promise<void>;
  destroy(): void;
}
