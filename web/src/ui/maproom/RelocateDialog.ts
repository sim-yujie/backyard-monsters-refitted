import type { RelocatePayment, RelocateResponse } from "@/api/maproom";
import {
  RELOCATE_PRICE,
  RELOCATE_TEXT,
  cooldownText,
  countsList,
  useShinyText,
  type MonsterCount,
} from "@/game/maproom/moveYards";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { monsterName } from "@/ui/attack/ArmyPanel";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { RESOURCE_KEYS, resourceAmount } from "@/ui/resourceIcon";

/**
 * "Move Main Yard Here" (outposts WP7, #186): Flash's `PopupRelocateMe` on
 * one of the player's own outposts, with its warning, its price (30,000,000
 * of each resource or 1,500 Shiny) and, as the owner decided, the list of
 * this outpost's monsters, which are lost with it. As with Take over, a
 * choice of payment is followed by a confirm that names the price again,
 * since the move cannot be undone.
 *
 * The server decides: it may answer with the day's cooldown instead
 * (`movebase_warning`), or refuse, which is shown in Flash's
 * `msg_err_relocate` wording and the choice is offered again.
 */

export interface RelocateDialogOptions {
  /** The outpost's monsters, lost with it. */
  readonly lost: Readonly<Record<string, number>>;
  /** Whether the purse covers each price; both are offered when unknown. */
  readonly affordable?: { readonly resources: boolean; readonly shiny: boolean };
  /** Moves the main yard here; rejects with the server's refusal. */
  readonly move: (payment: RelocatePayment) => Promise<RelocateResponse>;
  /** The main yard is here now. The dialog has closed itself by then. */
  readonly onMoved: (coords: readonly [number, number] | null) => void;
  /** Local unix seconds, for the cooldown. */
  readonly now?: () => number;
}

type Step = "choose" | "confirm" | "busy";

export class RelocateDialog {
  readonly popup: Popup;

  private readonly options: RelocateDialogOptions;
  private readonly choice: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly confirmText: HTMLElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly resourcesButton: HTMLButtonElement;
  private readonly shinyButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private payment: RelocatePayment = "resources";
  private step: Step = "choose";
  /** Set once the server has said the day's cooldown runs: no button moves until then. */
  private coolingDown = false;

  constructor(options: RelocateDialogOptions) {
    this.options = options;
    this.popup = new Popup({ title: RELOCATE_TEXT.title, className: "takeover-dialog relocate-dialog" });

    const lead = text("p", "takeover-dialog__lead", RELOCATE_TEXT.lead);
    const warning = text("p", "relocate-dialog__warning", RELOCATE_TEXT.warning);
    warning.setAttribute("role", "note");

    const lost = countsList(options.lost);
    const lostBlock = document.createElement("div");
    lostBlock.className = "relocate-dialog__lost";
    lostBlock.append(
      text("p", "relocate-dialog__lost-title", lost.length > 0 ? RELOCATE_TEXT.lost : RELOCATE_TEXT.noneLost),
    );
    if (lost.length > 0) lostBlock.append(lostList(lost));

    const cost = document.createElement("ul");
    cost.className = "takeover-dialog__cost";
    cost.setAttribute("aria-label", "Price, of each resource");
    for (const key of RESOURCE_KEYS) {
      const item = document.createElement("li");
      item.append(resourceAmount(key, RELOCATE_PRICE.resources));
      cost.append(item);
    }

    const resourcesShort = options.affordable ? !options.affordable.resources : false;
    const shinyShort = options.affordable ? !options.affordable.shiny : false;

    this.resourcesButton = button(RELOCATE_TEXT.useResources, "btn btn--primary relocate-dialog__resources");
    this.resourcesButton.disabled = resourcesShort;
    this.resourcesButton.addEventListener("click", () => this.choose("resources"));
    this.shinyButton = button(useShinyText(RELOCATE_PRICE.shiny), "btn relocate-dialog__shiny");
    this.shinyButton.disabled = shinyShort;
    this.shinyButton.addEventListener("click", () => this.choose("shiny"));

    this.choice = document.createElement("div");
    this.choice.className = "takeover-dialog__choice";
    this.choice.append(
      option(
        this.resourcesButton,
        resourcesShort
          ? note(RELOCATE_TEXT.notEnoughResources, "takeover-dialog__short")
          : note(`${formatAmount(RELOCATE_PRICE.resources)} of each resource.`, "u-muted"),
      ),
      option(
        this.shinyButton,
        shinyShort
          ? note(RELOCATE_TEXT.notEnoughShiny, "takeover-dialog__short")
          : note(RELOCATE_TEXT.instant, "u-muted"),
      ),
    );

    this.confirmText = text("p", "takeover-dialog__confirm-text", "");
    this.backButton = button("Back", "btn btn--ghost takeover-dialog__back");
    this.backButton.addEventListener("click", () => this.setStep("choose"));
    this.confirmButton = button(RELOCATE_TEXT.button, "btn btn--danger takeover-dialog__go");
    this.confirmButton.addEventListener("click", () => void this.go());
    const actions = document.createElement("div");
    actions.className = "takeover-dialog__actions";
    actions.append(this.backButton, this.confirmButton);
    this.confirm = document.createElement("div");
    this.confirm.className = "takeover-dialog__confirm";
    this.confirm.append(this.confirmText, actions);

    this.status = text("p", "takeover-dialog__status", "");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.hidden = true;

    this.popup.setContent(lead, warning, lostBlock, cost, this.choice, this.confirm, this.status);
    this.setStep("choose");
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    return this;
  }

  close(): void {
    this.popup.close();
  }

  /** The step shown, for the tests. */
  get currentStep(): Step {
    return this.step;
  }

  private choose(payment: RelocatePayment): void {
    this.payment = payment;
    const lost = countsList(this.options.lost).reduce((sum, row) => sum + row.count, 0);
    const price =
      payment === "shiny"
        ? `${formatAmount(RELOCATE_PRICE.shiny)} Shiny`
        : `${formatAmount(RELOCATE_PRICE.resources)} of each resource`;
    this.confirmText.textContent =
      `Move your main yard here for ${price}? This outpost and its buildings are destroyed` +
      (lost > 0 ? `, and its ${lost} monsters are lost.` : ".");
    this.status.hidden = true;
    this.setStep("confirm");
  }

  private async go(): Promise<void> {
    if (this.step !== "confirm") return;
    this.setStep("busy");
    this.showStatus(RELOCATE_TEXT.busy, false);
    let answer: RelocateResponse;
    try {
      answer = await this.options.move(this.payment);
    } catch (caught) {
      this.showStatus(failureText(caught), true);
      this.setStep("choose");
      return;
    }
    if (typeof answer.cantMoveTill === "number") {
      const now = typeof answer.currenttime === "number" ? answer.currenttime : this.now();
      this.coolingDown = true;
      this.showStatus(cooldownText(answer.cantMoveTill, now), true);
      this.setStep("choose");
      return;
    }
    this.close();
    const coords = answer.coords;
    this.options.onMoved(Array.isArray(coords) && coords.length === 2 ? [coords[0], coords[1]] : null);
  }

  private setStep(step: Step): void {
    this.step = step;
    this.choice.hidden = step !== "choose";
    this.confirm.hidden = step === "choose";
    this.confirmButton.disabled = step === "busy";
    this.backButton.disabled = step === "busy";
    if (this.coolingDown) {
      this.resourcesButton.disabled = true;
      this.shinyButton.disabled = true;
    }
    const focus =
      step === "confirm"
        ? this.backButton
        : [this.resourcesButton, this.shinyButton].find((one) => !one.disabled);
    if (step !== "busy") focus?.focus();
  }

  private showStatus(message: string, failed: boolean): void {
    this.status.textContent = message;
    this.status.classList.toggle("takeover-dialog__status--failed", failed);
    this.status.hidden = false;
  }

  private now(): number {
    return (this.options.now ?? (() => Date.now() / 1000))();
  }
}

/** Flash's `msg_err_relocate` and why. */
const failureText = (caught: unknown): string => {
  if ((caught as { name?: unknown } | null)?.name === "NetworkError") {
    return `${RELOCATE_TEXT.problem}the server could not be reached.`;
  }
  const message = caught instanceof Error && caught.message ? caught.message : "something went wrong.";
  return RELOCATE_TEXT.problem + message;
};

/** The lost monsters: a small picture, the name and how many. */
const lostList = (rows: readonly MonsterCount[]): HTMLElement => {
  const list = document.createElement("ul");
  list.className = "relocate-dialog__lost-list";
  list.setAttribute("aria-label", "Monsters lost with this outpost");
  for (const { id, count } of rows) {
    const item = document.createElement("li");
    item.className = "relocate-dialog__lost-item";
    const picture = document.createElement("img");
    showPortrait(picture, monsterPortrait(id, "icon"));
    picture.alt = "";
    picture.decoding = "async";
    item.append(
      picture,
      text("span", "relocate-dialog__lost-name", monsterName(id)),
      text("span", "relocate-dialog__lost-count", `× ${formatAmount(count)}`),
    );
    list.append(item);
  }
  return list;
};

const text = (tag: "p" | "span", className: string, content: string): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
};

const button = (label: string, className: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
};

const note = (content: string, className: string): HTMLElement =>
  text("p", `takeover-dialog__note ${className}`, content);

const option = (action: HTMLButtonElement, caption: HTMLElement): HTMLElement => {
  const element = document.createElement("div");
  element.className = "takeover-dialog__option";
  element.append(action, caption);
  return element;
};
