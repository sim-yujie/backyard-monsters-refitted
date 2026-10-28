import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { AttackSummary, OutcomeTone } from "@/game/attack/attackSave";
import type { ResourceAmounts } from "@/game/combat/rules";
import { championName } from "@/ui/attack/ArmyPanel";
import { formatAmount } from "@/ui/format";
import { RESOURCE_KEYS, resourceAmount, resourceName, type ResourceRealm } from "@/ui/resourceIcon";
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
  /** The return button's words, when it does not go to the map: Moloch's Descent goes home. */
  readonly returnLabel?: string;
  /**
   * A second way out beside the return, open when it is: a Moloch tribe
   * attack's Return Home to the Inferno yard, its return being the Inferno
   * map (Inferno WP 2.10).
   */
  readonly home?: { readonly label: string; readonly onHome: () => void };
  /** Send the save again. */
  readonly onRetry: () => void;
  /** Leave with the result unsaved; called only after the second confirmation. */
  readonly onLeave: () => void;
}

/** Where the save stands, as the panel shows it. */
/** `unsent`: the player never acted, so there is nothing to save (#79). */
export type EndAttackSaveStatus = "saving" | "saved" | "failed" | "unsent" | "pending";

export interface SaveFailure {
  readonly message: string;
  /** False when a retry cannot succeed (the attack expired); Retry is hidden. */
  readonly canRetry: boolean;
}

export interface SavedInfo {
  /** What the server banked of the loot (`lootcredited`), when it said. */
  readonly credited?: ResourceAmounts | null;
  /**
   * What the battle took, when the server says and it can be more than was
   * banked: a Moloch tribe's loot the Inferno purse had no room for (WP 2.10).
   */
  readonly taken?: ResourceAmounts | null;
  /** The result as the server landed it, when it has its own (a Moloch tribe's Under Hall, WP 2.10). */
  readonly result?: { readonly title: string; readonly outcome: string; readonly tone: OutcomeTone } | null;
  /** Unix seconds when the target is back, for a Moloch tribe left wrecked (WP 2.10). */
  readonly backAt?: number | null;
  /** Unix seconds until which the defender is now protected, if the server said so. */
  readonly protectedUntil?: number | null;
  /** Unix seconds now, for the protection line. */
  readonly now?: number;
}

/** `Nh Nm` for a span of seconds; the protection line's spelling. */
export const formatSpan = (seconds: number): string => {
  // Rounded to the minute before splitting, so 7 h 59 min 59 s reads "8 h", not "7 h 60 min".
  const totalMinutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${Math.max(1, minutes)} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
};

/**
 * The monsters line: those that died of those sent, and of those born on the
 * field when any were, so the first figure never tops the second. Champions
 * have their own line ({@link championsText}).
 */
export const monstersLostText = (
  summary: Pick<AttackSummary, "monstersSent" | "monstersBorn" | "monstersLost">,
): string => {
  const { monstersSent: sent, monstersBorn: born, monstersLost: lost } = summary;
  if (sent + born === 0) return "None sent";
  return born === 0 ? `${lost} of ${sent} sent` : `${lost} of ${sent + born} (${sent} sent, ${born} born in the fight)`;
};

/**
 * Each champion sent, as Flash's attack log put one beaten: "Level 2 Gorgo
 * retreated." (`ChampionBase.as:783`), at no health; otherwise the health it
 * came back with.
 */
export const championsText = (summary: Pick<AttackSummary, "champions">): string =>
  summary.champions
    .map(({ t, l, hp }) => {
      const champion = `Level ${l} ${championName(t)}`;
      const left = Math.max(0, Math.floor(hp));
      return left === 0 ? `${champion} retreated` : `${champion}, ${left.toLocaleString("en-US")} health left`;
    })
    .join("; ");

const endReasonText = (summary: AttackSummary): string => {
  // A tribe's Flash line already says what fell (WP 2.10).
  if (summary.infernoTribe && summary.endReason === "destroyed") return "";
  switch (summary.endReason) {
    case "destroyed":
      // The session also ends here when only walls, traps and the like are
      // left, which is short of 100% (#152).
      return summary.damagePercent >= 100
        ? "The yard was destroyed."
        : "Nothing your monsters could attack was left standing.";
    case "exhausted":
      return "Nothing was left to send.";
    case "expired":
      return "Time ran out.";
    case "retreat":
      return "You retreated.";
    case "left":
      return "You left the attack, so it ended there.";
    default:
      return "";
  }
};

export class EndAttackPanel {
  readonly element: HTMLElement;
  readonly panel: Panel;

  private readonly outcome: HTMLElement;
  private readonly loot: HTMLElement;
  private readonly storageNote: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly protection: HTMLElement;
  private readonly returnButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly leaveButton: HTMLButtonElement;
  private readonly homeButton: HTMLButtonElement | null;
  private readonly leaveConfirm: HTMLElement;
  /** Repeats this attack at once (issue #221); shown once the result is saved. */
  private readonly againButton: HTMLButtonElement;
  private again: (() => void) | null = null;
  private readonly actions: HTMLElement;
  /** A section hosted above the actions: the takeover offer (issue #82). */
  private extra: HTMLElement | null = null;
  private readonly options: EndAttackPanelOptions;
  private status_: EndAttackSaveStatus = "saving";

  constructor(options: EndAttackPanelOptions) {
    this.options = options;
    const { summary } = options;

    this.element = document.createElement("div");
    this.element.className = "popup-backdrop attack-end__backdrop";

    this.panel = new Panel({
      title: summary.title ?? "Attack over",
      closable: false,
      className: `map-panel attack-end attack-end--${summary.tone}`,
    });
    this.panel.element.setAttribute("role", "dialog");
    this.panel.element.setAttribute("aria-modal", "true");

    const outcome = document.createElement("p");
    outcome.className = "attack-end__outcome";
    outcome.textContent = summary.outcome;
    this.outcome = outcome;

    const reason = document.createElement("p");
    reason.className = "u-muted attack-end__reason";
    reason.textContent = endReasonText(summary);
    reason.hidden = reason.textContent === "";

    const stats = document.createElement("dl");
    stats.className = "attack-end__stats";
    const stat = (label: string, value: string): void => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      stats.append(dt, dd);
    };
    stat("Damage", `${Math.floor(summary.damagePercent)}%`);
    stat("Buildings destroyed", `${summary.buildingsDestroyed} of ${summary.buildingsTotal}`);
    stat("Monsters lost", monstersLostText(summary));
    if (summary.champions.length > 0) {
      stat(summary.champions.length === 1 ? "Champion" : "Champions", championsText(summary));
    }

    this.loot = document.createElement("ul");
    this.loot.className = "attack-end__loot";
    this.loot.setAttribute("aria-label", "Loot kept");
    this.storageNote = document.createElement("p");
    this.storageNote.className = "u-muted attack-end__storage";
    this.showLoot(summary.loot);

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
    tutTarget(this.returnButton, TutTarget.ATTACK_HOME);
    this.returnButton.textContent = options.returnLabel ?? "Return to map";
    this.returnButton.disabled = true;
    this.returnButton.addEventListener("click", () => {
      if (this.status_ === "saved" || this.status_ === "unsent") this.options.onReturn();
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

    this.againButton = document.createElement("button");
    this.againButton.type = "button";
    this.againButton.className = "btn btn--ghost attack-end__again";
    this.againButton.textContent = "Attack again";
    this.againButton.title = "Repeat this attack on this camp now, resolved at once";
    this.againButton.hidden = true;
    this.againButton.addEventListener("click", () => this.again?.());

    this.homeButton = null;
    if (options.home) {
      const home = options.home;
      this.homeButton = document.createElement("button");
      this.homeButton.type = "button";
      this.homeButton.className = "btn btn--ghost attack-end__home";
      this.homeButton.textContent = home.label;
      this.homeButton.disabled = true;
      this.homeButton.addEventListener("click", () => {
        if (this.canLeave()) home.onHome();
      });
    }

    const actions = document.createElement("div");
    actions.className = "attack-end__actions";
    actions.append(this.leaveButton, this.retryButton, this.againButton);
    if (this.homeButton) actions.append(this.homeButton);
    actions.append(this.returnButton);
    this.actions = actions;

    this.panel.setContent(
      outcome,
      reason,
      stats,
      this.loot,
      this.storageNote,
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

  /**
   * Shows a section of its own above the actions, or removes it with null:
   * the takeover offer after a destroyed camp or outpost (issue #82). The
   * panel does not look inside it.
   */
  setExtra(node: HTMLElement | null): void {
    if (this.extra === node) return;
    this.extra?.remove();
    this.extra = node;
    if (node) this.actions.before(node);
  }

  /**
   * Offers Attack again (issue #221): this attack, repeated by the server at
   * once. Shown only while the result is saved, since the repeat is the attack
   * the server recorded from it. Null takes it away.
   */
  setAttackAgain(run: (() => void) | null): void {
    this.again = run;
    this.againButton.hidden = run === null || this.status_ !== "saved";
  }

  /** Back to "Saving…", for a retry. */
  setSaving(): void {
    this.status_ = "saving";
    this.setStatus("saving", "Saving the result…");
    this.retryButton.hidden = true;
    this.leaveButton.hidden = true;
    this.hideLeave();
    this.setReturnOpen(false);
  }

  /** The server has the result; Return to map opens. */
  setSaved(info: SavedInfo = {}): void {
    if (info.credited) this.showLoot(info.credited, info.taken ?? null);
    if (info.result) {
      this.panel.setTitle(info.result.title);
      this.outcome.textContent = info.result.outcome;
      this.panel.element.classList.remove("attack-end--win", "attack-end--lose", "attack-end--neutral");
      this.panel.element.classList.add(`attack-end--${info.result.tone}`);
    }
    this.status_ = "saved";
    this.setStatus("saved", "Result saved.");
    this.retryButton.hidden = true;
    this.leaveButton.hidden = true;
    this.hideLeave();
    this.setReturnOpen(true);
    this.againButton.hidden = this.again === null;

    const now = info.now ?? Date.now() / 1000;
    const until = info.protectedUntil ?? 0;
    const backAt = info.backAt ?? 0;
    if (until > now) {
      this.protection.textContent =
        `${this.options.summary.targetName} is now under damage protection for ` +
        `${formatSpan(until - now)}.`;
      this.protection.hidden = false;
    } else if (backAt > now) {
      // A wrecked Moloch tribe's comeback (WP 2.10): the map shows the rest.
      this.protection.textContent = `${this.options.summary.targetName} will be back in ${formatSpan(backAt - now)}.`;
      this.protection.hidden = false;
    } else {
      this.protection.hidden = true;
    }
    this.focusPrimary();
  }

  /**
   * Nothing was sent, so nothing is saved and Return to map opens at once
   * (#79): an attack the player never touched leaves no trace on either yard.
   */
  setNothingSent(): void {
    this.status_ = "unsent";
    this.setStatus("unsent", "Nothing was sent, so there was nothing to save.");
    this.retryButton.hidden = true;
    this.leaveButton.hidden = true;
    this.hideLeave();
    this.setReturnOpen(true);
    this.protection.hidden = true;
    this.focusPrimary();
  }

  /**
   * The server took the result but is still working it out (issue #23: its
   * replay ran past the save's deadline). Not a failure: it lands without the
   * player, so Return to map opens and there is nothing to retry.
   */
  setPending(message: string): void {
    this.status_ = "pending";
    this.setStatus("pending", message);
    this.retryButton.hidden = true;
    this.leaveButton.hidden = true;
    this.hideLeave();
    this.setReturnOpen(true);
    this.protection.hidden = true;
    this.focusPrimary();
  }

  /** The save failed: say why, offer Retry when it could help, and a way out. */
  setFailed(failure: SaveFailure): void {
    this.status_ = "failed";
    this.setStatus("failed", failure.message);
    this.retryButton.hidden = !failure.canRetry;
    this.leaveButton.hidden = false;
    this.setReturnOpen(false);
    this.focusPrimary();
  }

  /**
   * The loot the attacker keeps, per resource, and a note when some of what
   * the battle took did not fit in their storage (issue #166). Flash banked
   * only what fit without saying so (`ATTACK.as:703-710`); the note is the
   * one line that explains a figure below the battle's.
   *
   * An Inferno fight's loot is Bone, Coal, Sulfur and Magma, drawn so though
   * the attack screen shows the surface's. A Descent's goes to the Inferno
   * purse in full, so it has no such note (Inferno WP 1.13); a Moloch
   * tribe's stops at the purse's caps (`ATTACK.as:703-708`), and the
   * server's `taken` says what the battle took (WP 2.10).
   */
  private showLoot(kept: ResourceAmounts, takenByServer: ResourceAmounts | null = null): void {
    const whole = (value: number): string => Math.floor(value).toLocaleString("en-US");
    const { lootTaken, inferno } = this.options.summary;
    const realm: ResourceRealm = inferno ? "inferno" : "surface";
    let spilled = false;
    this.loot.replaceChildren();
    for (const key of RESOURCE_KEYS) {
      const item = document.createElement("li");
      const amount = kept[key];
      const taken = inferno ? Math.max(amount, takenByServer?.[key] ?? 0) : Math.max(amount, lootTaken[key]);
      const name = resourceName(key, realm);
      item.className = `attack-end__loot-item${amount > 0 ? "" : " attack-end__loot-item--none"}`;
      item.append(resourceAmount(key, formatAmount(amount), { realm }));
      const lost = Math.floor(taken) > Math.floor(amount);
      item.title = lost
        ? `${name}: ${whole(amount)} of ${whole(taken)} taken; the rest did not fit in your storage`
        : `${name}: ${whole(amount)}`;
      if (lost) spilled = true;
      this.loot.append(item);
    }
    const storage = inferno ? "Your Inferno storage" : "Your storage";
    this.storageNote.textContent = spilled ? `${storage} was full, so some loot was lost.` : "";
    this.storageNote.hidden = !spilled;
  }

  /** Opens or shuts the ways out: the return, and the second one when there is one. */
  private setReturnOpen(open: boolean): void {
    this.returnButton.disabled = !open;
    if (this.homeButton) this.homeButton.disabled = !open;
  }

  /** The return's own rule: the result is saved, or there was nothing to save. */
  private canLeave(): boolean {
    return this.status_ === "saved" || this.status_ === "unsent";
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
