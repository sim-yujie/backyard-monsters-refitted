import type { RandomMoveResponse } from "@/api/maproom";
import {
  RANDOM_MOVE_TEXT,
  availableAgainText,
  confirmQuestion,
  movedText,
  outpostWarning,
} from "@/game/maproom/randomMove";
import { Popup } from "@/ui/Popup";

/**
 * "Move to a Random Spot" (issue #366): the confirm the Map Room's option
 * opens. It says plainly what the move costs — every outpost, with what is on
 * it — before Confirm, since nothing can be undone. The server decides: a
 * refusal (the week not up, an attack running) is shown in its own words and
 * the move can be tried again or cancelled.
 */

export interface RandomMoveDialogOptions {
  /** How many outposts the player holds: all of them are lost. */
  readonly outposts: number;
  /** Makes the move; rejects with the server's refusal. */
  readonly move: () => Promise<RandomMoveResponse>;
  /** The yard has moved; the dialog now shows where. */
  readonly onMoved: (answer: RandomMoveResponse) => void;
  /** Opens the world map, offered once the yard has moved. */
  readonly openMap?: () => void;
  /** Local unix seconds, for a refusal's "available again". */
  readonly now?: () => number;
}

type Step = "confirm" | "busy" | "done";

export class RandomMoveDialog {
  readonly popup: Popup;

  private readonly options: RandomMoveDialogOptions;
  private readonly ask: HTMLElement;
  private readonly done: HTMLElement;
  private readonly doneText: HTMLElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private step: Step = "confirm";
  /** Set once the server has said the week is not up: Confirm stays off. */
  private coolingDown = false;

  constructor(options: RandomMoveDialogOptions) {
    this.options = options;
    this.popup = new Popup({ title: RANDOM_MOVE_TEXT.title, className: "takeover-dialog random-move-dialog" });

    const lead = text("p", "takeover-dialog__lead", RANDOM_MOVE_TEXT.lead);

    const lines = outpostWarning(options.outposts);
    const warning = document.createElement("div");
    if (lines) {
      warning.className = "relocate-dialog__warning random-move-dialog__warning";
      warning.setAttribute("role", "alert");
      for (const line of lines) warning.append(text("p", "random-move-dialog__line", line));
    } else {
      warning.className = "random-move-dialog__none";
      warning.append(text("p", "takeover-dialog__note u-muted", RANDOM_MOVE_TEXT.noOutposts));
    }

    const free = text("p", "takeover-dialog__note random-move-dialog__free", RANDOM_MOVE_TEXT.free);

    this.cancelButton = button(RANDOM_MOVE_TEXT.cancel, "btn btn--ghost random-move-dialog__cancel");
    this.cancelButton.addEventListener("click", () => this.close());
    this.confirmButton = button(RANDOM_MOVE_TEXT.confirm, "btn btn--danger random-move-dialog__confirm");
    this.confirmButton.addEventListener("click", () => void this.go());
    const actions = document.createElement("div");
    actions.className = "takeover-dialog__actions";
    actions.append(this.cancelButton, this.confirmButton);
    this.ask = document.createElement("div");
    this.ask.className = "takeover-dialog__confirm";
    this.ask.append(text("p", "takeover-dialog__confirm-text", confirmQuestion(options.outposts)), actions);

    this.doneText = text("p", "takeover-dialog__lead random-move-dialog__moved", "");
    const doneActions = document.createElement("div");
    doneActions.className = "takeover-dialog__actions";
    const close = button(RANDOM_MOVE_TEXT.close, "btn btn--ghost random-move-dialog__close");
    close.addEventListener("click", () => this.close());
    doneActions.append(close);
    const openMap = options.openMap;
    if (openMap) {
      const go = button(RANDOM_MOVE_TEXT.openMap, "btn btn--primary random-move-dialog__open-map");
      go.addEventListener("click", () => {
        this.close();
        openMap();
      });
      doneActions.append(go);
    }
    this.done = document.createElement("div");
    this.done.className = "random-move-dialog__done";
    this.done.append(this.doneText, doneActions);

    this.status = text("p", "takeover-dialog__status", "");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.hidden = true;

    this.popup.setContent(lead, warning, free, this.ask, this.done, this.status);
    this.setStep("confirm");
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    this.cancelButton.focus();
    return this;
  }

  close(): void {
    this.popup.close();
  }

  /** The step shown, for the tests. */
  get currentStep(): Step {
    return this.step;
  }

  private async go(): Promise<void> {
    if (this.step !== "confirm" || this.coolingDown) return;
    this.setStep("busy");
    this.showStatus(RANDOM_MOVE_TEXT.busy, false);
    let answer: RandomMoveResponse;
    try {
      answer = await this.options.move();
    } catch (caught) {
      this.showStatus(failureText(caught, this.now()), true);
      if (refusalOf(caught) === "coolingDown") this.coolingDown = true;
      this.setStep("confirm");
      return;
    }
    const coords = answer.coords;
    this.doneText.textContent = movedText(Array.isArray(coords) && coords.length === 2 ? [coords[0], coords[1]] : null);
    this.status.hidden = true;
    this.setStep("done");
    this.options.onMoved(answer);
  }

  private setStep(step: Step): void {
    this.step = step;
    this.ask.hidden = step === "done";
    this.done.hidden = step !== "done";
    this.confirmButton.disabled = step === "busy" || this.coolingDown;
    this.cancelButton.disabled = step === "busy";
    if (step === "done") this.done.querySelector<HTMLButtonElement>("button:last-child")?.focus();
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

/** The server's refusal, from `errorDetails.data.reason`. */
const refusalOf = (caught: unknown): string | undefined => {
  const data = (caught as { details?: { data?: { reason?: unknown } } } | null)?.details?.data;
  return typeof data?.reason === "string" ? data.reason : undefined;
};

/** The server's reason, with "available again" when the week is not up. */
const failureText = (caught: unknown, now: number): string => {
  if ((caught as { name?: unknown } | null)?.name === "NetworkError") {
    return `${RANDOM_MOVE_TEXT.problem}the server could not be reached.`;
  }
  const message = caught instanceof Error && caught.message ? caught.message : "something went wrong.";
  const data = (caught as { details?: { data?: { availableAt?: unknown; currenttime?: unknown } } } | null)?.details
    ?.data;
  if (typeof data?.availableAt === "number") {
    const serverNow = typeof data.currenttime === "number" ? data.currenttime : now;
    return `${message} ${availableAgainText(data.availableAt - serverNow)}`;
  }
  return message;
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
