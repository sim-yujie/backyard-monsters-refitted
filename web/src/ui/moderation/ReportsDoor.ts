import { modReportsApi, type ModReportsApi } from "@/api/modReports";
import { make } from "@/ui/friends/rows";
import { ReportsWindow } from "./ReportsWindow";

/**
 * The moderators' way into Reports (owner, 12 Nov 2026): a button in the
 * More menu's fan (`data-dock="reports"`), the mock-up's monster with shield
 * and sword, with how many players have something open on its badge. Only a
 * moderator sees it: the server's `GET /mod/status` says who is one, read
 * when the yard opens and every two minutes while the game is in view.
 */

export interface ReportsDoorOptions {
  /** Where the window shows: the overlay's modal layer. */
  readonly container: HTMLElement;
  /** Before the window opens: the scene closes what else docks there. */
  readonly onOpen?: () => void;
  /** The routes, for a test. */
  readonly api?: ModReportsApi;
  /** How often the count is read again; 0 for never (a test). */
  readonly pollMs?: number;
}

export const REPORTS_DOOR_TEXT = {
  label: "Reports",
  title: "Reports: chat lines players reported and the word filter caught",
  picture: "/assets/popups/military.png",
} as const;

/** The badge caps here, so it stays one small disc. */
const BADGE_MAX = 99;

export const REPORTS_POLL_MS = 120_000;

export class ReportsDoor {
  readonly button: HTMLButtonElement;

  private readonly options: ReportsDoorOptions;
  private readonly api: ModReportsApi;
  private readonly badge: HTMLElement;
  private window: ReportsWindow | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(options: ReportsDoorOptions) {
    this.options = options;
    this.api = options.api ?? modReportsApi;
    this.button = make("button", "yard-dock__button yard-dock__button--reports");
    this.button.type = "button";
    this.button.dataset["dock"] = "reports";
    this.button.setAttribute("aria-label", REPORTS_DOOR_TEXT.label);
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.title = REPORTS_DOOR_TEXT.title;
    const disc = make("span", "yard-dock__disc");
    const picture = make("img", "yard-dock__picture");
    picture.src = REPORTS_DOOR_TEXT.picture;
    picture.alt = "";
    picture.decoding = "async";
    picture.draggable = false;
    this.badge = make("span", "yard-dock__badge reports-door__badge");
    this.badge.hidden = true;
    disc.append(picture, this.badge);
    this.button.append(disc, make("span", "yard-dock__label", REPORTS_DOOR_TEXT.label));
    this.button.addEventListener("click", () => this.toggle());
    this.button.hidden = true;

    void this.refresh();
    const pollMs = options.pollMs ?? REPORTS_POLL_MS;
    if (pollMs > 0) {
      this.timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void this.refresh();
      }, pollMs);
    }
  }

  get isOpen(): boolean {
    return this.window !== null;
  }

  /** Reads whether this player is a moderator and the open count. A failure leaves the button as it was. */
  async refresh(): Promise<void> {
    try {
      const status = await this.api.status();
      if (this.destroyed) return;
      this.button.hidden = !status.moderator;
      this.setCount(status.moderator ? status.open : 0);
      if (!status.moderator) this.close();
    } catch {
      // Not signed in yet, or the server is busy: try again on the next round.
    }
  }

  private setCount(count: number): void {
    this.badge.hidden = count <= 0;
    this.badge.textContent = count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
    this.button.setAttribute("aria-label", count > 0 ? `${REPORTS_DOOR_TEXT.label}: ${count} open` : REPORTS_DOOR_TEXT.label);
  }

  toggle(): void {
    if (this.window) this.close();
    else this.open();
  }

  open(): void {
    if (this.window || this.button.hidden) return;
    this.options.onOpen?.();
    this.window = new ReportsWindow({
      ...(this.options.api ? { api: this.options.api } : {}),
      onChanged: () => void this.refresh(),
      onClose: () => {
        this.window = null;
        this.button.setAttribute("aria-expanded", "false");
        void this.refresh();
      },
    }).mount(this.options.container);
    this.button.setAttribute("aria-expanded", "true");
  }

  close(): void {
    this.window?.close();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.close();
    this.button.remove();
  }
}
