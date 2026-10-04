import { countdownText } from "./IdleWarning";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import type { BotCheckView } from "@/game/presence/botCheckWatch";

/** The card's plain words. */
export const BOT_CHECK_TEXT = {
  title: "Quick check",
  why: "Until you answer, you count as away: other players can attack your yard. Everything else keeps working.",
  retry: "Not that one. Here is a new check.",
  failed: "Could not reach the server. Try again.",
} as const;

/** The line under the title while too many wrong answers wait out their time. */
export const botCheckWaitText = (msLeft: number): string =>
  msLeft > 0 ? `Too many wrong answers. The next check comes in ${countdownText(msLeft)}.` : "The next check is coming.";

/**
 * The in-game check's card (#273, `game/presence/botCheckWatch.ts`): "Quick
 * check: tap the Pokey" over a row of monster portraits, in the order the
 * server gave them.
 *
 * A card near the top of the screen, as the "Stay protected?" prompt is, and
 * in its place: it does not dim or block the game behind it, which keeps
 * working. It says plainly that the yard can be attacked until it is
 * answered. It lives on the game's host, so a screen change does not take it
 * down. The portraits carry no names, to a screen reader either: naming them
 * would answer the check.
 */
export class BotCheckCard {
  private readonly element: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly line: HTMLElement;
  private readonly options: HTMLElement;
  private view: BotCheckView | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly onChoose: (option: string) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {
    this.element = document.createElement("section");
    this.element.className = "bot-check";
    this.element.setAttribute("role", "alertdialog");
    this.element.setAttribute("aria-label", BOT_CHECK_TEXT.title);

    const title = document.createElement("strong");
    title.className = "bot-check__title";
    title.textContent = BOT_CHECK_TEXT.title;
    this.prompt = document.createElement("span");
    this.prompt.className = "bot-check__prompt";
    const heading = document.createElement("p");
    heading.className = "bot-check__heading";
    heading.append(title, this.prompt);

    const why = document.createElement("p");
    why.className = "bot-check__why";
    why.textContent = BOT_CHECK_TEXT.why;

    this.options = document.createElement("div");
    this.options.className = "bot-check__options";
    this.line = document.createElement("p");
    this.line.className = "bot-check__line";
    this.line.setAttribute("aria-live", "polite");

    this.element.append(heading, why, this.options, this.line);
  }

  get shown(): boolean {
    return this.element.isConnected;
  }

  show(view: BotCheckView): void {
    const same =
      this.view?.kind === "challenge" && view.kind === "challenge" && this.view.challenge.id === view.challenge.id;
    this.view = view;
    if (!same) this.render();
    if (!this.shown) this.host.append(this.element);
    if (view.kind === "wait") this.timer ??= setInterval(() => this.tick(), 250);
    else this.stopTimer();
  }

  hide(): void {
    this.stopTimer();
    this.view = null;
    this.element.remove();
  }

  private render(): void {
    const view = this.view;
    if (view === null) return;
    this.sending = false;
    this.element.classList.toggle("bot-check--wait", view.kind === "wait");
    if (view.kind === "wait") {
      this.prompt.textContent = "";
      this.options.replaceChildren();
      this.tick();
      return;
    }
    this.prompt.textContent = `: ${view.challenge.prompt.charAt(0).toLowerCase()}${view.challenge.prompt.slice(1)}`;
    this.line.textContent = view.retry ? BOT_CHECK_TEXT.retry : "";
    this.options.replaceChildren(
      ...view.challenge.options.map((option, i) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bot-check__option";
        button.setAttribute("aria-label", `Monster ${i + 1}`);
        const picture = document.createElement("img");
        picture.className = "bot-check__picture";
        picture.alt = "";
        picture.draggable = false;
        showPortrait(picture, monsterPortrait(option.monster, "icon"));
        button.append(picture);
        button.addEventListener("click", () => void this.choose(option.id));
        return button;
      }),
    );
  }

  private async choose(option: string): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    this.setDisabled(true);
    try {
      // The watch shows what comes next: solved, a new check, or the wait.
      await this.onChoose(option);
      // Nothing new came (the tap was not sent): the same options again.
      if (this.sending) {
        this.sending = false;
        this.setDisabled(false);
      }
    } catch {
      this.line.textContent = BOT_CHECK_TEXT.failed;
      this.sending = false;
      this.setDisabled(false);
    }
  }

  private setDisabled(disabled: boolean): void {
    for (const button of this.options.querySelectorAll("button")) button.disabled = disabled;
  }

  private tick(): void {
    if (this.view?.kind === "wait") this.line.textContent = botCheckWaitText(this.view.until - this.now());
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
