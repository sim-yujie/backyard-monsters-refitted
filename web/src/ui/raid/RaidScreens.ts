import type { RaidPreference, RaidResult } from "@/api/raid";
import type { RaidAftermathView } from "@/game/raid/raidAftermath";
import {
  ALERT_TITLE,
  FREQUENCY_CHOICES,
  POOR_DEFENCE,
  READY_NOW,
  SPOTTED_TITLE,
  alertMonsters,
  frequencyTitle,
  anyStolen,
  goodDefenceText,
  healthText,
  raidTribe,
  raiderCount,
  tribeTitle,
} from "@/game/raid/raidText";
import { raidCountdownText, type RaidBusy, type RaidStage, type RaidYardView } from "@/game/raid/raidYardFlow";
import { TROJAN_TRIBE } from "@/game/trojan/trojanHorse";
import { versionedArt } from "@/game/yard/retryLoad";
import { CHAMPION_PROPS, championByType } from "@/game/combat/rules";
import { championCrop, championPortrait, showPortrait } from "@/game/portraits";
import { alarmPulse } from "@/ui/alarmPulse";
import { gameIcon } from "@/ui/gameIcon";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { RESOURCE_KEYS, resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/raid.css";
import { artUrl } from "../../artUrl";

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

/** The whole horse: its body with the head and mouth cell drawn on (made from `top` + `anim` cell 0). */
export const HORSE_PICTURE = artUrl("/assets/buildings/trojanhorse/whole.1.png");

/**
 * The horse as it stands in the yard: its body with the head and mouth over
 * it. `top` alone has no mouth and the raw `anim` strip is two cut-out frames
 * (owner, 15 Nov), so `whole.1.png` is the two put together.
 */
export const horsePicture = (): string => versionedArt(HORSE_PICTURE);

/**
 * The result popup's picture: a tribe's splash, as Flash's good-defence popup
 * showed it (`ATTACK.as` `tribe.splash`), or the horse itself for a landed
 * Trojan Horse fight (`tribe: "wild"`, issue #327,
 * `docs/design/trojan-horse.md` §6), which names "the wild monsters", never
 * a tribe.
 */
const resultPicture = (tribe: string, className: string): HTMLImageElement => {
  if (tribe !== TROJAN_TRIBE) return splash(tribe, className);
  const image = element("img", className);
  image.src = horsePicture();
  image.alt = "The wild monsters";
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
 * Neither Escape nor the scrim closes it (D6): the player must answer. Its
 * border pulses with the alarm glow while it is up.
 */
/** What the alert shows of a raid: its tribe and army, and beta 10's threat, sides and champion. */
export interface RaidAlertRaid {
  readonly id: string;
  readonly tribe: string;
  readonly monsters: Readonly<Record<string, number>>;
  readonly threat?: number;
  readonly sides?: number;
  readonly champion?: { readonly t: number; readonly l: number };
}

/** The threat pill's tier: amber up to 7, red from 8 (3 sides and Zafreetis; the champion from 10), pulsing red from 15. */
export const threatTier = (threat: number): "warn" | "danger" | "extreme" =>
  threat >= 15 ? "extreme" : threat >= 8 ? "danger" : "warn";

/** What the threat pill's hint says (beta 10, `docs/design/wild-raids.md` "Beta 10 threat"). */
export const THREAT_HINT = "+1 Threat after a 90%+ defence, −1 after a loss.";

/** A champion's name from the stat table, or `G<t>`. */
const championName = (t: number): string => {
  const id = championByType(t);
  return (id && CHAMPION_PROPS[id]?.name) || `G${t}`;
};

/**
 * The champion's portrait for its card: the Champion Cage's picture
 * (painted, or the original with the Classic look on), cropped to the
 * creature. The whole frame left a level-1 Fomor a speck that read as a
 * battle sprite (owner, 27 Nov 2026).
 */
const championArt = (t: number, level: number): HTMLElement => {
  const id = `G${t}`;
  const box = element("span", "raid-alert__portrait raid-alert__art");
  const picture = element("img", "raid-alert__art-picture");
  picture.alt = "";
  picture.decoding = "async";
  showPortrait(picture, championPortrait(id, level, "card"));
  const crop = championCrop(id, level);
  if (crop) {
    box.style.setProperty("--crop-size", `${crop.size}%`);
    box.style.setProperty("--crop-x", `${crop.x}%`);
    box.style.setProperty("--crop-y", `${crop.y}%`);
  }
  box.append(picture);
  return box;
};

/**
 * The WILD MONSTER ALERT (`AIATTACKPOPUP.as`): the tribe, up to three of its
 * monster types, the time left, and "Engage now" or "Prepare defences".
 * Neither Escape nor the scrim closes it (D6): the player must answer. Its
 * border pulses with the alarm glow while it is up.
 *
 * Beta 10 (owner 27 Nov 2026; neon's direction 1 and three critique
 * rounds): under the header a row of pills, "[claw] Threat 7 (?)",
 * "[swords] 3 sides" and "[hourglass] 4:25", the first two only when there is
 * something to say (threat 1+, 2+ sides); the threat pill floats a one-line
 * hint under the row. A raid with a champion leads its card row with the
 * champion's card, framed in gold with a CHAMPION tag and an "Lv N" chip;
 * "+N more" under the cards counts the raiders they leave out.
 */
export class RaidAlert {
  readonly popup: Popup;
  private readonly eta: HTMLElement;
  private readonly engage: HTMLButtonElement;
  private readonly prepare: HTMLButtonElement;
  readonly raidId: string;

  constructor(raid: RaidAlertRaid, actions: RaidAlertActions) {
    this.raidId = raid.id;
    this.popup = new Popup({
      title: ALERT_TITLE,
      className: raid.champion ? "raid-alert raid-alert--champion" : "raid-alert",
      dismissable: false,
    });
    alarmPulse(this.popup);

    const head = element("div", "raid-alert__head");
    const words = element("div", "raid-alert__words");
    const coming = raiderCount(raid.monsters) + (raid.champion ? 1 : 0);
    words.append(
      element("p", "raid-alert__tribe", tribeTitle(raid.tribe)),
      element("p", "raid-alert__lead", `${coming} wild monsters are coming for your yard!`),
    );

    head.append(splash(raid.tribe, "raid-alert__splash"), words);

    // Beta 10: threat, sides and the time left in one full-width row (neon r1).
    const stats = element("div", "raid-alert__stats");
    const threat = raid.threat ?? 0;
    if (threat > 0) {
      const pill = element("button", `raid-alert__pill raid-alert__threat raid-alert__threat--${threatTier(threat)}`);
      pill.type = "button";
      pill.append(
        gameIcon("damage", { size: 24, decorative: true }),
        element("span", "", `Threat ${threat}`),
        element("span", "raid-alert__info", "?"),
      );
      pill.title = THREAT_HINT;
      pill.setAttribute("aria-label", `Threat ${threat}: what is this?`);
      const hint = element("p", "raid-alert__hint", THREAT_HINT);
      hint.hidden = true;
      hint.id = `raid-threat-hint-${raid.id}`;
      hint.setAttribute("role", "note");
      pill.setAttribute("aria-expanded", "false");
      pill.setAttribute("aria-controls", hint.id);
      pill.addEventListener("click", () => {
        hint.hidden = !hint.hidden;
        pill.setAttribute("aria-expanded", String(!hint.hidden));
      });
      stats.append(pill, hint);
    }
    if ((raid.sides ?? 1) > 1) {
      const sides = element("span", "raid-alert__pill raid-alert__sides");
      sides.append(gameIcon("swords", { size: 24, decorative: true }), element("span", "", `${raid.sides} sides`));
      sides.title = `They come in from ${raid.sides} sides.`;
      stats.append(sides);
    }
    const eta = element("span", "raid-alert__pill raid-alert__eta");
    eta.title = "They arrive when this runs out.";
    eta.append(gameIcon("time", { size: 24, label: "Arrives in" }));
    this.eta = element("span", "raid-alert__eta-time");
    this.eta.setAttribute("role", "timer");
    eta.append(this.eta);
    stats.append(eta);

    const list = element("ul", "raid-alert__monsters");
    list.setAttribute("aria-label", "Monsters in the attack");
    if (raid.champion) {
      list.classList.add("raid-alert__monsters--champion");
      const { t, l } = raid.champion;
      const item = element("li", "raid-alert__monster raid-alert__champion");
      item.append(
        element("span", "raid-alert__tag", "Champion"),
        championArt(t, l),
        element("span", "raid-alert__name", championName(t)),
        element("span", "raid-alert__count raid-alert__level", `Lv ${l}`),
      );
      item.title = `The tribe's champion ${championName(t)}, level ${l}, leads the raid.`;
      list.append(item);
    }
    const shown = alertMonsters(raid.monsters);
    for (const monster of shown) {
      const item = element("li", "raid-alert__monster");
      const picture = element("img", "raid-alert__portrait");
      picture.alt = "";
      picture.src = monster.picture;
      picture.addEventListener("error", () => (picture.src = monster.fallback), { once: true });
      item.append(picture, element("span", "raid-alert__name", monster.name), element("span", "raid-alert__count", `×${monster.count}`));
      list.append(item);
    }
    // The types the cards leave out, so the cards add up to the headline (neon r1).
    const more = raiderCount(raid.monsters) - shown.reduce((sum, monster) => sum + monster.count, 0);
    const moreLine = more > 0 ? element("p", "raid-alert__more", `+${more} more`) : null;

    const buttons = element("div", "raid-alert__actions");
    this.prepare = button("Prepare defences", "btn btn--ghost raid-alert__prepare", actions.onPrepare);
    this.prepare.title = "Get ready: they arrive when the countdown runs out.";
    this.engage = button("Engage now", "btn btn--primary raid-alert__engage", actions.onEngage);
    this.engage.title = "Bring the attack on now.";
    buttons.append(this.prepare, this.engage);

    this.popup.setContent(head, stats, list, ...(moreLine ? [moreLine] : []), buttons);
  }

  mount(host: HTMLElement): this {
    this.popup.mount(host);
    return this;
  }

  update(secondsLeft: number, busy: RaidBusy): void {
    this.eta.textContent = raidCountdownText(secondsLeft);
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
  head.append(resultPicture(result.tribe, "raid-result__splash"), words);
  const parts: HTMLElement[] = [head];

  if (result.shiny > 0) {
    const reward = element("p", "raid-result__reward");
    // Gains green with a plus, losses red with a minus (owner, 28 Oct).
    reward.append("Reward: ", resourceAmount("shiny", result.shiny, { change: "gain" }));
    parts.push(reward);
  }
  if (anyStolen(result)) {
    const stolen = element("div", "raid-result__stolen");
    const list = element("span", "res-list");
    for (const key of RESOURCE_KEYS) {
      if (result.stolen[key] > 0) list.append(resourceAmount(key, result.stolen[key], { change: "loss" }));
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
export const raidFrequencyPopup = (
  tribe: string,
  defended: boolean,
  onAnswer: (preference: RaidPreference | null) => void,
): Popup => {
  let answered = false;
  const popup = new Popup({
    title: frequencyTitle(defended),
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
  frequency: (tribe, defended) =>
    new Promise<RaidPreference | null>((resolve) => {
      raidFrequencyPopup(tribe, defended, resolve).mount(host);
    }),
  notice,
});
