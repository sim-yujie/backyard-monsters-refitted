import { gameIcon } from "./gameIcon";

/**
 * The small "New version" card (`app/updateCheck.ts`): the painted level-up
 * arrow, two words and a Reload button, per the owner's "icons over words".
 *
 * A card, not a dialog: nothing behind it is dimmed or blocked, so a player
 * mid-attack can finish first. The × hides it until the page is reloaded.
 * It lives on the game's host, as the idle countdown does, so a screen change
 * does not take it down.
 *
 * Shown for an attack the server refused for its older battle rules
 * (`api/rulesStamp.ts`, 23 Nov 2026), it adds one small line under the title,
 * "Reload to attack", so the player knows why nothing started.
 */
export class UpdatePrompt {
  private readonly element: HTMLElement;
  private readonly note: HTMLElement;

  constructor(
    private readonly host: HTMLElement,
    reload: () => void = () => window.location.reload(),
  ) {
    this.element = document.createElement("section");
    this.element.className = "update-prompt";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-label", "A new version of the game is ready");

    const icon = gameIcon("levelup", {
      size: 32,
      decorative: true,
      className: "update-prompt__icon",
    });
    const title = document.createElement("strong");
    title.className = "update-prompt__title";
    title.textContent = "New version";
    this.note = document.createElement("span");
    this.note.className = "update-prompt__note";
    this.note.textContent = "Reload to attack";
    this.note.hidden = true;
    const words = document.createElement("span");
    words.className = "update-prompt__words";
    words.append(title, this.note);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--primary update-prompt__reload";
    button.textContent = "Reload";
    button.addEventListener("click", () => reload());

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon update-prompt__close";
    close.setAttribute("aria-label", "Later");
    close.title = "Later";
    close.textContent = "×";
    close.addEventListener("click", () => this.hide());

    this.element.append(icon, words, button, close);
  }

  get shown(): boolean {
    return this.element.isConnected;
  }

  /** @param why - `"attack"` when it answers a refused attack start: adds "Reload to attack". */
  show(why?: "attack"): void {
    if (why === "attack") this.note.hidden = false;
    if (!this.shown) this.host.append(this.element);
  }

  hide(): void {
    this.element.remove();
  }
}
