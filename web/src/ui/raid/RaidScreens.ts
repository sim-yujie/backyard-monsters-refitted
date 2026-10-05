import type { RaidPreference, RaidResult } from "@/api/raid";
import type { RaidAftermathView } from "@/game/raid/raidAftermath";
import {
  ALERT_TITLE,
  FREQUENCY_CHOICES,
  FREQUENCY_TITLE,
  POOR_DEFENCE,
  READY_NOW,
  SPOTTED_TITLE,
  alertMonsters,
  anyStolen,
  goodDefenceText,
  healthText,
  raidTribe,
  raiderCount,
  tribeTitle,
} from "@/game/raid/raidText";
import { raidCountdownText, type RaidBusy, type RaidStage, type RaidYardView } from "@/game/raid/raidYardFlow";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { RESOURCE_KEYS, resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/raid.css";

/**
 * The raid's screens on the own yard (issue #226 WP4,
 * `docs/design/wild-raids.md` §4.3): the WILD MONSTER ALERT, the top bar's
 * "WILD MONSTERS SPOTTED!", the lock while a raid is fought elsewhere, and,
 * after a fight, the result and the frequency popups. The pictures are
 * Flash's own: the tribe's splash and the monsters' portraits.
 */

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

/** The tribe's splash art. */
const splash = (tribe: string, className: string): HTMLImageElement => {
  const image = element("img", className);
  image.src = raidTribe(tribe).splash;
  image.alt = tribeTitle(tribe);
  image.decoding = "async";
  return image;
};

/* ── The alert ─────────────────────────────────────────────────────────── */

export interface RaidAlertActions {
  readonly onEngage: () => void;
  readonly onPrepare: () => void;
}

/**
 * The WILD MONSTER ALERT (`AIATTACKPOPUP.as`): the tribe, up to three of its
 * monster types, the time left, and "Engage now" or "Prepare defences".
 * Neither Escape nor the scrim closes it (D6): the player must answer.
 */
export class RaidAlert {
  readonly popup: Popup;
  private readonly eta: HTMLElement;
  private readonly engage: HTMLButtonElement;
  private readonly prepare: HTMLButtonElement;
  readonly raidId: string;

  constructor(raid: { readonly id: string; readonly tribe: string; readonly monsters: Readonly<Record<string, number>> }, actions: RaidAlertActions) {
    this.raidId = raid.id;
    this.popup = new Popup({ title: ALERT_TITLE, className: "raid-alert", dismissable: false });

    const head = element("div", "raid-alert__head");
    const words = element("div", "raid-alert__words");
    words.append(
      element("p", "raid-alert__tribe", tribeTitle(raid.tribe)),
      element("p", "raid-alert__lead", `${raiderCount(raid.monsters)} wild monsters are coming for your yard!`),
    );
    this.eta = element("p", "raid-alert__eta");
    this.eta.setAttribute("role", "timer");
    words.append(this.eta);
    head.append(splash(raid.tribe, "raid-alert__splash"), words);

    const list = element("ul", "raid-alert__monsters");
    list.setAttribute("aria-label", "Monsters in the attack");
    for (const monster of alertMonsters(raid.monsters)) {
      const item = element("li", "raid-alert__monster");
      const picture = element("img", "raid-alert__portrait");
      picture.alt = "";
      picture.src = monster.picture;
      picture.addEventListener("error", () => (picture.src = monster.fallback), { once: true });
      item.append(picture, element("span", "raid-alert__name", monster.name), element("span", "raid-alert__count", `×${monster.count}`));
      list.append(item);
    }

    const buttons = element("div", "raid-alert__actions");
    this.prepare = button("Prepare defences", "btn btn--ghost raid-alert__prepare", actions.onPrepare);
    this.prepare.title = "Get ready: they arrive when the countdown runs out.";
    this.engage = button("Engage now", "btn btn--primary raid-alert__engage", actions.onEngage);
    this.engage.title = "Bring the attack on now.";
    buttons.append(this.prepare, this.engage);

    this.popup.setContent(head, list, buttons);
  }

  mount(host: HTMLElement): this {
    this.popup.mount(host);
    return this;
  }

  update(secondsLeft: number, busy: RaidBusy): void {
    this.eta.textContent = `ETA: ${raidCountdownText(secondsLeft)}`;
    this.engage.disabled = busy !== null;
    this.prepare.disabled = busy !== null;
    this.engage.textContent = busy === "engage" ? "Engaging…" : "Engage now";
  }

  close(): void {
    this.popup.close();
  }
}

/* ── The top bar ───────────────────────────────────────────────────────── */

/** What the top bar says under its title. */
export const spottedLine = (stage: RaidStage): string => {
  if (stage.kind === "spotted") return `They attack in ${raidCountdownText(stage.secondsLeft)}`;
  if (stage.kind === "due") {
    return stage.planner ? "They attack as soon as you close the Yard Planner." : "Here they come!";
  }
  return "";
};

/**
 * "WILD MONSTERS SPOTTED!" (`WMATTACK.as:307-324`): the countdown to the
 * fight after "Prepare defences", with Flash's "I'm Ready Now".
 */
export class RaidBar {
  readonly element: HTMLElement;
  private readonly line: HTMLElement;
  private readonly ready: HTMLButtonElement;

  constructor(onReady: () => void) {
    this.element = element("section", "raid-bar");
    this.element.setAttribute("role", "status");
    const words = element("div", "raid-bar__words");
    this.line = element("p", "raid-bar__line");
    words.append(element("p", "raid-bar__title", SPOTTED_TITLE), this.line);
    this.ready = button(READY_NOW, "btn btn--primary raid-bar__ready", onReady);
    this.element.append(words, this.ready);
  }

  update(stage: RaidStage, busy: RaidBusy): void {
    this.line.textContent = spottedLine(stage);
    this.ready.hidden = stage.kind !== "spotted";
    this.ready.disabled = busy !== null;
  }
}

/* ── The lock ──────────────────────────────────────────────────────────── */

/**
 * The yard while the server says a raid is being fought on it and this
 * screen is not playing it (another tab, or a lost fight): every yard action
 * is refused until it is over, so nothing is offered. The map stays open.
 */
export class RaidLock {
  readonly element: HTMLElement;

  constructor(tribe: string, onMap: () => void) {
    this.element = element("div", "yard-attack-lock raid-lock");
    const banner = element("section", "yard-attack-lock__banner");
    banner.setAttribute("role", "alert");
    const actions = element("div", "yard-attack-lock__actions");
    actions.append(button("Open the map", "btn btn--ghost", onMap));
    banner.append(
      element("h2", "yard-attack-lock__title", `The ${raidTribe(tribe).name} Tribe is raiding your yard!`),
      element("p", "", "Your yard opens again when the raid is over."),
      actions,
    );
    this.element.append(banner);
  }
}

/* ── The stage on screen ───────────────────────────────────────────────── */

export interface RaidYardUiOptions {
  /** The overlay's modal layer: the alert and the lock. */
  readonly modal: HTMLElement;
  /** The overlay's content layer: the top bar. */
  readonly content: HTMLElement;
  readonly onEngage: () => void;
  readonly onPrepare: () => void;
  readonly onMap: () => void;
  /** A short line in the yard's notices. */
  readonly notice: (message: string) => void;
}

/** Draws a {@link RaidStage}: one of the alert, the top bar or the lock, or nothing. */
export class RaidYardUi implements RaidYardView {
  private alert: RaidAlert | null = null;
  private bar: RaidBar | null = null;
  private lock: RaidLock | null = null;

  constructor(private readonly options: RaidYardUiOptions) {}

  render(stage: RaidStage, busy: RaidBusy): void {
    if (stage.kind === "alert") {
      if (this.alert && this.alert.raidId !== stage.raid.id) this.closeAlert();
      this.alert ??= new RaidAlert(stage.raid, {
        onEngage: this.options.onEngage,
        onPrepare: this.options.onPrepare,
      }).mount(this.options.modal);
      this.alert.update(stage.secondsLeft, busy);
    } else {
      this.closeAlert();
    }

    if (stage.kind === "spotted" || stage.kind === "due") {
      if (!this.bar) {
        this.bar = new RaidBar(this.options.onEngage);
        this.options.content.append(this.bar.element);
      }
      this.bar.update(stage, busy);
    } else {
      this.bar?.element.remove();
      this.bar = null;
    }

    if (stage.kind === "locked") {
      if (!this.lock) {
        this.lock = new RaidLock(stage.raid.tribe, this.options.onMap);
        this.options.modal.append(this.lock.element);
      }
    } else {
      this.lock?.element.remove();
      this.lock = null;
    }
  }

  notice(message: string): void {
    this.options.notice(message);
  }

  destroy(): void {
    this.render({ kind: "none" }, null);
  }

  private closeAlert(): void {
    this.alert?.close();
    this.alert = null;
  }
}

/* ── After the fight ───────────────────────────────────────────────────── */

/** Repair now (`FIX`) as the result popup offers it, or absent when nothing is damaged. */
export interface RaidRepairOffer {
  readonly price: number;
  /** Not enough Shiny, or another reason it cannot be bought; null when it can. */
  readonly blocked: string | null;
  /** Buys it; resolves with a refusal's message, or null once done. */
  readonly buy: () => Promise<string | null>;
}

/**
 * The result (`ATTACK.as:1006-1090`): "well defended" with the +10 Shiny it
 * paid, or the poor defence's lines with what the raiders took and Repair
 * now. Every damaged building is repairing already (D3).
 */
export const raidResultPopup = (result: RaidResult, repair: RaidRepairOffer | null, onClose: () => void): Popup => {
  const popup = new Popup({
    title: result.defended ? "Yard defended!" : POOR_DEFENCE.title,
    className: `raid-result raid-result--${result.defended ? "good" : "poor"}`,
    onClose,
  });

  const head = element("div", "raid-result__head");
  const words = element("div", "raid-result__words");
  if (result.defended) {
    words.append(element("p", "raid-result__lead", goodDefenceText(result.tribe)));
  } else {
    words.append(element("p", "raid-result__lead", POOR_DEFENCE.line), element("p", "raid-result__advice", POOR_DEFENCE.advice));
  }
  words.append(element("p", "raid-result__health", `Your yard held at ${healthText(result.health)}.`));
  head.append(splash(result.tribe, "raid-result__splash"), words);
  const parts: HTMLElement[] = [head];

  if (result.shiny > 0) {
    const reward = element("p", "raid-result__reward");
    reward.append("Reward: ", resourceAmount("shiny", `+${formatAmount(result.shiny)}`));
    parts.push(reward);
  }
  if (anyStolen(result)) {
    const stolen = element("div", "raid-result__stolen");
    const list = element("span", "res-list");
    for (const key of RESOURCE_KEYS) {
      if (result.stolen[key] > 0) list.append(resourceAmount(key, formatAmount(result.stolen[key])));
    }
    stolen.append(element("span", "raid-result__label", "The raiders took"), list);
    parts.push(stolen);
  }
  const damaged = result.damaged.length;
  if (damaged > 0) {
    parts.push(
      element(
        "p",
        "raid-result__note",
        `${damaged} damaged ${damaged === 1 ? "building is" : "buildings are"} repairing now.`,
      ),
    );
  }
  if (result.housedLost > 0) {
    parts.push(
      element(
        "p",
        "raid-result__note",
        `${result.housedLost} housed ${result.housedLost === 1 ? "monster was" : "monsters were"} lost with a fallen Housing.`,
      ),
    );
  }

  const status = element("p", "raid-result__status");
  status.hidden = true;
  status.setAttribute("role", "status");
  const actions = element("div", "raid-result__actions");
  if (repair && !result.defended) {
    const fix = element("button", "btn raid-result__repair");
    fix.type = "button";
    fix.append("Repair now ", resourceAmount("shiny", formatAmount(repair.price)));
    fix.title = repair.blocked ?? "Every damaged building back to full health at once.";
    fix.disabled = repair.blocked !== null;
    fix.addEventListener("click", () => {
      fix.disabled = true;
      void repair.buy().then((refused) => {
        if (refused === null) {
          popup.close();
          return;
        }
        status.hidden = false;
        status.textContent = refused;
        fix.disabled = false;
      });
    });
    actions.append(fix);
  }
  actions.append(button("OK", "btn btn--primary raid-result__ok", () => popup.close()));
  parts.push(status, actions);
  popup.setContent(...parts);
  return popup;
};

/**
 * The frequency popup (`ai_settings_*`): the tribe's taunt and Flash's three
 * answers. Closing it keeps the last choice.
 */
export const raidFrequencyPopup = (tribe: string, onAnswer: (preference: RaidPreference | null) => void): Popup => {
  let answered = false;
  const popup = new Popup({
    title: FREQUENCY_TITLE,
    className: "raid-frequency",
    onClose: () => {
      if (!answered) onAnswer(null);
    },
  });
  const head = element("div", "raid-result__head");
  const words = element("div", "raid-result__words");
  words.append(
    element("p", "raid-frequency__taunt", `“${raidTribe(tribe).taunt}”`),
    element("p", "raid-result__advice", "How often should the wild monsters come back?"),
  );
  head.append(splash(tribe, "raid-result__splash"), words);
  const choices = element("div", "raid-frequency__choices");
  for (const choice of FREQUENCY_CHOICES) {
    const option = element("button", `btn raid-frequency__choice raid-frequency__choice--${choice.preference}`);
    option.type = "button";
    option.append(element("span", "raid-frequency__label", choice.label), element("span", "raid-frequency__hint", choice.hint));
    option.addEventListener("click", () => {
      answered = true;
      onAnswer(choice.preference);
      popup.close();
    });
    choices.append(option);
  }
  popup.setContent(head, choices);
  return popup;
};

/** The aftermath's popups on a host (`runRaidAftermath`). */
export const raidAftermathView = (
  host: HTMLElement,
  repair: () => RaidRepairOffer | null,
  notice: (message: string) => void,
): RaidAftermathView => ({
  result: (result) =>
    new Promise<void>((resolve) => {
      raidResultPopup(result, repair(), resolve).mount(host);
    }),
  frequency: (tribe) =>
    new Promise<RaidPreference | null>((resolve) => {
      raidFrequencyPopup(tribe, resolve).mount(host);
    }),
  notice,
});
