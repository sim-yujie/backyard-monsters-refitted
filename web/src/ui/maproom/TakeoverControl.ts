import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { TakeoverPayment } from "@/api/maproom";
import type { MapCell, TakeoverQuoteResponse } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import {
  TAKEOVER_TEXT,
  clockSkew,
  grantCountdownText,
  quoteKey,
  takeoverActionView,
  takeoverCandidate,
  type TakeoverCandidate,
  type TakeoverQuoteState,
} from "@/game/maproom/takeover";
import { el, icon } from "@/ui/maproom1/icons";
import { TakeoverDialog } from "./TakeoverDialog";

/**
 * The map cell panel's Take over action (issue #82): a button that sits
 * beside Attack, and a line under the actions with the price or the reason
 * it cannot be taken, plus the countdown on a player outpost's one chance.
 *
 * It asks the server (`POST /worldmapv2/takeoverquote`) whenever the cell,
 * or what the map says about its damage, protection or lock, changes, and
 * shows only what the answer says. Asking again when a grant's countdown
 * runs out is the only thing its clock does. Self-contained, so the cell
 * panel's layout can change around it.
 */

export interface TakeoverControlOptions {
  /** `getTakeoverQuote`. */
  readonly quote: (baseid: string) => Promise<TakeoverQuoteResponse>;
  /** `takeOverCell`; rejects with the server's refusal. */
  readonly takeOver: (baseid: string, payment: TakeoverPayment) => Promise<unknown>;
  /** The cell is the player's now. */
  readonly onTaken: (
    cell: OffsetCell,
    candidate: TakeoverCandidate,
    quote: TakeoverQuoteResponse,
    payment: TakeoverPayment,
  ) => void;
  /** Where the dialog opens: the overlay's modal layer. */
  readonly modal: () => HTMLElement | null;
  /** Local seconds; `Date.now` by default. */
  readonly now?: () => number;
  /**
   * `declinetakeover`: "Not now" in the dialog while the caller holds a player
   * outpost's single chance (#187). Absent: the dialog offers no Not now.
   */
  readonly decline?: (baseid: string) => Promise<{ protectedUntil?: number }>;
  /** The chance was turned down; the control has asked the server again. */
  readonly onDeclined?: (cell: OffsetCell, protectedUntil: number | undefined) => void;
}

export class TakeoverControl {
  /** Goes beside Attack. */
  readonly button: HTMLButtonElement;
  /** Goes under the actions: the price or the reason. */
  readonly detail: HTMLElement;
  /**
   * Goes with the cell panel's chips: the countdown on a player outpost's
   * single chance, "Offer ends in 4m 50s" (#187, from the #82 test, where it
   * showed only inside the dialog).
   */
  readonly chip: HTMLElement;

  private readonly options: TakeoverControlOptions;
  private readonly note: HTMLElement;
  private readonly countdown: HTMLElement;

  private cell: OffsetCell | null = null;
  private candidate: TakeoverCandidate | null = null;
  private key: string | null = null;
  private state: TakeoverQuoteState = { status: "loading" };
  /** Server seconds minus local seconds, from the last quote. */
  private skew = 0;
  /** Bumped per request, so a slow answer for an old cell is dropped. */
  private request = 0;
  /** The grant end already asked about again, so it is asked once. */
  private requotedAt: number | null = null;
  private dialog: TakeoverDialog | null = null;

  constructor(options: TakeoverControlOptions) {
    this.options = options;

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "btn btn--primary takeover-action__button";
    tutTarget(this.button, TutTarget.MR2_TAKEOVER);
    this.button.textContent = TAKEOVER_TEXT.button;
    this.button.addEventListener("click", () => this.open());

    this.note = document.createElement("span");
    this.note.className = "takeover-action__note";
    this.countdown = el("span", "takeover-action__countdown");
    this.countdown.setAttribute("role", "timer");
    this.chip = el("span", "mr2-chip mr2-chip--warning takeover-action__chip");
    this.chip.title = "Your one chance to take this outpost over. After it, the outpost is protected.";
    this.chip.append(icon("clock", 16, "map-icon"), this.countdown);

    this.detail = document.createElement("p");
    this.detail.className = "takeover-action";
    this.detail.append(this.note);

    this.render();
  }

  /**
   * The cell the panel shows. Asks the server again only when the cell or
   * the parts of its payload a takeover depends on have changed.
   */
  setCell(cell: OffsetCell, payload: MapCell | undefined): void {
    const key = quoteKey(payload);
    const sameCell = this.cell?.col === cell.col && this.cell?.row === cell.row;
    this.cell = cell;
    if (sameCell && key === this.key) return;
    this.key = key;
    this.candidate = takeoverCandidate(payload);
    this.requotedAt = null;
    if (this.candidate) void this.fetch();
    else this.request += 1;
    this.render();
  }

  /** Asks the server again for the shown cell. */
  refresh(): void {
    if (this.candidate) void this.fetch();
  }

  /** Once a second: the countdown, and one fresh quote when a grant runs out. */
  tick(): void {
    const expiresAt = this.expiresAt();
    if (expiresAt === undefined) return;
    const serverNow = this.localNow() + this.skew;
    this.countdown.textContent = grantCountdownText(expiresAt, serverNow);
    if (serverNow >= expiresAt && this.requotedAt !== expiresAt) {
      this.requotedAt = expiresAt;
      this.refresh();
    }
  }

  destroy(): void {
    this.request += 1;
    this.dialog?.close();
    this.dialog = null;
    this.button.remove();
    this.detail.remove();
    this.chip.remove();
  }

  /** What is shown, for the tests. */
  get view(): TakeoverQuoteState {
    return this.state;
  }

  private async fetch(): Promise<void> {
    const candidate = this.candidate;
    if (!candidate) return;
    const request = ++this.request;
    this.state = { status: "loading" };
    this.render();
    try {
      const quote = await this.options.quote(candidate.baseid);
      if (request !== this.request) return;
      this.skew = clockSkew(quote.now, this.localNow());
      this.state = { status: "quoted", quote };
    } catch {
      if (request !== this.request) return;
      this.state = { status: "failed" };
    }
    this.render();
  }

  private render(): void {
    const candidate = this.candidate;
    const view = candidate ? takeoverActionView(candidate.kind, this.state) : null;
    const visible = view?.visible ?? false;
    this.button.hidden = !visible;
    this.detail.hidden = !visible;
    this.chip.hidden = !visible || view?.expiresAt === undefined;
    if (!view || !visible) return;
    this.button.disabled = !view.enabled;
    this.button.title = view.note;
    this.button.setAttribute("aria-label", `${TAKEOVER_TEXT.button}. ${view.note}`);
    this.note.textContent = view.enabled ? `${TAKEOVER_TEXT.button}: ${view.note}` : view.note;
    this.detail.classList.toggle("takeover-action--refused", !view.enabled);
    this.tick();
  }

  private expiresAt(): number | undefined {
    return this.state.status === "quoted" ? this.state.quote.grantExpiresAt : undefined;
  }

  private open(): void {
    const { candidate, cell } = this;
    const modal = this.options.modal();
    if (!candidate || !cell || !modal || this.state.status !== "quoted" || !this.state.quote.eligible) return;
    const quote = this.state.quote;
    this.dialog?.close();
    const decline = this.options.decline;
    this.dialog = new TakeoverDialog({
      kind: candidate.kind,
      name: candidate.name,
      price: quote,
      takeOver: (payment) => this.options.takeOver(candidate.baseid, payment),
      onTaken: (payment) => {
        this.dialog = null;
        this.options.onTaken(cell, candidate, quote, payment);
      },
      serverNow: () => this.localNow() + this.skew,
      ...(decline && quote.grantExpiresAt !== undefined
        ? {
            decline: () => decline(candidate.baseid),
            onDeclined: (protectedUntil: number | undefined) => {
              this.dialog = null;
              this.refresh();
              this.options.onDeclined?.(cell, protectedUntil);
            },
          }
        : {}),
    }).mount(modal);
  }

  private localNow(): number {
    return (this.options.now ?? (() => Date.now() / 1000))();
  }
}
