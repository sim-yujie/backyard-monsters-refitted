import type { AttackSummary } from "@/game/attack/attackSave";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";

/**
 * The one screen at the end of an attack (`docs/design/attack-flow.md` §F6):
 * the outcome, the damage, what was destroyed, what was looted, what was
 * lost, and one Return-to-map action. It replaces Flash's pair — the attack
 * log popup and `popup_attackend` — with a single modal.
 *
 * The panel also carries the save's progress, because the result is not the
 * player's until the server has it: it opens in a "Saving…" state, becomes
 * final once the save succeeds (with the defender's new protection when the
 * response grants one), and on a failure shows the error with Retry and a
 * "Leave without saving" that asks twice (§4.7: a clear notice, never a
 * silent retry). Return to map is enabled only after a successful save.
 *
 * Built on {@link Panel} inside its own scrim rather than on `Popup`, because
 * a popup closes on Escape and on a backdrop click and this screen must not:
 * there is nothing sensible behind it to go back to.
 */

export interface EndAttackPanelOptions {
  readonly summary: AttackSummary;
  /** Return to map, after a successful save. */
  readonly onReturn: () => void;
  /** Send the save again. */
  readonly onRetry: () => void;
  /** Leave with the result unsaved; called only after the second confirmation. */
  readonly onLeave: () => void;
}

/** Where the save stands, as the panel shows it. */
export type EndAttackSaveStatus = "saving" | "saved" | "failed";

export interface SaveFailure {
  readonly message: string;
  /** False when a retry cannot succeed (the attack expired); Retry is hidden. */
  readonly canRetry: boolean;
}

export interface SavedInfo {
  /** Unix seconds until which the defender is now protected, if the server said so. */
  readonly protectedUntil?: number | null;
  /** Unix seconds now, for the protection line. */
  readonly now?: number;
}

/** `Nh Nm` for a span of seconds; the protection line's spelling. */
export const formatSpan = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.round((whole % 3600) / 60);
  if (hours === 0) return `${Math.max(1, minutes)} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
};

const RESOURCE_LABELS = [
  ["r1", "Twigs"],
  ["r2", "Pebbles"],
  ["r3", "Putty"],
  ["r4", "Goo"],
] as const;

const endReasonText = (summary: AttackSummary): string => {
  switch (summary.endReason) {
    case "destroyed":
      return "The yard was destroyed.";
    case "exhausted":
      return "Nothing was left to send.";
    case "expired":
      return "Time ran out.";
    case "retreat":
      return "You retreated.";
    default:
      return "";
  }
};

export class EndAttackPanel {
  readonly element: HTMLElement;
  readonly panel: Panel;

  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly protection: HTMLElement;
  private readonly returnButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly leaveButton: HTMLButtonElement;
  private readonly leaveConfirm: HTMLElement;
  private readonly options: EndAttackPanelOptions;
  private status_: EndAttackSaveStatus = "saving";

  constructor(options: EndAttackPanelOptions) {
    this.options = options;
    const { summary } = options;

    this.element = document.createElement("div");
    this.element.className = "popup-backdrop attack-end__backdrop";

    this.panel = new Panel({
      title: "Attack over",
      closable: false,
      className: `map-panel attack-end attack-end--${summary.tone}`,
    });
    this.panel.element.setAttribute("role", "dialog");
    this.panel.element.setAttribute("aria-modal", "true");

    const outcome = document.createElement("p");
    outcome.className = "attack-end__outcome";
    outcome.textContent = summary.outcome;

    const reason = document.createElement("p");
    reason.className = "u-muted attack-end__reason";
    reason.textContent = endReasonText(summary);

    const stats = document.createElement("dl");
    stats.className = "attack-end__stats";
    const stat = (label: string, value: string, title?: string): void => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      if (title) dd.title = title;
      stats.append(dt, dd);
    };
    stat("Damage", `${Math.floor(summary.damagePercent)}%`);
    stat("Buildings destroyed", `${summary.buildingsDestroyed} of ${summary.buildingsTotal}`);
    stat(
      "Monsters lost",
      `${summary.monstersLost} of ${summary.monstersSent} sent`,
      summary.championHp === null
        ? undefined
        : `Champion health left: ${Math.max(0, Math.floor(summary.championHp))}`,
    );

    const loot = document.createElement("ul");
    loot.className = "attack-end__loot";
    loot.setAttribute("aria-label", "Loot taken");
    for (const [key, label] of RESOURCE_LABELS) {
      const item = document.createElement("li");
      const amount = summary.loot[key];
      item.className = `attack-end__loot-item${amount > 0 ? "" : " attack-end__loot-item--none"}`;
      item.textContent = `${label} ${formatAmount(amount)}`;
      item.title = `${label}: ${Math.floor(amount)}`;
      loot.append(item);
    }

    this.status = document.createElement("div");
    this.status.className = "attack-end__status attack-end__status--saving";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.statusText = document.createElement("span");
    this.statusText.textContent = "Saving the result…";
    this.status.append(this.statusText);

    this.protection = document.createElement("p");
    this.protection.className = "u-muted attack-end__protection";
    this.protection.hidden = true;

    this.returnButton = document.createElement("button");
    this.returnButton.type = "button";
    this.returnButton.className = "btn btn--primary attack-end__return";
    this.returnButton.textContent = "Return to map";
    this.returnButton.disabled = true;
    this.returnButton.addEventListener("click", () => {
      if (this.status_ === "saved") this.options.onReturn();
    });

    this.retryButton = document.createElement("button");
    this.retryButton.type = "button";
    this.retryButton.className = "btn btn--primary attack-end__retry";
    this.retryButton.textContent = "Retry";
    this.retryButton.hidden = true;
    this.retryButton.addEventListener("click", () => this.options.onRetry());

    this.leaveButton = document.createElement("button");
    this.leaveButton.type = "button";
    this.leaveButton.className = "btn btn--ghost attack-end__leave";
    this.leaveButton.textContent = "Leave without saving";
    this.leaveButton.hidden = true;
    this.leaveButton.addEventListener("click", () => this.askLeave());

    this.leaveConfirm = document.createElement("div");
    this.leaveConfirm.className = "attack-end__leave-confirm";
    this.leaveConfirm.hidden = true;
    const leaveText = document.createElement("span");
    leaveText.textContent = "Leave now? The result of this attack will be lost.";
    const leaveYes = document.createElement("button");
    leaveYes.type = "button";
    leaveYes.className = "btn attack-end__leave-yes";
    leaveYes.textContent = "Leave";
    leaveYes.addEventListener("click", () => this.options.onLeave());
    const leaveNo = document.createElement("button");
    leaveNo.type = "button";
    leaveNo.className = "btn btn--ghost attack-end__leave-no";
    leaveNo.textContent = "Keep the result";
    leaveNo.addEventListener("click", () => this.hideLeave());
    this.leaveConfirm.append(leaveText, leaveNo, leaveYes);

    const actions = document.createElement("div");
    actions.className = "attack-end__actions";
    actions.append(this.leaveButton, this.retryButton, this.returnButton);

    this.panel.setContent(
      outcome,
      reason,
      stats,
      loot,
      this.status,
      this.protection,
      this.leaveConfirm,
      actions,
    );
    this.element.append(this.panel.element);
  }

  /** The save's state as shown, for the plugin and the tests. */
  get saveStatus(): EndAttackSaveStatus {
    return this.status_;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    this.focusPrimary();
    return this;
  }

  close(): void {
    this.panel.close();
    this.element.remove();
  }

  /** Back to "Saving…", for a retry. */
  setSaving(): void {
    this.status_ = "saving";
    this.setStatus("saving", "Saving the result…");
    this.retryButton.hidden = true;
    this.leaveButton.hidden = true;
    this.hideLeave();
    this.returnButton.disabled = true;
  }

  /** The server has the result; Return to map opens. */
  setSaved(info: SavedInfo = {}): void {
    this.status_ = "saved";
    this.setStatus("saved", "Result saved.");
    this.retryButton.hidden = true;
    this.leaveButton.hidden = true;
    this.hideLeave();
    this.returnButton.disabled = false;

    const now = info.now ?? Date.now() / 1000;
    const until = info.protectedUntil ?? 0;
    if (until > now) {
      this.protection.textContent =
        `${this.options.summary.targetName} is now under damage protection for ` +
        `${formatSpan(until - now)}.`;
      this.protection.hidden = false;
    } else {
      this.protection.hidden = true;
    }
    this.focusPrimary();
  }

  /** The save failed: say why, offer Retry when it could help, and a way out. */
  setFailed(failure: SaveFailure): void {
    this.status_ = "failed";
    this.setStatus("failed", failure.message);
    this.retryButton.hidden = !failure.canRetry;
    this.leaveButton.hidden = false;
    this.returnButton.disabled = true;
    this.focusPrimary();
  }

  private setStatus(kind: EndAttackSaveStatus, text: string): void {
    this.status.className = `attack-end__status attack-end__status--${kind}`;
    this.statusText.textContent = text;
  }

  private askLeave(): void {
    this.leaveConfirm.hidden = false;
    this.leaveButton.hidden = true;
    this.leaveConfirm.querySelector<HTMLElement>(".attack-end__leave-no")?.focus();
  }

  private hideLeave(): void {
    this.leaveConfirm.hidden = true;
    if (this.status_ === "failed") this.leaveButton.hidden = false;
  }

  private focusPrimary(): void {
    const target = !this.returnButton.disabled
      ? this.returnButton
      : !this.retryButton.hidden
        ? this.retryButton
        : !this.leaveButton.hidden
          ? this.leaveButton
          : null;
    target?.focus();
  }
}
