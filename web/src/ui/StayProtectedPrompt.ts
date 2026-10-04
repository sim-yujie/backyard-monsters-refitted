import { countdownText } from "./IdleWarning";

/** What the prompt says, and whether its countdown still runs. */
export const stayProtectedText = (msLeft: number): { readonly line: string; readonly over: boolean } =>
  msLeft > 0
    ? { line: `Other players can attack your yard in ${countdownText(msLeft)}.`, over: false }
    : { line: "Other players can attack your yard now.", over: true };

/**
 * The small "Stay protected?" prompt (#275, `game/presence/protectionWatch.ts`).
 *
 * A card at the bottom of the screen, not a dialog: nothing behind it is
 * dimmed or blocked, and only its button does anything. The button tells the
 * server the player is there, which is a real game action and keeps them
 * safe from attack for ten more minutes. It lives on the game's host, as the
 * idle countdown does, so a screen change does not take it down.
 */
export class StayProtectedPrompt {
  private readonly element: HTMLElement;
  private readonly line: HTMLElement;
  private readonly button: HTMLButtonElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private endsAt = 0;
  /** The last tap failed: its line stays until the next. */
  private failed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly onStay: () => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {
    this.element = document.createElement("section");
    this.element.className = "stay-protected";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-label", "Stay protected?");

    const title = document.createElement("strong");
    title.className = "stay-protected__title";
    title.textContent = "Stay protected?";
    this.line = document.createElement("p");
    this.line.className = "stay-protected__line";
    const text = document.createElement("div");
    text.className = "stay-protected__text";
    text.append(title, this.line);

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "btn btn--primary stay-protected__button";
    this.button.textContent = "Stay protected";
    this.button.addEventListener("click", () => void this.stay());

    this.element.append(text, this.button);
  }

  get shown(): boolean {
    return this.element.isConnected;
  }

  /** Shows it, counting down to `endsAt` (a {@link now} time). */
  show(endsAt: number): void {
    this.endsAt = endsAt;
    this.button.disabled = false;
    this.failed = false;
    this.render();
    if (!this.shown) this.host.append(this.element);
    this.timer ??= setInterval(() => this.render(), 250);
  }

  hide(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.element.remove();
  }

  private async stay(): Promise<void> {
    if (this.button.disabled) return;
    this.button.disabled = true;
    this.failed = false;
    try {
      // A success takes the prompt down through the watch.
      await this.onStay();
    } catch {
      this.failed = true;
      this.line.textContent = "Could not reach the server. Try again.";
      this.button.disabled = false;
    }
  }

  private render(): void {
    if (this.button.disabled || this.failed) return;
    const { line, over } = stayProtectedText(this.endsAt - this.now());
    this.line.textContent = line;
    this.element.classList.toggle("stay-protected--over", over);
  }
}
