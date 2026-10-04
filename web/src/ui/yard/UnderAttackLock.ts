import { countdownText } from "../IdleWarning";

/** The banner's headline: the attacker by name when the server has said who. */
export const underAttackTitle = (by: string | null): string =>
  by ? `Your yard is under attack by ${by}!` : "Your yard is under attack!";

/** The line under it: how long the attack can run at most, or that it is ending. */
export const underAttackCountdown = (secondsLeft: number | null): string =>
  secondsLeft === null
    ? "Checking when it ends…"
    : secondsLeft > 0
      ? `It ends within ${countdownText(secondsLeft * 1000)}.`
      : "It is ending now.";

export interface UnderAttackLockOptions {
  /** Leaves for the map; the yard stays locked behind it. */
  readonly onMap?: () => void;
  /** Server unix seconds now; the countdown reads it. */
  readonly serverNow: () => number;
}

/**
 * The own yard while someone attacks it (#275, `game/presence/yardAttack.ts`).
 *
 * A scrim over the whole yard screen, its buttons and the yard itself, with a
 * banner naming the attacker: the server refuses every yard action until the
 * attack ends, so nothing is offered that would only be refused. The map
 * stays open to the player. When the attack ends the scene takes this down
 * and reloads the yard, damage and all; the report arrives in Mail.
 */
export class UnderAttackLock {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly countdown: HTMLElement;
  private ends: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: UnderAttackLockOptions) {
    this.element = document.createElement("div");
    this.element.className = "yard-attack-lock";

    const banner = document.createElement("section");
    banner.className = "yard-attack-lock__banner";
    banner.setAttribute("role", "alert");

    this.title = document.createElement("h2");
    this.title.className = "yard-attack-lock__title";
    const text = document.createElement("p");
    text.textContent =
      "Building, collecting and the other yard actions are paused until the attack ends. " +
      "Your yard will then reload to show what happened, and the report will be in your Mail.";
    this.countdown = document.createElement("p");
    this.countdown.className = "yard-attack-lock__countdown";
    banner.append(this.title, text, this.countdown);

    if (options.onMap) {
      const map = document.createElement("button");
      map.type = "button";
      map.className = "btn btn--ghost";
      map.textContent = "Open the map";
      map.addEventListener("click", () => options.onMap?.());
      const actions = document.createElement("div");
      actions.className = "yard-attack-lock__actions";
      actions.append(map);
      banner.append(actions);
    }
    this.element.append(banner);
  }

  get shown(): boolean {
    return this.element.parentElement !== null;
  }

  /** Shows it, or updates it: `by` null while the server has not said who. */
  show(host: HTMLElement, by: string | null, ends: number | null): void {
    this.title.textContent = underAttackTitle(by);
    this.ends = ends;
    this.render();
    if (!this.shown) host.append(this.element);
    this.timer ??= setInterval(() => this.render(), 500);
  }

  hide(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.element.remove();
  }

  private render(): void {
    const left = this.ends === null ? null : Math.ceil(this.ends - this.options.serverNow());
    this.countdown.textContent = underAttackCountdown(left);
  }
}
