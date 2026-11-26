import { backAtWords, countdownWords } from "@/api/maintenance";
import { gameIcon } from "./gameIcon";

/**
 * The maintenance countdown in the game (owner, 22 Nov 2026;
 * `app/maintenanceWatch.ts`): a card centred under the resource bar, as the
 * "New version" card is, on every screen (yard, map, attack). It lives on the
 * game's host, so a screen change does not take it down.
 *
 * - Before the last minute: the hammer and wrench, the time left ("4:59"),
 *   the owner's message and the back-at time in the player's own time. It
 *   can be folded to a small pill (and is, after a few seconds, on a narrow
 *   screen), tapped to open again.
 * - The last minute: open and locked, red, "Signing out".
 * - The owner past zero: "Maintenance on", as only he is still in.
 *
 * A screen reader hears the card when it appears and at the last minute,
 * not every second.
 */

export interface MaintenanceBannerView {
  readonly message: string;
  readonly backAt: string | null;
  /** Time left; 0 or less once the cut-off passed (only the owner sees that). */
  readonly remainingMs: number;
  readonly exempt: boolean;
}

/** The last minute: open, red, no fold. */
export const FINAL_MS = 60_000;

/** Narrow screens fold the card after this long, until the last minute. */
export const NARROW_FOLD_MS = 6_000;

/** Phones (either way up): the card covers HUD buttons there, so it folds after a few seconds. */
const NARROW = "(max-width: 599px), (max-height: 500px)";

export class MaintenanceBanner {
  readonly element: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly back: HTMLElement;
  private readonly backText: HTMLElement;
  private readonly fold: HTMLButtonElement;
  private readonly pill: HTMLButtonElement;
  private readonly pillClock: HTMLElement;
  private readonly spoken: HTMLElement;
  private folded = false;
  /** The player folded or opened it themselves: no automatic fold after. */
  private chosen = false;
  private foldTimer: ReturnType<typeof setTimeout> | null = null;
  private stage: "countdown" | "final" | "on" | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly narrow: () => boolean = () =>
      typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches,
  ) {
    this.element = document.createElement("section");
    this.element.className = "maint-banner";
    this.element.setAttribute("aria-label", "Maintenance");

    const card = document.createElement("div");
    card.className = "maint-banner__card";

    const icon = gameIcon("tools", { size: 32, decorative: true, className: "maint-banner__icon" });

    const text = document.createElement("div");
    text.className = "maint-banner__text";
    const head = document.createElement("div");
    head.className = "maint-banner__head";
    this.clock = document.createElement("strong");
    this.clock.className = "maint-banner__clock";
    this.clock.setAttribute("role", "timer");
    this.title = document.createElement("span");
    this.title.className = "maint-banner__title";
    // The owner is never signed out: his card says so beside the title.
    const stay = document.createElement("span");
    stay.className = "maint-banner__stay";
    stay.textContent = "You stay in";
    head.append(this.clock, this.title, stay);

    this.message = document.createElement("p");
    this.message.className = "maint-banner__message";

    this.back = document.createElement("p");
    this.back.className = "maint-banner__back";
    this.backText = document.createElement("span");
    this.back.append(gameIcon("time", { size: 16, label: "Back at", className: "maint-banner__back-icon" }), this.backText);

    text.append(head, this.message, this.back);

    this.fold = document.createElement("button");
    this.fold.type = "button";
    this.fold.className = "btn btn--ghost btn--icon maint-banner__fold";
    this.fold.setAttribute("aria-label", "Fold");
    this.fold.title = "Fold";
    this.fold.textContent = "⌃";
    this.fold.addEventListener("click", () => {
      this.chosen = true;
      this.setFolded(true);
    });

    card.append(icon, text, this.fold);

    this.pill = document.createElement("button");
    this.pill.type = "button";
    this.pill.className = "maint-banner__pill";
    this.pill.setAttribute("aria-label", "Maintenance: show details");
    this.pillClock = document.createElement("strong");
    this.pillClock.className = "maint-banner__clock";
    const open = document.createElement("span");
    open.className = "maint-banner__chevron";
    open.setAttribute("aria-hidden", "true");
    open.textContent = "▾";
    this.pill.append(gameIcon("tools", { size: 24, decorative: true }), this.pillClock, open);
    this.pill.addEventListener("click", () => {
      this.chosen = true;
      this.setFolded(false);
    });

    this.spoken = document.createElement("p");
    this.spoken.className = "u-visually-hidden";
    this.spoken.setAttribute("role", "status");

    this.element.append(card, this.pill, this.spoken);
  }

  get shown(): boolean {
    return this.element.isConnected;
  }

  get isFolded(): boolean {
    return this.folded;
  }

  /** Shows (or updates) the card; called on news and on every tick. */
  show(view: MaintenanceBannerView): void {
    const stage = view.remainingMs > 0 ? (view.remainingMs <= FINAL_MS ? "final" : "countdown") : "on";
    const clock = stage === "on" ? "" : countdownWords(view.remainingMs);
    this.clock.textContent = clock;
    this.pillClock.textContent = stage === "on" ? "On" : clock;
    this.title.textContent =
      stage === "final" ? "Maintenance: signing out" : stage === "on" ? "Maintenance on" : "Maintenance";
    this.element.classList.toggle("maint-banner--exempt", view.exempt);
    this.message.textContent = stage === "on" && view.exempt ? "Players are out. Only you can play." : view.message;
    const back = backAtWords(view.backAt);
    this.backText.textContent = back ? `Back ${back}` : "";
    this.back.hidden = back === null;

    if (stage !== this.stage) {
      const first = this.stage === null;
      this.stage = stage;
      this.element.classList.toggle("maint-banner--final", stage === "final");
      this.element.classList.toggle("maint-banner--on", stage === "on");
      this.fold.hidden = stage === "final";
      if (stage === "final") this.setFolded(false);
      this.spoken.textContent =
        stage === "final"
          ? view.exempt
            ? "Players are signed out in under a minute."
            : "Maintenance: signing out in under a minute."
          : stage === "on"
            ? "Maintenance is on."
            : `Maintenance in ${clock}. ${view.message}`;
      if (first && stage === "countdown" && this.narrow()) this.foldLater();
    }

    if (!this.shown) this.host.append(this.element);
  }

  hide(): void {
    if (this.foldTimer) clearTimeout(this.foldTimer);
    this.foldTimer = null;
    this.element.remove();
    this.stage = null;
    this.chosen = false;
    this.setFolded(false);
  }

  private foldLater(): void {
    if (this.foldTimer) clearTimeout(this.foldTimer);
    this.foldTimer = setTimeout(() => {
      this.foldTimer = null;
      if (!this.chosen && this.stage === "countdown") this.setFolded(true);
    }, NARROW_FOLD_MS);
  }

  private setFolded(folded: boolean): void {
    this.folded = folded;
    this.element.classList.toggle("maint-banner--folded", folded);
  }
}
