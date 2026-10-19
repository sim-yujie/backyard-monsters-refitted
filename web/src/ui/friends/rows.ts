import { avatarOf, avatarUrl } from "@/game/avatars";
import { levelLabel } from "@/game/friends/friendText";

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

/**
 * One player's row: critter, name, "Level 12", an optional line under them
 * (online, "2 h ago"), and the actions. `data-userid` lets a test find it.
 */
export const playerRow = (
  player: RowPlayer,
  options: { readonly note?: string; readonly noteClass?: string; readonly actions?: readonly HTMLElement[] } = {},
): HTMLLIElement => {
  const row = make("li", "friends-row");
  row.dataset["userid"] = String(player.userid);

  const face = make("img", "friends-row__face");
  face.src = avatarUrl(avatarOf(player.pic, player.userid), "small");
  face.alt = "";
  face.decoding = "async";
  face.loading = "lazy";

  const words = make("div", "friends-row__text");
  const name = make("span", "friends-row__name", player.username);
  words.append(name);
  const level = levelLabel(player.level);
  const meta = make("span", "friends-row__meta");
  if (level) meta.append(make("span", "friends-row__level", level));
  if (options.note) meta.append(make("span", `friends-row__note ${options.noteClass ?? ""}`.trim(), options.note));
  if (meta.childElementCount > 0) words.append(meta);

  const actions = make("div", "friends-row__actions");
  actions.append(...(options.actions ?? []));
  row.append(face, words, actions);
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

  get text(): string {
    return this.element.hidden ? "" : (this.element.textContent ?? "");
  }

  /** Shows a line; `error` colours it as a refusal. Null hides it. */
  set(text: string | null, kind: "info" | "error" = "info"): void {
    this.element.hidden = text === null;
    this.element.textContent = text ?? "";
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
