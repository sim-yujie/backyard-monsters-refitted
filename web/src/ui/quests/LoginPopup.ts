import type { QuestsView } from "@/api/quests";
import { showPortrait } from "@/game/portraits";
import { Popup } from "@/ui/Popup";
import { el } from "./dom";
import { loginCard, type LoginCardOptions } from "./loginCard";
import "./quests.css";

/**
 * The login card's pop-up (owner decision 9): on the first yard load of the
 * UTC day, once the other pop-ups are done, the 7-day card shows by itself
 * with its Claim. "All quests" opens the Quests window. The scrim does not
 * close it, so a stray tap on a phone does not skip it.
 */

const POPUP_CLASS = "quests-login-popup";

export const isLoginPopupOpen = (): boolean => document.querySelector(`.${POPUP_CLASS}`) !== null;

export interface LoginPopupOptions {
  readonly container: HTMLElement;
  onClaim(): void;
  onMore(): void;
  onClose(): void;
}

export interface LoginPopupView {
  readonly quests: QuestsView;
  readonly now: number;
  readonly busy: string | null;
  readonly refusal: LoginCardOptions["refusal"];
}

export class LoginPopup {
  private readonly popup: Popup;
  private readonly options: LoginPopupOptions;

  constructor(options: LoginPopupOptions, view: LoginPopupView) {
    this.options = options;
    this.popup = new Popup({
      title: "Daily login",
      className: POPUP_CLASS,
      closeOnBackdrop: false,
      onClose: () => options.onClose(),
    });
    this.render(view);
    this.popup.mount(options.container);
    // The window takes the keyboard, not Claim: an Enter or Space meant for
    // something else (sending a chat line, closing another window) must not
    // claim the day unseen (owner, 13 Nov 2026). Tab still reaches Claim.
    this.popup.element.tabIndex = -1;
    this.popup.element.focus({ preventScroll: true });
  }

  get element(): HTMLElement {
    return this.popup.element;
  }

  render(view: LoginPopupView): void {
    const hero = el("div", "quests-login-popup__hero");
    const picture = el("img", "quests-login-popup__picture");
    picture.alt = "";
    showPortrait(picture, { src: "/assets/popups/completequest.png", fallback: null });
    const claimed = view.quests.login.claimedToday;
    hero.append(
      picture,
      el(
        "p",
        "quests-login-popup__text",
        claimed
          ? "Today's Shiny is yours. Come back tomorrow for the next day."
          : "Log in each day for free Shiny. A missed day pauses the card, it never resets.",
      ),
    );
    const card = loginCard({
      login: view.quests.login,
      nextDayAt: view.quests.nextDayAt,
      now: view.now,
      busy: view.busy,
      refusal: view.refusal,
      onClaim: () => this.options.onClaim(),
    });
    // The card's own title says the same as the pop-up's.
    card.querySelector(".quests-section__title")?.remove();
    const more = el("button", "btn btn--ghost quests-login-popup__more", "All quests");
    more.type = "button";
    more.addEventListener("click", () => this.options.onMore());
    this.popup.setContent(hero, card, more);
  }

  close(): void {
    this.popup.close();
  }
}
