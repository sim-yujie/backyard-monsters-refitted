import { Panel } from "./Panel";

/** "1:05", "0:09": the countdown's time left, rounded up to the second. */
export const countdownText = (msLeft: number): string => {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * The "Still there?" countdown before the idle disconnect (#271,
 * `game/presence/idleWatch.ts`).
 *
 * It dims the game but lets every pointer through: any input already cancels
 * it, so the move or tap that does lands where the player meant it rather than
 * on a scrim. The button is there for a keyboard or a screen reader; pressing
 * it is input like any other. It lives on the game's host, outside the
 * overlay's layers, so a screen change does not take it down.
 */
export class IdleWarning {
  private readonly element: HTMLElement;
  private readonly time: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disconnectAt = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly now: () => number = Date.now,
  ) {
    const panel = new Panel({
      title: "Still there?",
      closable: false,
      className: "idle-warning__panel",
    });
    this.time = document.createElement("strong");
    this.time.className = "idle-warning__time";
    const text = document.createElement("p");
    text.append(
      "You will be disconnected in ",
      this.time,
      " unless you move the mouse, tap or press a key.",
    );
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--primary";
    button.textContent = "I'm still here";
    const actions = document.createElement("div");
    actions.className = "idle-warning__actions";
    actions.append(button);
    panel.setContent(text, actions);
    panel.element.setAttribute("role", "alertdialog");

    this.element = document.createElement("div");
    this.element.className = "idle-warning";
    this.element.append(panel.element);
  }

  get shown(): boolean {
    return this.element.isConnected;
  }

  show(disconnectAt: number): void {
    this.disconnectAt = disconnectAt;
    this.render();
    if (!this.shown) this.host.append(this.element);
    this.timer ??= setInterval(() => this.render(), 250);
  }

  hide(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.element.remove();
  }

  private render(): void {
    this.time.textContent = countdownText(this.disconnectAt - this.now());
  }
}
