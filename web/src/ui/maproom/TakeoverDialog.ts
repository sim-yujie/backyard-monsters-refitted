import type { TakeoverPayment } from "@/api/maproom";
import {
  FIRST_OPEN_ART,
  TAKEOVER_TEXT,
  firstOpenText,
  grantCountdownText,
  outpostTitle,
  takeoverFailureText,
  useShinyLabel,
  type TakeoverKind,
} from "@/game/maproom/takeover";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { RESOURCE_KEYS, resourceAmount, resourceIcon, type ResourceKey } from "@/ui/resourceIcon";
import { GROUND_BONUS_TITLE, groundBonusIcons } from "./groundBonus";

/**
 * The takeover confirm dialog (issue #82): Flash's `PopupTakeover`
 * (`PopupTakeover.as:85-122`) with one more step. Flash took the yard the
 * moment "Use Resources" or "Use N Shiny" was pressed; here the choice is
 * followed by a confirm that names the price again, since the price is
 * millions and the takeover cannot be undone.
 *
 * Everything it shows comes from the server's quote. The dialog does not
 * decide eligibility: a refusal comes back from `takeOver` and is shown in
 * Flash's `err_takeoverproblem` wording, and the choice is offered again.
 *
 * Self-contained on purpose, so the map's cell panel and the end-of-attack
 * panel can both open it and a later restyle of either leaves it alone.
 */

/** The quote fields the dialog shows. A takeover grant from an attack save carries the same price. */
export interface TakeoverDialogPrice {
  /** Of each of r1..r4. */
  readonly resources?: number | undefined;
  readonly shiny?: number | undefined;
  readonly adjacent?: boolean | undefined;
  /** "Frontier Pass": `resources` is the cheap price, 10% of the full base. */
  readonly welcome?: boolean | undefined;
  /** The resource price without the welcome discount; with `welcome`. */
  readonly usualResources?: number | undefined;
  /** Absent when not known: both payments are offered and the server decides. */
  readonly affordable?: { readonly resources: boolean; readonly shiny: boolean } | undefined;
  readonly shinyLocked?: boolean | undefined;
  /** Server seconds a player outpost's chance ends. */
  readonly grantExpiresAt?: number | undefined;
}

export interface TakeoverDialogOptions {
  readonly kind: TakeoverKind;
  /** The tribe's name for a camp, the owner's for an outpost. */
  readonly name: string;
  /** The cell's height: said as its tower range and income bonus. Absent: no line. */
  readonly height?: number;
  readonly price: TakeoverDialogPrice;
  /** Takes the yard over; rejects with the server's refusal. */
  readonly takeOver: (payment: TakeoverPayment) => Promise<unknown>;
  /** After the server has taken it. The dialog has closed itself by then. */
  readonly onTaken: (payment: TakeoverPayment) => void;
  /** Server seconds now, for the grant's countdown. */
  readonly serverNow?: () => number;
  /**
   * Turns a player outpost's single chance down (`declinetakeover`), offered
   * as "Not now" while the grant is live (#187, from the #82 test): until now
   * only the end-of-attack panel could. Resolves with when the outpost's
   * damage protection ends.
   */
  readonly decline?: () => Promise<{ protectedUntil?: number }>;
  /** The chance was turned down. The dialog has closed itself by then. */
  readonly onDeclined?: (protectedUntil: number | undefined) => void;
}

type Step = "choose" | "confirm" | "busy";

export class TakeoverDialog {
  readonly popup: Popup;

  private readonly options: TakeoverDialogOptions;
  private readonly choice: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly confirmText: HTMLElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly resourcesButton: HTMLButtonElement;
  private readonly shinyButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly notNowButton: HTMLButtonElement;
  private timer: number | null = null;
  private payment: TakeoverPayment = "resources";
  private step: Step = "choose";

  constructor(options: TakeoverDialogOptions) {
    this.options = options;
    const { kind, name, price } = options;

    this.popup = new Popup({
      title: kind === "camp" ? TAKEOVER_TEXT.campTitle : outpostTitle(name),
      className: "takeover-dialog",
      onClose: () => this.stopClock(),
    });

    const expand = document.createElement("p");
    expand.className = "takeover-dialog__lead";
    expand.textContent = TAKEOVER_TEXT.expand;

    const ground = document.createElement("p");
    ground.className = "u-muted takeover-dialog__ground";
    ground.title = GROUND_BONUS_TITLE;
    if (options.height !== undefined) ground.append(...groundBonusIcons(options.height));
    ground.hidden = options.height === undefined;

    const cost = document.createElement("ul");
    cost.className = "takeover-dialog__cost";
    cost.setAttribute("aria-label", "Price, of each resource");
    // A "Frontier Pass" price shows, on each resource, the usual price
    // struck through and then the cut one: "~~9,000,000~~ 900,000".
    const usual = price.welcome ? price.usualResources : undefined;
    for (const key of RESOURCE_KEYS) {
      const item = document.createElement("li");
      item.append(usual !== undefined ? welcomeTile(key, usual, price.resources) : resourceAmount(key, price.resources ?? "—"));
      cost.append(item);
    }

    const adjacent = document.createElement("p");
    adjacent.className = "u-muted takeover-dialog__adjacent";
    adjacent.textContent = "Half price: this yard is next to your main yard.";
    // The welcome price is a flat 10% of the full price: no half price on top.
    adjacent.hidden = !price.adjacent || !!price.welcome;

    const welcome = welcomeLabel(price);

    this.countdown = document.createElement("p");
    this.countdown.className = "takeover-dialog__countdown";
    this.countdown.setAttribute("role", "timer");
    this.countdown.hidden = price.grantExpiresAt === undefined;

    const resourcesShort = price.affordable ? !price.affordable.resources : false;
    const shinyShort = price.affordable ? !price.affordable.shiny : false;

    this.resourcesButton = button(TAKEOVER_TEXT.useResources, "btn btn--primary takeover-dialog__resources");
    this.resourcesButton.disabled = resourcesShort || price.resources === undefined;
    this.resourcesButton.addEventListener("click", () => this.choose("resources"));
    const resourcesNote = note(
      resourcesShort ? TAKEOVER_TEXT.needResources : `${formatAmount(price.resources)} of each resource.`,
      resourcesShort ? "takeover-dialog__short" : "u-muted",
    );

    this.shinyButton = button(
      price.shiny === undefined ? "Use Shiny" : useShinyLabel(price.shiny),
      "btn takeover-dialog__shiny",
    );
    this.shinyButton.disabled = shinyShort || price.shiny === undefined;
    this.shinyButton.addEventListener("click", () => this.choose("shiny"));
    const shinyNote = note(
      price.shinyLocked
        ? "Shiny is turned off for your account."
        : shinyShort
          ? "You do not have enough Shiny."
          : TAKEOVER_TEXT.instant,
      shinyShort ? "takeover-dialog__short" : "u-muted",
    );

    this.choice = document.createElement("div");
    this.choice.className = "takeover-dialog__choice";
    this.choice.append(
      option(this.resourcesButton, resourcesNote),
      option(this.shinyButton, shinyNote),
    );

    this.notNowButton = button("Not now", "btn btn--ghost takeover-dialog__not-now");
    this.notNowButton.title =
      "Turn the offer down. The outpost's damage protection starts now, and the chance is gone.";
    this.notNowButton.hidden = !(options.decline && price.grantExpiresAt !== undefined);
    this.notNowButton.addEventListener("click", () => void this.notNow());
    this.choice.append(this.notNowButton);

    this.confirmText = document.createElement("p");
    this.confirmText.className = "takeover-dialog__confirm-text";
    this.backButton = button("Back", "btn btn--ghost takeover-dialog__back");
    this.backButton.addEventListener("click", () => this.setStep("choose"));
    this.confirmButton = button(TAKEOVER_TEXT.button, "btn btn--primary takeover-dialog__go");
    this.confirmButton.addEventListener("click", () => void this.go());
    const confirmActions = document.createElement("div");
    confirmActions.className = "takeover-dialog__actions";
    confirmActions.append(this.backButton, this.confirmButton);
    this.confirm = document.createElement("div");
    this.confirm.className = "takeover-dialog__confirm";
    this.confirm.append(this.confirmText, confirmActions);

    this.status = document.createElement("p");
    this.status.className = "takeover-dialog__status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.hidden = true;

    this.popup.setContent(expand, ground, welcome, cost, adjacent, this.countdown, this.choice, this.confirm, this.status);
    this.setStep("choose");
    this.tick();
    if (price.grantExpiresAt !== undefined) this.timer = window.setInterval(() => this.tick(), 1000);
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    // The popup focuses its close button; the first payment is the likelier key press.
    this.firstEnabledChoice()?.focus();
    return this;
  }

  close(): void {
    this.popup.close();
  }

  /** The step shown, for the tests. */
  get currentStep(): Step {
    return this.step;
  }

  private choose(payment: TakeoverPayment): void {
    this.payment = payment;
    const { price } = this.options;
    this.confirmText.textContent =
      payment === "shiny"
        ? `Take this yard over for ${formatAmount(price.shiny)} Shiny?`
        : `Take this yard over for ${formatAmount(price.resources)} of each resource?`;
    this.status.hidden = true;
    this.setStep("confirm");
  }

  private async notNow(): Promise<void> {
    const decline = this.options.decline;
    if (!decline || this.step !== "choose") return;
    // Everything in the choice is held still while the server answers.
    const buttons = [this.resourcesButton, this.shinyButton, this.notNowButton];
    const wasDisabled = buttons.map((one) => one.disabled);
    for (const one of buttons) one.disabled = true;
    this.showStatus("Turning the offer down…", false);
    let protectedUntil: number | undefined;
    try {
      ({ protectedUntil } = await decline());
    } catch {
      buttons.forEach((one, i) => (one.disabled = wasDisabled[i] ?? false));
      this.showStatus("Could not turn the offer down. The chance is still open.", true);
      return;
    }
    this.close();
    this.options.onDeclined?.(protectedUntil);
  }

  private async go(): Promise<void> {
    if (this.step !== "confirm") return;
    const payment = this.payment;
    this.setStep("busy");
    this.showStatus("Taking over…", false);
    try {
      await this.options.takeOver(payment);
    } catch (caught) {
      this.showStatus(takeoverFailureText(caught, this.options.kind), true);
      this.setStep("choose");
      return;
    }
    this.close();
    this.options.onTaken(payment);
  }

  private setStep(step: Step): void {
    this.step = step;
    this.choice.hidden = step !== "choose";
    this.confirm.hidden = step === "choose";
    this.confirmButton.disabled = step === "busy";
    this.backButton.disabled = step === "busy";
    const focus = step === "choose" ? this.firstEnabledChoice() : step === "confirm" ? this.confirmButton : null;
    focus?.focus();
  }

  private firstEnabledChoice(): HTMLButtonElement | null {
    return [this.resourcesButton, this.shinyButton].find((choice) => !choice.disabled) ?? null;
  }

  private showStatus(text: string, failed: boolean): void {
    this.status.textContent = text;
    this.status.classList.toggle("takeover-dialog__status--failed", failed);
    this.status.hidden = false;
  }

  private tick(): void {
    const expiresAt = this.options.price.grantExpiresAt;
    if (expiresAt === undefined) return;
    const now = this.options.serverNow?.() ?? Date.now() / 1000;
    this.countdown.textContent = grantCountdownText(expiresAt, now);
  }

  private stopClock(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Flash's first-open popup for a new outpost (`BASE.as:2292-2319`): "Veni,
 * Vidi, Vici!", the outpost art and `destroyedbase_takeover` or
 * `destroyedoutpost_takeover`. Flash showed it as the outpost opened, and so
 * does the yard when a takeover from the map opens the new outpost (outposts
 * WP5); after a takeover from the end-of-attack panel the map shows it as it
 * selects the new outpost.
 */
export const showTakenOver = (container: HTMLElement, kind: TakeoverKind, name: string): Popup => {
  const popup = new Popup({ title: TAKEOVER_TEXT.firstOpenTitle, className: "takeover-first-open" });

  const art = document.createElement("img");
  art.className = "takeover-first-open__art";
  art.src = FIRST_OPEN_ART;
  art.alt = "";

  const line = document.createElement("p");
  line.className = "takeover-first-open__text";
  line.textContent = firstOpenText(kind, name);

  const ok = button("OK", "btn btn--primary");
  ok.addEventListener("click", () => popup.close());

  popup.setContent(art, line, ok);
  return popup.mount(container);
};

const button = (label: string, className: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
};

const note = (text: string, className: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = `takeover-dialog__note ${className}`;
  element.textContent = text;
  return element;
};

const option = (action: HTMLButtonElement, caption: HTMLElement): HTMLElement => {
  const element = document.createElement("div");
  element.className = "takeover-dialog__option";
  element.append(action, caption);
  return element;
};

/**
 * One resource's "Frontier Pass" price: the icon, the usual price struck
 * through, then the cut price. The two prices sit side by side, or one over
 * the other where the tile is too narrow (a phone).
 */
const welcomeTile = (key: ResourceKey, usual: number, cut: number | undefined): HTMLElement => {
  const tile = document.createElement("span");
  tile.className = "takeover-dialog__welcome-price";
  tile.dataset["resource"] = key;
  const prices = document.createElement("span");
  prices.className = "takeover-dialog__prices";
  const struck = document.createElement("s");
  struck.className = "takeover-dialog__usual";
  struck.textContent = formatAmount(usual);
  struck.title = "The usual price";
  const now = document.createElement("span");
  now.className = "takeover-dialog__cut";
  now.textContent = cut === undefined ? "—" : formatAmount(cut);
  prices.append(hiddenText("usually "), struck, hiddenText(", now "), now);
  tile.append(resourceIcon(key), prices);
  return tile;
};

const hiddenText = (text: string): HTMLElement => {
  const span = document.createElement("span");
  span.className = "u-visually-hidden";
  span.textContent = text;
  return span;
};

/** The small label over a "Frontier Pass" price; hidden otherwise. */
export const WELCOME_LABEL = "Frontier Pass";

const welcomeLabel = (price: TakeoverDialogPrice): HTMLElement => {
  const line = document.createElement("p");
  line.className = "takeover-dialog__welcome";
  line.hidden = !price.welcome;
  if (!price.welcome) return line;
  const tag = document.createElement("span");
  tag.className = "takeover-dialog__welcome-tag";
  tag.textContent = WELCOME_LABEL;
  const off = document.createElement("span");
  off.className = "takeover-dialog__welcome-off";
  off.textContent = "-90%";
  // The usual price, struck through, is on each resource's tile below.
  line.append(tag, off);
  return line;
};
