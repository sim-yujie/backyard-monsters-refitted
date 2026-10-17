import type { Defence } from "@/api/defences";
import { avatarOf, avatarUrl } from "@/game/avatars";
import { DEFENCE_REFUSAL_TEXT, defenceRefusal, lootTakenOf } from "@/game/defences/defenceWatch";
import { agoText } from "@/ui/attack/autoAttackText";
import { Panel } from "@/ui/Panel";
import { RESOURCE_KEYS, resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/defences.css";

/**
 * The Defences screen (issue #363, `docs/design/defence-replays.md` §8, owner
 * decision 4): the last 20 attacks other players landed on the player's Map
 * Room 2 main yard, newest first. Each row says who attacked and when, the
 * damage THAT attack did, the loot lost and the housed monsters lost, and
 * offers Watch. Watch is hidden, with the reason in grey, when the replay was
 * not kept or was fought under other battle rules than this client's.
 *
 * It docks where the mailbox does. The screen only shows and reports;
 * `DefencesDoor` fetches the list and opens a replay.
 */

export interface DefencesScreenOptions {
  /** A row's Watch was pressed. */
  readonly onWatch: (defence: Defence) => void;
  readonly onClose?: (hadFocus: boolean) => void;
  /** Unix seconds now, for "3 h ago". */
  readonly now?: () => number;
}

export const EMPTY_TEXT = "Nobody has attacked your yard yet.";
export const LOADING_TEXT = "Loading your defences…";
export const LOAD_FAILED_TEXT = "Your defences could not load. Try again.";

/**
 * A stable critter for an attacker who has not picked one. The list carries
 * no user id (a hidden bot must never be told apart), so the default comes
 * from the frozen name instead.
 */
const nameSeed = (name: string): number => {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return hash;
};

/** "did 35% damage": the damage this attack did, not what the yard was left at (owner, §12.5). */
export const damageText = (defence: Pick<Defence, "damageDone">): string =>
  `did ${Math.max(0, Math.round(defence.damageDone))}% damage`;

/** "2 housed monsters lost", or "" for none. */
export const housedText = (lost: number): string => {
  const count = Math.max(0, Math.floor(lost));
  if (count === 0) return "";
  return count === 1 ? "1 housed monster lost" : `${count} housed monsters lost`;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export class DefencesScreen {
  readonly element: HTMLElement;

  private readonly options: DefencesScreenOptions;
  private readonly now: () => number;
  private readonly status: HTMLElement;
  private readonly rows: HTMLElement;
  private opened = false;
  private shown: Defence[] | null = null;
  /** Watch pressed and waiting on the replay: its id. */
  private busy: number | null = null;
  /** A replay that could not be opened after all, by id: the words shown in place of Watch. */
  private readonly refused = new Map<number, string>();

  constructor(options: DefencesScreenOptions) {
    this.options = options;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));

    // Not Panel's own close, which removes the element for good: the screen
    // opens and closes many times over one scene.
    const panel = new Panel({ title: "Defences", className: "defences-screen", closable: false });
    this.element = panel.element;
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        this.close();
      }
    });

    const close = el("button", "btn btn--ghost btn--icon defences-screen__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close Defences");
    close.addEventListener("click", () => this.close());
    panel.titlebar.append(close);

    const intro = el("p", "defences-intro", "The last 20 attacks on your yard.");
    this.status = el("p", "defences-status");
    this.status.setAttribute("role", "status");
    this.status.hidden = true;
    this.rows = el("ul", "defences-list");
    this.rows.setAttribute("aria-label", "Attacks on your yard");
    panel.setContent(intro, this.status, this.rows);
    this.render();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** The defences as last shown; null before the first list arrives. */
  get defences(): readonly Defence[] | null {
    return this.shown;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.element.hidden = false;
    this.element.querySelector<HTMLElement>(".defences-screen__close")?.focus();
  }

  close(): void {
    if (!this.opened) return;
    const hadFocus = this.element.contains(document.activeElement);
    this.opened = false;
    this.element.hidden = true;
    this.options.onClose?.(hadFocus);
  }

  /** Shows a list, newest first, as the server gave it. */
  show(defences: readonly Defence[]): void {
    this.shown = [...defences];
    this.refused.clear();
    this.busy = null;
    this.setStatus(null);
    this.render();
  }

  /** A line over the list, such as a failed load; null clears it. */
  setStatus(text: string | null): void {
    this.status.hidden = text === null;
    this.status.textContent = text ?? "";
    this.render();
  }

  /** A Watch is waiting on its replay (that row's button says so), or none is. */
  setBusy(id: number | null): void {
    this.busy = id;
    this.render();
  }

  /** The replay could not be opened after all: the row says why instead of offering Watch. */
  refuse(id: number, text: string): void {
    this.refused.set(id, text);
    this.busy = null;
    this.render();
  }

  destroy(): void {
    this.element.remove();
  }

  private render(): void {
    if (this.shown === null) {
      // Before the first list: loading, or nothing under a failed load's line.
      if (this.status.hidden) this.rows.replaceChildren(el("li", "defences-list__empty", LOADING_TEXT));
      else this.rows.replaceChildren();
      return;
    }
    if (this.shown.length === 0) {
      this.rows.replaceChildren(el("li", "defences-list__empty", EMPTY_TEXT));
      return;
    }
    const now = this.now();
    this.rows.replaceChildren(...this.shown.map((one) => this.row(one, now)));
  }

  private row(defence: Defence, now: number): HTMLElement {
    const row = el("li", "defences-row");
    row.dataset["id"] = String(defence.id);

    const picture = el("span", "defences-row__picture");
    const image = document.createElement("img");
    image.src = avatarUrl(avatarOf(defence.attacker.pic, nameSeed(defence.attacker.name)), "small");
    image.alt = "";
    picture.append(image);

    const main = el("div", "defences-row__main");
    const head = el("div", "defences-row__head");
    head.append(el("strong", "defences-row__name", defence.attacker.name));
    const when = el("span", "defences-row__time", agoText(now - defence.landedAt));
    when.title = new Date(defence.landedAt * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    head.append(when);

    const facts = el("div", "defences-row__facts");
    facts.append(el("span", "defences-row__damage", damageText(defence)));
    const lost = lootTakenOf(defence.loot);
    const loot = RESOURCE_KEYS.filter((key) => lost[key] > 0);
    if (loot.length > 0) {
      const taken = el("span", "defences-row__loot");
      taken.setAttribute("aria-label", "Loot lost");
      taken.title = "Loot lost";
      for (const key of loot) taken.append(resourceAmount(key, lost[key]));
      facts.append(taken);
    } else {
      facts.append(el("span", "defences-row__loot defences-row__loot--none", "nothing looted"));
    }
    const housed = housedText(defence.housedLost);
    if (housed) facts.append(el("span", "defences-row__housed", housed));
    if (defence.left) facts.append(el("span", "defences-row__left", "they left the attack"));
    main.append(head, facts);

    row.append(picture, main, this.action(defence));
    return row;
  }

  private action(defence: Defence): HTMLElement {
    const refusal = this.refused.get(defence.id) ?? refusalText(defence);
    if (refusal) return el("span", "defences-row__unavailable", refusal);
    const watch = el("button", "btn btn--primary defences-row__watch", this.busy === defence.id ? "Loading…" : "Watch");
    watch.type = "button";
    watch.disabled = this.busy !== null;
    watch.setAttribute("aria-label", `Watch ${defence.attacker.name}'s attack`);
    watch.addEventListener("click", () => this.options.onWatch(defence));
    return watch;
  }
}

/** Why a row offers no Watch, in the owner's words, or null when it does. */
export const refusalText = (defence: Pick<Defence, "hasReplay" | "playable" | "rulesVersion">): string | null => {
  const refusal = defenceRefusal(defence);
  return refusal ? DEFENCE_REFUSAL_TEXT[refusal] : null;
};
