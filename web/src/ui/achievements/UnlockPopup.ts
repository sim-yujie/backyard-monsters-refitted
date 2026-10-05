import type { UnlockCard, UnlockInbox } from "@/game/achievements/unlockInbox";
import { summaryHeading, nameList, shinyText } from "@/game/achievements/unlockText";
import { formatAmount } from "@/ui/format";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/achievement-popup.css";

/**
 * The unlock pop-up (`docs/design/achievements.md` §10.2, issue #204, WP6): a
 * card that slides up at the bottom centre with a badge, "Achievement
 * earned!", the name, the Shiny and View. It stays {@link CARD_MS}, then goes,
 * and the next waiting card follows; the backfill's unlocks are one summary
 * card. A pointer over it, or focus in it, keeps it up.
 *
 * `hold` keeps cards back (Bob's guided start); what is already up finishes.
 * The pop-up only shows: `onShown` is where the caller says `seen`.
 */

/** How long a card stays up, ms. `[PLACEHOLDER]` in the design. */
export const CARD_MS = 6000;
/** The pause between one card going and the next, ms: long enough to read as two. */
export const GAP_MS = 400;

export const EARNED_TEXT = "Achievement earned!";
export const EARNED_MANY_TEXT = "Achievements earned!";

export interface UnlockPopupOptions {
  readonly inbox: UnlockInbox;
  /** A card went up. */
  readonly onShown: (card: UnlockCard) => void;
  /** How to open the achievements screen, or null while it cannot open (View is hidden then). */
  readonly opener: () => (() => void) | null;
}

export class UnlockPopup {
  /** The dock the card sits in; the caller mounts it. */
  readonly element: HTMLElement;

  private readonly options: UnlockPopupOptions;
  private readonly unsubscribe: () => void;
  private card: HTMLElement | null = null;
  private timer: number | undefined;
  private held = false;
  /** A card's time is paused while the pointer or focus is on it. */
  private paused = { pointer: false, focus: false };
  private destroyed = false;

  constructor(options: UnlockPopupOptions) {
    this.options = options;
    this.element = document.createElement("div");
    this.element.className = "ach-pop";
    // Announced rather than read on focus: it appears without the player doing anything.
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.unsubscribe = options.inbox.subscribe(() => this.pump());
  }

  /** Whether a card is up. */
  get showing(): boolean {
    return this.card !== null;
  }

  /** Keeps waiting cards back while `on`; letting go shows the next at once. */
  hold(on: boolean): void {
    this.held = on;
    if (!on) this.pump();
  }

  /** Shows the next waiting card when nothing is up and nothing holds it back. */
  pump(): void {
    if (this.destroyed || this.held || this.card || this.timer !== undefined) return;
    const card = this.options.inbox.next();
    if (!card) return;
    this.show(card);
    this.options.onShown(card);
  }

  /** Takes the card down now; the next follows after {@link GAP_MS}. */
  dismiss(): void {
    if (!this.card) return;
    this.clearTimer();
    this.card.remove();
    this.card = null;
    this.paused = { pointer: false, focus: false };
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.pump();
    }, GAP_MS);
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.clearTimer();
    this.card = null;
    this.element.remove();
  }

  private show(card: UnlockCard): void {
    const element = document.createElement("div");
    element.className = card.summary ? "ach-card ach-card--summary" : "ach-card";

    const badge = document.createElement("div");
    badge.className = "ach-card__badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = card.summary ? String(card.unlocks.length) : "★";

    const body = document.createElement("div");
    body.className = "ach-card__body";
    const kicker = document.createElement("p");
    kicker.className = "ach-card__kicker";
    kicker.textContent = card.summary ? EARNED_MANY_TEXT : EARNED_TEXT;
    const name = document.createElement("p");
    name.className = "ach-card__name";
    name.textContent = card.summary ? summaryHeading(card.unlocks.length) : (card.unlocks[0]?.name ?? "");
    body.append(kicker, name);
    if (card.summary) {
      const names = document.createElement("p");
      names.className = "ach-card__names";
      names.textContent = nameList(card.unlocks.map((unlock) => unlock.name));
      body.append(names);
    }
    if (card.shiny > 0) {
      const shiny = resourceAmount("shiny", `+${formatAmount(card.shiny)}`, { className: "ach-card__shiny" });
      shiny.setAttribute("aria-label", shinyText(card.shiny));
      body.append(shiny);
    }

    const actions = document.createElement("div");
    actions.className = "ach-card__actions";
    const open = this.options.opener();
    if (open) {
      const view = document.createElement("button");
      view.type = "button";
      view.className = "btn btn--primary ach-card__view";
      view.textContent = "View";
      view.addEventListener("click", () => {
        this.dismiss();
        open();
      });
      actions.append(view);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon ach-card__close";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.addEventListener("click", () => this.dismiss());
    actions.append(close);

    element.append(badge, body, actions);
    element.addEventListener("pointerenter", () => this.pause("pointer", true));
    element.addEventListener("pointerleave", () => this.pause("pointer", false));
    element.addEventListener("focusin", () => this.pause("focus", true));
    element.addEventListener("focusout", (event) => {
      if (!element.contains(event.relatedTarget as Node | null)) this.pause("focus", false);
    });

    this.card = element;
    this.element.append(element);
    this.startTimer();
  }

  /** Stops the card's time while anything keeps it up; a fresh {@link CARD_MS} once nothing does. */
  private pause(by: "pointer" | "focus", on: boolean): void {
    if (!this.card) return;
    this.paused = { ...this.paused, [by]: on };
    if (this.paused.pointer || this.paused.focus) this.clearTimer();
    else this.startTimer();
  }

  private startTimer(): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.dismiss();
    }, CARD_MS);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
