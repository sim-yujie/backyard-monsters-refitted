import { backAtWords, type MaintenanceNotice, type MaintenanceRefusal } from "@/api/maintenance";
import { gameIcon } from "./gameIcon";

/**
 * The sign-in screen's maintenance card (owner, 22 Nov 2026), above the
 * sign-in panel so the form below still works (the owner signs in through
 * it): the hammer and wrench, "Maintenance", the owner's message, the
 * back-at time in the player's own time, and Try again.
 *
 * Try again asks the server (`check`): still on, the card shakes and says
 * "Still down" for a moment; over, it says "Back online!" and the screen
 * carries on (`onOver`: back into the game with the saved session, or the
 * form).
 */

export interface MaintenanceCardOptions {
  /** Asks the server; null when it could not be reached. */
  readonly check: () => Promise<MaintenanceNotice | null>;
  /** Maintenance is over. */
  readonly onOver: () => void;
  /** Still on: the newest words. */
  readonly onStill: (refusal: MaintenanceRefusal) => void;
}

/** How long "Still down" (or "No connection") stays on the button. */
export const FEEDBACK_MS = 3_000;

export class MaintenanceCard {
  readonly element: HTMLElement;
  private readonly message: HTMLElement;
  private readonly out: HTMLElement;
  private readonly back: HTMLElement;
  private readonly backText: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly status: HTMLElement;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    refusal: MaintenanceRefusal,
    private readonly options: MaintenanceCardOptions,
  ) {
    this.element = document.createElement("section");
    this.element.className = "maint-card";
    this.element.setAttribute("aria-labelledby", "maint-card-title");

    const head = document.createElement("div");
    head.className = "maint-card__head";
    const title = document.createElement("h2");
    title.className = "maint-card__title";
    title.id = "maint-card-title";
    title.textContent = "Maintenance";
    head.append(gameIcon("tools", { size: 32, decorative: true, className: "maint-card__icon" }), title);
    // After the countdown: why the player is here, so it is not read as a crash.
    this.out = document.createElement("span");
    this.out.className = "maint-card__out";
    this.out.textContent = "Signed out";
    head.append(this.out);

    this.message = document.createElement("p");
    this.message.className = "maint-card__message";

    this.back = document.createElement("p");
    this.back.className = "maint-card__back";
    this.backText = document.createElement("span");
    this.back.append(gameIcon("time", { size: 24, label: "Back at", className: "maint-card__back-icon" }), this.backText);

    this.retry = document.createElement("button");
    this.retry.type = "button";
    this.retry.className = "btn btn--primary maint-card__retry";
    this.retry.textContent = "Try again";
    this.retry.addEventListener("click", () => void this.tryAgain());

    this.status = document.createElement("p");
    this.status.className = "u-visually-hidden";
    this.status.setAttribute("role", "status");

    this.element.append(head, this.message, this.back, this.retry, this.status);
    this.update(refusal);
  }

  update(refusal: MaintenanceRefusal): void {
    this.message.textContent = refusal.message;
    this.out.hidden = refusal.signedOut !== true;
    const back = backAtWords(refusal.backAt);
    this.backText.textContent = back ? `Back ${back}` : "";
    this.back.hidden = back === null;
  }

  /** Draws the eye to the card: a refused Play. */
  nudge(): void {
    this.element.classList.remove("maint-card--shake");
    void this.element.offsetWidth;
    this.element.classList.add("maint-card--shake");
  }

  remove(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = null;
    this.element.remove();
  }

  private async tryAgain(): Promise<void> {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.retry.disabled = true;
    this.retry.textContent = "Checking…";
    let notice: MaintenanceNotice | null = null;
    try {
      notice = await this.options.check();
    } catch {
      notice = null;
    }
    if (notice && !notice.on) {
      this.retry.textContent = "Back online!";
      this.status.textContent = "Back online!";
      this.element.classList.add("maint-card--over");
      this.options.onOver();
      return;
    }
    if (notice) this.options.onStill({ message: notice.message, backAt: notice.backAt });
    const words = notice ? "Still down" : "No connection";
    this.retry.textContent = words;
    this.status.textContent = words;
    this.nudge();
    this.feedbackTimer = setTimeout(() => {
      this.feedbackTimer = null;
      this.retry.disabled = false;
      this.retry.textContent = "Try again";
      this.element.classList.remove("maint-card--shake");
    }, FEEDBACK_MS);
  }
}
