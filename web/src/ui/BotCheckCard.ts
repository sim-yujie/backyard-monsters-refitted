import { countdownText } from "./IdleWarning";
import { BOT_CHECK_ANSWER_MAX } from "@/api/botCheck";
import type { BotCheckView } from "@/game/presence/botCheckWatch";

/** The card's plain words. */
export const BOT_CHECK_TEXT = {
  title: "Quick check",
  why: "Until you answer, you count as away: other players can attack your yard. Everything else keeps working.",
  retry: "Not quite. Here is a new picture.",
  failed: "Could not reach the server. Try again.",
} as const;

/** The line under the title while too many wrong answers wait out their time. */
export const botCheckWaitText = (msLeft: number): string =>
  msLeft > 0 ? `Too many wrong answers. The next check comes in ${countdownText(msLeft)}.` : "The next check is coming.";

/**
 * The in-game check's card (#273, `game/presence/botCheckWatch.ts`): "How
 * many of these are in the picture?" beside the monster's portrait and name,
 * over a picture of the yard the server drew, with a button for each number
 * from 1 to 9.
 *
 * A card near the top of the screen, as the "Stay protected?" prompt is, and
 * in its place: it does not dim or block the game behind it, which keeps
 * working. It says plainly that the yard can be attacked until it is
 * answered. It lives on the game's host, so a screen change does not take it
 * down.
 *
 * Known gap: the picture has no text alternative, so the check cannot be
 * answered with a screen reader. Describing it would answer it.
 */
export class BotCheckCard {
  private readonly element: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly reference: HTMLImageElement;
  private readonly name: HTMLElement;
  private readonly picture: HTMLImageElement;
  private readonly line: HTMLElement;
  private readonly numbers: HTMLButtonElement[];
  private view: BotCheckView | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly onChoose: (option: string) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {
    this.element = document.createElement("section");
    this.element.className = "presence-check";
    this.element.setAttribute("role", "alertdialog");
    this.element.setAttribute("aria-label", BOT_CHECK_TEXT.title);

    const title = document.createElement("strong");
    title.className = "presence-check__title";
    title.textContent = BOT_CHECK_TEXT.title;

    this.reference = document.createElement("img");
    this.reference.className = "presence-check__reference";
    this.reference.alt = "";
    this.reference.draggable = false;
    this.name = document.createElement("span");
    this.name.className = "presence-check__name";
    const target = document.createElement("figure");
    target.className = "presence-check__target";
    target.append(this.reference, this.name);
    this.prompt = document.createElement("p");
    this.prompt.className = "presence-check__prompt";
    const why = document.createElement("p");
    why.className = "presence-check__why";
    why.textContent = BOT_CHECK_TEXT.why;
    const words = document.createElement("div");
    words.className = "presence-check__words";
    words.append(this.prompt, why);
    const question = document.createElement("div");
    question.className = "presence-check__question";
    question.append(target, words);

    this.picture = document.createElement("img");
    this.picture.className = "presence-check__picture";
    this.picture.alt = "";
    this.picture.draggable = false;

    const numbers = document.createElement("div");
    numbers.className = "presence-check__numbers";
    this.numbers = Array.from({ length: BOT_CHECK_ANSWER_MAX }, (_, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn presence-check__number";
      button.textContent = String(i + 1);
      button.addEventListener("click", () => void this.choose(String(i + 1)));
      return button;
    });
    numbers.append(...this.numbers);

    this.line = document.createElement("p");
    this.line.className = "presence-check__line";
    this.line.setAttribute("aria-live", "polite");

    this.element.append(title, question, this.picture, numbers, this.line);
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
    this.setDisabled(false);
    this.element.classList.toggle("presence-check--wait", view.kind === "wait");
    if (view.kind === "wait") {
      this.picture.removeAttribute("src");
      this.reference.removeAttribute("src");
      this.tick();
      return;
    }
    const { challenge } = view;
    this.prompt.textContent = challenge.prompt;
    this.name.textContent = challenge.name;
    this.reference.src = challenge.reference;
    this.picture.src = challenge.picture;
    this.line.textContent = view.retry ? BOT_CHECK_TEXT.retry : "";
  }

  private async choose(option: string): Promise<void> {
    if (this.sending || this.view?.kind !== "challenge") return;
    this.sending = true;
    this.setDisabled(true);
    try {
      // The watch shows what comes next: solved, a new picture, or the wait.
      await this.onChoose(option);
      // Nothing new came (the tap was not sent): the same picture again.
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
    for (const button of this.numbers) button.disabled = disabled;
  }

  private tick(): void {
    if (this.view?.kind === "wait") this.line.textContent = botCheckWaitText(this.view.until - this.now());
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
