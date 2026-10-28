import type { YardRefusal } from "@/api/yard";
import { ChampionKey, championActions, type ChampionActions } from "@/api/yardChampion";
import { buttonUrl } from "@/game/yard/buildButtonArt";
import {
  CHAMPION_CAGE_TYPE,
  CHAMPION_CHAMBER_TYPE,
  chamberView,
  championPicture,
  freezeGate,
  freezeProblem,
  thawGate,
  thawProblem,
  type ChamberView,
  type ChampionStats,
  type ChampionView,
  type FrozenView,
  type ThawProblem,
} from "@/game/yard/championModel";
import { showPortrait } from "@/game/portraits";
import type { ChampionEntry } from "@/game/yard/championCatalogue";
import type { YardStore } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { gameIcon } from "@/ui/gameIcon";
import "@/ui/styles/champion.css";
import { FREEZE_SHORT, actHint, actTile } from "./ChampionPanel";

/**
 * The Champion Chamber's window, the first tab of its building panel
 * (`docs/design/yard-buildings.md` §7.2; issue #125). A built chamber opens
 * straight on it (owner, 28 Oct: one click, like the cage).
 *
 * Like the original's chamber popup (`client/scripts/CHAMPIONCHAMBERPOPUP.as:42-110`),
 * every champion is a card with its big picture, name and level: the one in
 * the cage with **Freeze**, each frozen one, iced over, with **Thaw**. Flash
 * showed the stats of the champion under the pointer; here each card carries
 * its own as icon chips. Both actions are free and can be undone, so each is
 * one tap; a locked one says what it needs in a few words, the whole reason
 * on hover or, on a phone, on tap.
 */

type Status = { readonly tone: "good" | "bad"; readonly content: string };

export interface ChamberPanelOptions {
  readonly store: YardStore;
  /** The routes; `championActions(store)` unless a test swaps them. */
  readonly actions?: ChampionActions;
}

/** The few words under a locked Thaw; the hover keeps {@link thawGate}'s sentence. */
export const THAW_SHORT: Readonly<Record<ThawProblem, string>> = {
  noChamber: "Needs a Chamber",
  chamberBuilding: "Chamber being built",
  damaged: "Repair the Chamber",
  noCage: "Needs a Cage",
  cageBuilding: "Cage being built",
  cageFull: "Cage is full",
  egg: "Egg in the cage",
};

export class ChamberPanel {
  readonly element: HTMLElement;

  private readonly store: YardStore;
  private readonly actions: ChampionActions;
  private readonly status: HTMLElement;
  private readonly body: HTMLElement;
  private shape = "";
  private freezeButton: HTMLButtonElement | null = null;
  private thawButtons = new Map<number, HTMLButtonElement>();
  /** The caged champion's "fed for" countdown, redrawn each tick. */
  private fedClock: { readonly node: HTMLElement; readonly endsAt: number } | null = null;

  constructor(options: ChamberPanelOptions) {
    this.store = options.store;
    this.actions = options.actions ?? championActions(options.store);

    this.element = document.createElement("section");
    this.element.className = "champion chamber";
    this.element.setAttribute("aria-label", "Champion Chamber");

    this.status = document.createElement("p");
    this.status.className = "champion__status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.body = document.createElement("div");
    this.body.className = "champion__body";
    this.element.append(this.status, this.body);
  }

  /** Redraws from the store: called on open and on every yard change. */
  show(): void {
    const view = chamberView(this.store.save, this.store.now());
    this.shape = shapeOf(view);
    this.freezeButton = null;
    this.thawButtons.clear();
    this.fedClock = null;

    if (view.kind === "noChamber") {
      this.body.replaceChildren(note("This Champion Chamber is gone."));
    } else if (view.kind === "building") {
      this.body.replaceChildren(emptyBlock("The chamber takes champions once it is built.", this.store));
    } else if (!view.active && view.frozen.length === 0) {
      this.body.replaceChildren(emptyBlock("No champion on ice yet. Freeze one from its cage.", this.store));
    } else {
      const list = document.createElement("ul");
      list.className = "chamber__cards";
      list.setAttribute("aria-label", "Champions");
      if (view.active) list.append(this.activeCard(view.active));
      for (const frozen of view.frozen) list.append(this.frozenCard(frozen, view));
      // Flash's long sentence, cut to what a frozen champion keeps.
      this.body.replaceChildren(list, note("Frozen champions keep their level and do not get hungry."));
    }
    this.syncPending();
  }

  /** Once a second: the caged champion's clock, and a redraw when what can be pressed has changed. */
  tick(): void {
    const now = this.store.now();
    if (shapeOf(chamberView(this.store.save, now)) !== this.shape) {
      this.show();
      return;
    }
    if (this.fedClock) this.fedClock.node.textContent = formatCountdown(this.fedClock.endsAt - now);
  }

  /** Marks the tiles busy while one of the chamber's requests runs. */
  syncPending(): void {
    if (this.freezeButton) this.freezeButton.disabled = this.store.isRunning(ChampionKey.freeze);
    for (const [type, button] of this.thawButtons) button.disabled = this.store.isRunning(ChampionKey.thaw(type));
  }

  destroy(): void {
    this.element.remove();
  }

  /** The champion in the cage, which could go on ice (Flash's slot on its "thaw" frame). */
  private activeCard(active: ChampionView): HTMLElement {
    const card = cardShell(active.entry, active.level, active.name, "caged");
    const hungry = active.hunger !== "fed";
    const fed = hungry
      ? fedChip(null, `${active.name} is hungry.`)
      : fedChip(active.hungryAt - this.store.now(), `${active.name} stays fed for`);
    if (!hungry) this.fedClock = { node: fed.querySelector("strong")!, endsAt: active.hungryAt };
    card.append(statChips(active.stats, Math.floor(active.health), active.maxHealth), fed);
    const hint = actHint();
    const problem = freezeProblem(this.store.save, active);
    const freeze = actTile({
      act: "freeze",
      type: CHAMPION_CHAMBER_TYPE,
      kind: this.store.kind,
      word: "Freeze",
      short: problem ? FREEZE_SHORT[problem] : "Keeps its level",
      sentence: freezeGate(this.store.save, active) ?? `Freeze ${active.name}: it keeps its level and does not get hungry.`,
      locked: problem !== null,
      missing: false,
      hint,
      onPress: () => void this.run(() => this.actions.freeze(), `${active.name} is frozen.`),
    });
    this.freezeButton = freeze;
    card.append(freeze, hint);
    return card;
  }

  /** A champion on ice (Flash's slot on its "frozen" frame), with Thaw back into the cage. */
  private frozenCard(frozen: FrozenView, view: ChamberView): HTMLElement {
    const card = cardShell(frozen.entry, frozen.level, frozen.name, "frozen");
    const fed =
      frozen.fedFor > 0
        ? fedChip(frozen.fedFor, `Once thawed, ${frozen.name} stays fed for`)
        : fedChip(null, `${frozen.name} is hungry as soon as it thaws.`);
    card.append(statChips(frozen.stats, frozen.health, frozen.maxHealth), fed);
    const special = frozen.entry.kind === "special";
    const problem = thawProblem(view, special);
    const hint = actHint();
    const thaw = actTile({
      act: "thaw",
      type: CHAMPION_CAGE_TYPE,
      kind: this.store.kind,
      word: "Thaw",
      short: problem ? THAW_SHORT[problem] : "Back to the cage",
      sentence: thawGate(view, special) ?? `Thaw ${frozen.name}: it goes back into the Champion Cage.`,
      locked: problem !== null,
      missing: problem === "noCage",
      hint,
      onPress: () => void this.run(() => this.actions.thaw(frozen.entry.t), `${frozen.name} is back in the cage.`),
    });
    this.thawButtons.set(frozen.entry.t, thaw);
    card.append(thaw, hint);
    return card;
  }

  private async run(
    send: () => Promise<{ ok: true } | { ok: false; refusal: YardRefusal }>,
    done: string,
  ): Promise<void> {
    const result = await send();
    this.setStatus(result.ok ? { tone: "good", content: done } : { tone: "bad", content: refusalText(result.refusal) });
    this.show();
  }

  private setStatus(status: Status): void {
    this.status.hidden = false;
    this.status.className = `champion__status champion__status--${status.tone}`;
    this.status.textContent = status.content;
  }
}

/** What the tick compares: which tiles can be pressed. */
const shapeOf = (view: ChamberView): string => {
  if (view.kind !== "ready") return view.kind;
  return [
    view.damaged,
    view.cage,
    view.egg?.entry.id ?? "-",
    view.active ? `${view.active.entry.id}:${view.active.hunger}:${view.active.health >= view.active.maxHealth}` : "-",
    view.frozen.map((one) => one.entry.id).join(),
  ].join("|");
};

/** A card's big picture with its level badge and where it is, then its name. */
const cardShell = (entry: ChampionEntry, level: number, name: string, state: "caged" | "frozen"): HTMLElement => {
  const card = document.createElement("li");
  card.className = `chamber-card chamber-card--${state}`;
  card.dataset["champion"] = entry.id;
  const frame = document.createElement("span");
  frame.className = "chamber-card__frame";
  const image = document.createElement("img");
  image.className = "chamber-card__picture";
  showPortrait(image, championPicture(entry, level));
  image.alt = "";
  image.width = 150;
  image.height = 150;
  image.decoding = "async";
  const badge = document.createElement("span");
  badge.className = "champion__stage-level chamber-card__level";
  badge.textContent = `L${level}`;
  badge.title = `Level ${level} of ${entry.levels}`;
  const where = document.createElement("span");
  where.className = "chamber-card__where";
  where.textContent = state === "frozen" ? "Frozen" : "In cage";
  frame.append(image, badge, where);
  const title = document.createElement("strong");
  title.className = "chamber-card__name";
  title.textContent = name;
  // A renamed champion: what it is, on hover and for screen readers.
  if (name !== entry.name) title.title = entry.name;
  const spoken = document.createElement("span");
  spoken.className = "u-visually-hidden";
  spoken.textContent = `, ${name !== entry.name ? `${entry.name}, ` : ""}level ${level} of ${entry.levels}`;
  title.append(spoken);
  card.append(frame, title);
  return card;
};

/** Health, damage and speed as painted-icon chips; Buff (no icon yet) by its word, when it has one. */
const statChips = (stats: ChampionStats, health: number, maxHealth: number): HTMLElement => {
  const list = document.createElement("ul");
  list.className = "champion__stats chamber-card__stats";
  list.setAttribute("aria-label", "Stats");
  const hurt = health < maxHealth;
  const speed = String(Math.round(stats.speed * 10) / 10);
  list.append(
    chip(
      "health",
      hurt ? `Health ${formatAmount(health)} of ${formatAmount(maxHealth)}` : `Health ${formatAmount(maxHealth)}`,
      gameIcon("health", { size: 16, label: "Health", tooltip: false }),
      hurt ? `${formatAmount(health)}/${formatAmount(maxHealth)}` : formatAmount(maxHealth),
    ),
    chip(
      "damage",
      `Damage ${formatAmount(stats.damage)}`,
      gameIcon("damage", { size: 16, label: "Damage", tooltip: false }),
      formatAmount(stats.damage),
    ),
    chip("speed", `Speed ${speed}`, gameIcon("speed", { size: 16, label: "Speed", tooltip: false }), speed),
  );
  if (stats.buff > 0) list.append(chip("buff", `Buff ${stats.buff}%`, "Buff ", `${stats.buff}%`));
  return list;
};

const chip = (key: string, title: string, icon: HTMLElement | string, value: string): HTMLElement => {
  const item = document.createElement("li");
  item.className = "champion__stat";
  item.dataset["stat"] = key;
  item.title = title;
  const strong = document.createElement("strong");
  strong.textContent = value;
  item.append(icon, strong);
  return item;
};

/** How long it stays fed (the clock icon and a time), or an amber "Hungry". */
const fedChip = (seconds: number | null, sentence: string): HTMLElement => {
  const line = document.createElement("p");
  line.className = "chamber-card__fed";
  line.classList.toggle("chamber-card__fed--hungry", seconds === null);
  line.title = seconds === null ? sentence : `${sentence} ${formatCountdown(seconds)}.`;
  const spoken = document.createElement("span");
  spoken.className = "u-visually-hidden";
  spoken.textContent = seconds === null ? sentence : `${sentence} `;
  const strong = document.createElement("strong");
  strong.textContent = seconds === null ? "Hungry" : formatCountdown(seconds);
  if (seconds === null) strong.setAttribute("aria-hidden", "true");
  line.append(gameIcon("time", { size: 16, decorative: true }), spoken, strong);
  return line;
};

/** No champion to show: the chamber's own picture and one line. */
const emptyBlock = (text: string, store: YardStore): HTMLElement => {
  const block = document.createElement("div");
  block.className = "chamber__empty";
  const art = document.createElement("img");
  art.className = "chamber__empty-art";
  art.src = buttonUrl(CHAMPION_CHAMBER_TYPE, store.kind);
  art.alt = "";
  art.width = 90;
  art.height = 120;
  art.decoding = "async";
  art.draggable = false;
  block.append(art, note(text));
  return block;
};

const note = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "champion__note";
  element.textContent = text;
  return element;
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
