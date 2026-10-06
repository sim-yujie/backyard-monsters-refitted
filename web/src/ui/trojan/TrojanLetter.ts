import { ACCEPT_TRUCE, SEND_BACK, TROJAN_HEADLINE, trojanLetterText } from "@/game/trojan/trojanText";
import { Popup } from "@/ui/Popup";
import "./trojanLetter.css";

/**
 * The Trojan Horse's letter popup (issue #327 WP4, `docs/design/trojan-horse.md`
 * §3.3): clicking the horse in build mode opens this. The Flash popup's art
 * was never extracted, so this is a new popup in our own style, Flash's words
 * (`english.json`'s `ai_trojan_*`) kept.
 *
 * Both buttons spring the trap — the joke the design keeps (§9) — and there
 * is no close button, as Flash's letter had none wired. Either button is
 * disabled, with the other, the moment it is pressed, so a second click (or
 * a click on both before the first answers) can never ask the server twice.
 */
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export interface TrojanLetterActions {
  /** Either button: springs the trap. */
  readonly onAnswer: () => void;
}

export class TrojanLetter {
  readonly popup: Popup;
  private readonly sendBack: HTMLButtonElement;
  private readonly acceptTruce: HTMLButtonElement;

  constructor(playerName: string, actions: TrojanLetterActions) {
    this.popup = new Popup({ title: TROJAN_HEADLINE, className: "trojan-letter", dismissable: false });

    const letter = element("p", "trojan-letter__body", trojanLetterText(playerName || "Monster Tamer"));

    const answer = (): void => {
      this.sendBack.disabled = true;
      this.acceptTruce.disabled = true;
      actions.onAnswer();
    };
    const button = (label: string, className: string): HTMLButtonElement => {
      const node = element("button", className, label);
      node.type = "button";
      node.addEventListener("click", answer);
      return node;
    };
    this.sendBack = button(SEND_BACK, "btn btn--ghost trojan-letter__send-back");
    this.acceptTruce = button(ACCEPT_TRUCE, "btn btn--primary trojan-letter__accept-truce");

    const actionsRow = element("div", "trojan-letter__actions");
    actionsRow.append(this.sendBack, this.acceptTruce);

    this.popup.setContent(letter, actionsRow);
  }

  mount(host: HTMLElement): this {
    this.popup.mount(host);
    return this;
  }

  close(): void {
    this.popup.close();
  }
}
