import type { TakeoverPayment } from "@/api/maproom";
import type { TakeoverGrantOffer, TakeoverQuoteResponse } from "@/api/types";
import {
  TAKEOVER_TEXT,
  clockSkew,
  grantCountdownText,
  priceText,
  refusalText,
  type TakeoverKind,
} from "@/game/maproom/takeover";
import { formatSpan } from "@/ui/attack/EndAttackPanel";
import { TakeoverDialog, type TakeoverDialogPrice } from "@/ui/maproom/TakeoverDialog";

/**
 * The takeover offer on the end-of-attack panel (issue #82, outposts plan
 * WP6), after an attack that destroyed a Map Room 2 camp or player outpost.
 *
 * - **Player outpost:** the owner's rule (#182) gives the attacker one chance,
 *   for a short time, to take it over. The offer says so (`newmap_des_pl1`),
 *   shows the price from the save's `takeovergrant` and counts down to the
 *   grant's end. **Take over** opens the confirm dialog; **Not now** turns it
 *   down (`declinetakeover`), which starts the outpost's damage protection.
 *   Leaving the screen without choosing turns it down too: see
 *   {@link EndTakeoverOffer.declineOnLeave}.
 * - **Wild camp:** anyone in range may take a destroyed camp until it
 *   rebuilds, so there is no countdown and nothing to decline. The offer asks
 *   the server for the price and shows Take over; the map offers it too.
 *
 * Self-contained: the panel only hosts {@link element}.
 */

export interface EndTakeoverOfferOptions {
  readonly kind: TakeoverKind;
  readonly baseid: string;
  /** The tribe's name for a camp, the owner's for an outpost. */
  readonly name: string;
  /** The save's `takeovergrant`; player outposts only. */
  readonly grant: TakeoverGrantOffer | null;
  readonly quote: (baseid: string) => Promise<TakeoverQuoteResponse>;
  readonly takeOver: (baseid: string, payment: TakeoverPayment) => Promise<unknown>;
  /** `declinetakeover`; `keepalive` when the page is going. */
  readonly decline: (
    baseid: string,
    options: { keepalive?: boolean },
  ) => Promise<{ protectedUntil?: number }>;
  /** Where the dialog opens: the overlay's modal layer. */
  readonly modal: HTMLElement;
  /** The yard is the player's now. */
  readonly onTaken: (payment: TakeoverPayment) => void;
  /** Local seconds; `Date.now` by default. */
  readonly now?: () => number;
}

/** Where the offer stands. */
export type EndTakeoverState = "open" | "declining" | "declined" | "taken" | "ended";

/** The text under Not now, so leaving is not a surprise. */
export const LEAVING_DECLINES =
  "Not now, or leaving this screen, turns the offer down and starts this outpost's damage protection.";

export class EndTakeoverOffer {
  readonly element: HTMLElement;

  private readonly options: EndTakeoverOfferOptions;
  private readonly priceLine: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly message: HTMLElement;
  private readonly takeButton: HTMLButtonElement;
  private readonly notNowButton: HTMLButtonElement;
  private state_: EndTakeoverState = "open";
  private quote: TakeoverQuoteResponse | null = null;
  private skew = 0;
  private timer: number | null = null;
  private dialog: TakeoverDialog | null = null;

  constructor(options: EndTakeoverOfferOptions) {
    this.options = options;
    const { kind, grant } = options;

    this.element = document.createElement("section");
    this.element.className = "end-takeover";
    this.element.setAttribute("aria-label", TAKEOVER_TEXT.button);

    const lead = document.createElement("p");
    lead.className = "end-takeover__lead";
    lead.textContent = kind === "outpost" ? TAKEOVER_TEXT.outpostDestroyed : TAKEOVER_TEXT.campDestroyed;

    this.priceLine = document.createElement("p");
    this.priceLine.className = "end-takeover__price";

    this.countdown = document.createElement("p");
    this.countdown.className = "end-takeover__countdown";
    this.countdown.setAttribute("role", "timer");
    this.countdown.hidden = grant === null;

    this.message = document.createElement("p");
    this.message.className = "u-muted end-takeover__message";
    this.message.setAttribute("aria-live", "polite");
    this.message.textContent =
      kind === "outpost"
        ? LEAVING_DECLINES
        : "You can also take it over later from the map, until the camp rebuilds.";

    this.notNowButton = document.createElement("button");
    this.notNowButton.type = "button";
    this.notNowButton.className = "btn btn--ghost end-takeover__not-now";
    this.notNowButton.textContent = "Not now";
    this.notNowButton.hidden = kind !== "outpost";
    this.notNowButton.addEventListener("click", () => void this.notNow());

    this.takeButton = document.createElement("button");
    this.takeButton.type = "button";
    this.takeButton.className = "btn btn--primary end-takeover__take";
    this.takeButton.textContent = TAKEOVER_TEXT.button;
    this.takeButton.addEventListener("click", () => this.open());

    const actions = document.createElement("div");
    actions.className = "end-takeover__actions";
    actions.append(this.notNowButton, this.takeButton);

    this.element.append(lead, this.priceLine, this.countdown, actions, this.message);

    this.showPrice(grant ?? {});
    if (kind === "camp") this.takeButton.disabled = true;
    void this.fetchQuote();
    this.tick();
    if (grant) this.timer = window.setInterval(() => this.tick(), 1000);
  }

  get state(): EndTakeoverState {
    return this.state_;
  }

  /** Whether leaving now would still leave a chance open: an outpost's, not yet taken or declined. */
  get pendingDecline(): boolean {
    return this.options.kind === "outpost" && this.state_ === "open";
  }

  /**
   * The player is leaving the panel without choosing: the owner's rule makes
   * that a "no". Best effort, fired and not waited on: a `keepalive` request
   * when the page itself is going, an ordinary one otherwise. If it never
   * arrives, the server lets the chance run out on its own (10 minutes,
   * `takeoverGrant.ts`) and the protection follows then, so the outcome is
   * the same, only later.
   */
  declineOnLeave(unloading: boolean): void {
    if (!this.pendingDecline) return;
    this.state_ = "declined";
    this.options.decline(this.options.baseid, unloading ? { keepalive: true } : {}).catch(() => {
      // Nothing to show: the screen is going. The grant expires by itself.
    });
  }

  destroy(): void {
    this.stopClock();
    this.dialog?.close();
    this.dialog = null;
    this.element.remove();
  }

  private async fetchQuote(): Promise<void> {
    try {
      const quote = await this.options.quote(this.options.baseid);
      this.skew = clockSkew(quote.now, this.localNow());
      this.quote = quote;
      if (this.state_ !== "open") return;
      this.showPrice(quote);
      if (quote.eligible) {
        this.takeButton.disabled = false;
      } else if (this.options.kind === "outpost" && quote.reason === "noTakeoverChance") {
        // The server has no chance left open for this player: it ran out.
        this.state_ = "ended";
        this.stopClock();
        this.takeButton.disabled = true;
        this.notNowButton.hidden = true;
        this.countdown.hidden = true;
        this.message.textContent = "The chance to take this outpost over has ended.";
      } else {
        this.takeButton.disabled = true;
        this.message.textContent = refusalText(quote.reason ?? "notFound", this.options.kind);
      }
    } catch {
      // The grant already carries the price; a camp without a quote can
      // still be taken from the map.
      if (this.options.kind === "camp" && this.state_ === "open") {
        this.priceLine.textContent = "Could not check the price. You can take it over from the map.";
      }
    }
  }

  private showPrice(price: { resources?: number | undefined; shiny?: number | undefined; adjacent?: boolean | undefined }): void {
    if (price.resources === undefined) {
      this.priceLine.textContent = this.options.kind === "camp" ? "Checking the price…" : "";
      return;
    }
    this.priceLine.textContent =
      `Price: ${priceText(price)}` + (price.adjacent ? " (half price: next to your main yard)" : "");
  }

  private open(): void {
    if (this.state_ !== "open") return;
    const { grant, kind, name, baseid } = this.options;
    const price: TakeoverDialogPrice = this.quote ?? {
      resources: grant?.resources,
      shiny: grant?.shiny,
      adjacent: grant?.adjacent,
      grantExpiresAt: grant?.expiresAt,
    };
    this.dialog?.close();
    this.dialog = new TakeoverDialog({
      kind,
      name,
      price: grant && price.grantExpiresAt === undefined ? { ...price, grantExpiresAt: grant.expiresAt } : price,
      takeOver: (payment) => this.options.takeOver(baseid, payment),
      onTaken: (payment) => {
        this.dialog = null;
        this.state_ = "taken";
        this.stopClock();
        this.options.onTaken(payment);
      },
      serverNow: () => this.localNow() + this.skew,
    }).mount(this.options.modal);
  }

  private async notNow(): Promise<void> {
    if (this.state_ !== "open") return;
    this.state_ = "declining";
    this.takeButton.disabled = true;
    this.notNowButton.disabled = true;
    this.message.textContent = "Turning the offer down…";
    try {
      const { protectedUntil } = await this.options.decline(this.options.baseid, {});
      this.state_ = "declined";
      this.stopClock();
      this.countdown.hidden = true;
      this.takeButton.hidden = true;
      this.notNowButton.hidden = true;
      const left = (protectedUntil ?? 0) - (this.localNow() + this.skew);
      this.message.textContent =
        left > 0
          ? `You turned the offer down. ${this.options.name}'s outpost is now under damage protection for ${formatSpan(left)}.`
          : "You turned the offer down.";
    } catch {
      // The server still holds the chance open; offer both again.
      this.state_ = "open";
      this.takeButton.disabled = false;
      this.notNowButton.disabled = false;
      this.message.textContent = `Could not turn the offer down. ${LEAVING_DECLINES}`;
    }
  }

  private tick(): void {
    const expiresAt = this.options.grant?.expiresAt;
    if (expiresAt === undefined || this.state_ !== "open") return;
    const serverNow = this.localNow() + this.skew;
    this.countdown.textContent = grantCountdownText(expiresAt, serverNow);
    if (serverNow >= expiresAt) {
      // The countdown only shows the time: the server says whether it is over.
      this.stopClock();
      void this.fetchQuote();
    }
  }

  private stopClock(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private localNow(): number {
    return (this.options.now ?? (() => Date.now() / 1000))();
  }
}
