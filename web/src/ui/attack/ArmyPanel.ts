import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { ChampionBlockReason } from "@/game/attack/AttackSession";
import type { Bucket } from "@/game/attack/bucket";
import {
  CHAMPION_PROPS,
  CHAMPION_STANCES,
  championByType,
  isChampionStance,
  monsterName,
  type ChampionStance,
} from "@/game/combat/rules";
import { championPortrait, monsterPortrait, showPortrait, type Portrait } from "@/game/portraits";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { QuantityStepper } from "@/ui/QuantityStepper";

// The row control moved to `QuantityStepper.ts`; its timings stay importable from here.
export { HOLD_DELAY_MS, HOLD_FAST_MS, HOLD_RAMP_MS, HOLD_START_MS, holdInterval, holdToRepeat } from "@/ui/QuantityStepper";

/**
 * The army panel: one row per housed monster type, the champion, and the
 * capacity bar (`docs/design/attack-flow.md` §F2, §4.2, §4.3, §4.6).
 *
 * Every row is a number box the player can type into, flanked by `-` and `+`
 * that auto-repeat and accelerate while held, with its own Fill; Fill all at
 * the top walks the rows in roster order. No slider (decided 2026-09-26).
 *
 * ## Reads the bucket, never the session
 *
 * The panel is a view of one {@link Bucket}. Every control calls a bucket
 * method and every change comes back through `bucket.subscribe`, so the rows
 * are rebuilt from the same numbers the drop input (WP4) will send. The rows
 * are built once — the roster does not change during an attack — and
 * refreshed in place, so a number box keeps its caret while the clock ticks.
 *
 * ## Hold to repeat
 *
 * Each row's `-`, number box, `+` and Fill are the shared
 * {@link QuantityStepper} (`ui/QuantityStepper.ts`), the same control the
 * Hatch tab uses: a press steps once, then repeats faster while held.
 *
 * ## After a drop
 *
 * The bucket keeps the numbers the player set. A row whose true count fell
 * below its number is greyed and says what is left; a row that ran out shows
 * 0 and is disabled (§F2 "after a drop").
 */

// The display names moved to the shared rules, whose attack report the server
// writes too (issue #23, C6); they stay importable from here.
export { MONSTER_NAMES, monsterName } from "@/game/combat/rules";

/**
 * The short reason a champion row cannot be picked, or "" when it can.
 *
 * `oneChampion` is Flash's rule that an attack takes one ordinary champion,
 * with Krallen the only one allowed alongside it (`UI_TOP.as:336-347`); the
 * note says so rather than leaving a greyed row unexplained (issue #74).
 */
export const championNote = (blocked: ChampionBlockReason | null): string => {
  switch (blocked) {
    case "hurt":
      return "Hurt";
    case "away":
      return "Away";
    case "flung":
      return "Already sent";
    case "oneChampion":
      return "One champion per attack";
    case "unknown":
    case null:
      return "";
  }
};

/** The row's hover text when the one-champion rule greys it out. */
export const ONE_CHAMPION_TITLE =
  "An attack takes one champion. Krallen is the exception and can join any other champion.";

/** What each Mode is called, and what it does, for the Mode picker (issue #220). */
export const STANCE_TEXT: Readonly<Record<ChampionStance, { label: string; title: string }>> = {
  offensive: {
    label: "Offensive",
    title: "Goes for the towers first and finishes off damaged buildings. Ignores danger.",
  },
  hybrid: {
    label: "Hybrid",
    title: "Picks the nearest loot, core building or tower, as champions always have.",
  },
  defensive: {
    label: "Defensive",
    title: "Keeps out of tower fire, stays with its monsters and skips fights it can't win.",
  },
};

/** A champion's display name from the stat table, or `G<t>`. */
export const championName = (t: number): string => {
  const id = championByType(t);
  return (id && CHAMPION_PROPS[id]?.name) || `G${t}`;
};

export interface ArmyPanelOptions {
  /**
   * Calls a champion back off the field: the champion row's Retreat button,
   * Flash's per-champion "Retreat" (`CHAMPIONBUTTON.as:98-103`, issue #222).
   * No button is shown without it.
   */
  readonly onRetreatChampion?: (t: number) => void;
  /**
   * Called when the player picks a champion's Mode (issue #220), after the
   * bucket has taken it: the place to remember it for next time.
   */
  readonly onStanceChange?: (t: number, stance: ChampionStance) => void;
  /**
   * Called whenever the panel's box changes size, for the bottom-sheet inset
   * (§4.3). Not called in a browser without `ResizeObserver`.
   */
  readonly onResize?: () => void;
}

interface Row {
  readonly id: string;
  readonly element: HTMLElement;
  readonly stepper: QuantityStepper;
  readonly input: HTMLInputElement;
  readonly note: HTMLElement;
  readonly count: HTMLElement;
}

interface ChampionRow {
  readonly t: number;
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly note: HTMLElement;
  /** Shown only while this champion is on the field (issue #222). */
  readonly retreat: HTMLButtonElement | null;
  /** Its Mode (issue #220); locked once it is on the field. */
  readonly stance: HTMLSelectElement;
}

export class ArmyPanel {
  readonly element: HTMLElement;

  private readonly bucket: Bucket;
  private readonly panel: Panel;
  private readonly meter: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly meterText: HTMLElement;
  private readonly fillAllButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly loadLastButton: HTMLButtonElement;
  private readonly rows: Row[] = [];
  private readonly champions: ChampionRow[] = [];
  private readonly hint: HTMLElement;
  private readonly unsubscribe: () => void;
  private readonly observer: ResizeObserver | null;
  private readonly radioName = `attack-champion-${Math.random().toString(36).slice(2, 9)}`;
  private readonly onRetreatChampion: ((t: number) => void) | null;
  private readonly onStanceChange: ((t: number, stance: ChampionStance) => void) | null;
  private onField: readonly number[] = [];

  constructor(bucket: Bucket, options: ArmyPanelOptions = {}) {
    this.bucket = bucket;
    this.onRetreatChampion = options.onRetreatChampion ?? null;
    this.onStanceChange = options.onStanceChange ?? null;
    this.panel = new Panel({ title: "Army", closable: false, className: "map-panel attack-army" });
    this.element = this.panel.element;

    // The capacity bar: bucket cost against the flinger's payload.
    this.meter = document.createElement("div");
    this.meter.className = "attack-army__meter";
    this.meter.setAttribute("role", "meter");
    this.meter.setAttribute("aria-label", "Flinger capacity");
    this.meter.setAttribute("aria-valuemin", "0");
    this.meterFill = document.createElement("span");
    this.meterFill.className = "attack-army__meter-fill";
    this.meterText = document.createElement("span");
    this.meterText.className = "attack-army__meter-text";
    this.meter.append(this.meterFill, this.meterText);

    // The top-level actions.
    const actions = document.createElement("div");
    actions.className = "attack-army__actions";
    this.fillAllButton = button("btn btn--primary attack-army__fill-all", "Fill all", () =>
      this.bucket.fillAll(),
    );
    this.fillAllButton.title = "Top every row up, in order, until the flinger is full";
    tutTarget(this.fillAllButton, TutTarget.FILL_ALL);
    this.clearButton = button("btn btn--ghost attack-army__clear", "Clear", () => this.bucket.clear());
    this.clearButton.title = "Empty every row and un-pick the champion";
    this.loadLastButton = button("btn btn--ghost attack-army__load-last", "Load last army", () => {
      if (!this.bucket.loadLast()) {
        this.loadLastButton.title = "No army from a previous attack was saved on this browser";
        this.loadLastButton.disabled = true;
      }
    });
    this.loadLastButton.title = "Recall the composition you sent last";
    actions.append(this.fillAllButton, this.clearButton, this.loadLastButton);

    // One row per housed type, in roster order.
    const list = document.createElement("ul");
    list.className = "attack-army__rows";
    for (const id of bucket.ids()) {
      const row = this.buildRow(id);
      this.rows.push(row);
      list.append(row.element);
    }

    // The champion: a radio group, one pick at most, un-picked by the same control.
    const champions = document.createElement("fieldset");
    champions.className = "attack-army__champions";
    const legend = document.createElement("legend");
    legend.className = "attack-army__legend";
    legend.textContent = "Champion";
    champions.append(legend);
    for (const champion of bucket.champions()) {
      const row = this.buildChampion(champion.t, champion.l, champion.hp);
      this.champions.push(row);
      champions.append(row.element);
    }
    champions.hidden = this.champions.length === 0;

    this.hint = document.createElement("p");
    this.hint.className = "attack-army__hint u-muted";

    this.panel.setContent(this.meter, actions, list, champions, this.hint);

    this.unsubscribe = bucket.subscribe(() => this.refresh());
    this.refresh();

    const onResize = options.onResize;
    if (onResize && typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => onResize());
      this.observer.observe(this.element);
    } else {
      this.observer = null;
    }
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** Stops listening and removes the panel. */
  destroy(): void {
    for (const row of this.rows) row.stepper.destroy();
    this.observer?.disconnect();
    this.unsubscribe();
    this.panel.close();
  }

  /** The number box for a row, for the tests. */
  inputFor(id: string): HTMLInputElement | null {
    return this.rows.find((row) => row.id === id)?.input ?? null;
  }

  /**
   * Which of the player's champions are on the field, by type, so their rows
   * offer Retreat (issue #222). The session's `championsOnField`.
   */
  setChampionsOnField(types: readonly number[]): void {
    const same =
      types.length === this.onField.length && types.every((t, at) => this.onField[at] === t);
    if (same) return;
    this.onField = [...types];
    this.refreshRetreat();
  }

  /** The Mode picker of a champion's row, for the tests. */
  stanceFor(t: number): HTMLSelectElement | null {
    return this.champions.find((row) => row.t === t)?.stance ?? null;
  }

  /** The Retreat button of a champion's row, for the tests. */
  retreatFor(t: number): HTMLButtonElement | null {
    return this.champions.find((row) => row.t === t)?.retreat ?? null;
  }

  /** The capacity bar's text, for the tests. */
  get capacityText(): string {
    return this.meterText.textContent ?? "";
  }

  /* ── Building ───────────────────────────────────────────────────────── */

  private buildRow(id: string): Row {
    const item = document.createElement("li");
    item.className = "attack-army__row";
    item.dataset["id"] = id;

    const icon = portrait(monsterPortrait(id, "icon"), monsterName(id));

    const label = document.createElement("span");
    label.className = "attack-army__label";
    const name = document.createElement("span");
    name.className = "attack-army__name";
    name.textContent = monsterName(id);
    const level = document.createElement("span");
    level.className = "attack-army__level";
    level.textContent = `L${this.bucket.level(id)}`;
    const count = document.createElement("span");
    count.className = "attack-army__housed u-muted";
    label.append(name, level, count);

    const stepper = new QuantityStepper({
      block: "attack-army",
      inputLabel: `${monsterName(id)} to send`,
      fewerLabel: `Fewer ${monsterName(id)}`,
      moreLabel: `More ${monsterName(id)}`,
      fillTitle: `Send as many ${monsterName(id)} as the flinger can carry`,
      value: () => this.bucket.requestedCount(id),
      set: (value) => this.bucket.setCount(id, value),
      fill: () => this.bucket.fill(id),
      commit: () => this.refreshRow(this.rowFor(id), true),
    });

    const note = document.createElement("span");
    note.className = "attack-army__note";
    note.setAttribute("aria-live", "polite");

    item.append(icon, label, stepper.element, note);
    return { id, element: item, stepper, input: stepper.input, note, count };
  }

  private buildChampion(t: number, l: number, hp: number): ChampionRow {
    const item = document.createElement("label");
    item.className = "attack-army__champion";
    item.dataset["t"] = String(t);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = this.radioName;
    input.value = String(t);
    input.className = "attack-army__champion-pick";
    // A click on the picked radio is the un-pick: the same control both ways
    // (§F2 "Champion"). Decided before the browser flips `checked`, so the
    // previous pick, not the new state, is what is compared.
    input.addEventListener("click", () => {
      const picked = this.bucket.champion()?.t === t;
      this.bucket.pickChampion(picked ? null : t);
      if (picked) input.checked = false;
    });

    const id = championByType(t) ?? `G${t}`;
    const icon = portrait(championPortrait(id, l, "icon"), championName(t));

    const label = document.createElement("span");
    label.className = "attack-army__label";
    const name = document.createElement("span");
    name.className = "attack-army__name";
    name.textContent = championName(t);
    const level = document.createElement("span");
    level.className = "attack-army__level";
    level.textContent = `L${l}`;
    const health = document.createElement("span");
    health.className = "attack-army__housed u-muted";
    health.textContent = `${formatAmount(hp)} hp`;
    label.append(name, level, health);

    const note = document.createElement("span");
    note.className = "attack-army__note";
    // The row is the radio's label and holds the Mode picker too; name the
    // radio by the champion and its note alone, not "… Mode Hybrid".
    label.id = `${this.radioName}-${t}`;
    note.id = `${this.radioName}-${t}-note`;
    input.setAttribute("aria-labelledby", `${label.id} ${note.id}`);

    // Its Mode (issue #220). The row is the radio's label, so a click on the
    // picker must not reach it and pick or un-pick the champion.
    const mode = document.createElement("span");
    mode.className = "attack-army__mode";
    const modeLabel = document.createElement("span");
    modeLabel.className = "attack-army__mode-label";
    modeLabel.textContent = "Mode";
    const stance = document.createElement("select");
    stance.className = "attack-army__mode-select";
    stance.setAttribute("aria-label", `${championName(t)}'s Mode`);
    for (const one of CHAMPION_STANCES) {
      const option = document.createElement("option");
      option.value = one;
      option.textContent = STANCE_TEXT[one].label;
      option.title = STANCE_TEXT[one].title;
      stance.append(option);
    }
    stance.value = this.bucket.stance(t);
    stance.title = STANCE_TEXT[this.bucket.stance(t)].title;
    stance.addEventListener("click", (event) => event.stopPropagation());
    stance.addEventListener("change", () => {
      if (!isChampionStance(stance.value)) return;
      this.bucket.setStance(t, stance.value);
      this.onStanceChange?.(t, stance.value);
    });
    mode.append(modeLabel, stance);

    item.append(input, icon, label, note, mode);

    // Flash's per-champion Retreat (issue #222): it calls this champion back
    // with the health it has, and the attack goes on.
    let retreat: HTMLButtonElement | null = null;
    const onRetreat = this.onRetreatChampion;
    if (onRetreat) {
      retreat = document.createElement("button");
      retreat.type = "button";
      retreat.className = "btn btn--ghost attack-army__champion-retreat";
      retreat.textContent = "Retreat";
      retreat.title = `Call ${championName(t)} back off the field, keeping the health it has`;
      retreat.hidden = true;
      retreat.addEventListener("click", (event) => {
        // The row is the radio's label; the button must not pick the champion.
        event.preventDefault();
        event.stopPropagation();
        onRetreat(t);
      });
      item.append(retreat);
    }
    return { t, element: item, input, note, retreat, stance };
  }

  private refreshRetreat(): void {
    const live = this.bucket.live();
    for (const row of this.champions) {
      row.stance.disabled = !live || this.onField.includes(row.t);
      if (!row.retreat) continue;
      const out = this.onField.includes(row.t);
      row.retreat.hidden = !out;
      row.element.classList.toggle("attack-army__champion--fighting", out);
    }
  }

  /* ── Refreshing ─────────────────────────────────────────────────────── */

  private rowFor(id: string): Row {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`ArmyPanel: no row for ${id}`);
    return row;
  }

  private refresh(): void {
    const bucket = this.bucket;
    const live = bucket.live();

    const cost = bucket.cost();
    const capacity = bucket.capacity();
    const share = capacity > 0 ? Math.min(1, cost / capacity) : 0;
    this.meter.setAttribute("aria-valuemax", String(capacity));
    this.meter.setAttribute("aria-valuenow", String(cost));
    this.meter.classList.toggle("attack-army__meter--full", cost >= capacity);
    this.meterFill.style.width = `${(share * 100).toFixed(1)}%`;
    this.meterText.textContent = `${units(cost)} / ${units(capacity)}`;

    const anyRoom = bucket.ids().some((id) => bucket.max(id) > bucket.requestedCount(id));
    this.fillAllButton.disabled = !live || !anyRoom;
    this.clearButton.disabled = !live || bucket.isEmpty();
    this.loadLastButton.disabled = !live || this.loadLastButton.disabled;

    for (const row of this.rows) this.refreshRow(row, document.activeElement !== row.input);

    const picked = bucket.champion()?.t ?? null;
    for (const champion of this.champions) {
      const entry = bucket.champions().find((candidate) => candidate.t === champion.t);
      const available = live && (entry?.available ?? false);
      champion.input.disabled = !available;
      champion.input.checked = picked === champion.t;
      champion.element.classList.toggle("attack-army__champion--picked", picked === champion.t);
      champion.element.classList.toggle("attack-army__champion--unavailable", !available);
      champion.note.textContent = this.onField.includes(champion.t)
        ? "On the field"
        : entry
          ? championNote(entry.blocked)
          : "";
      champion.element.title = entry?.blocked === "oneChampion" ? ONE_CHAMPION_TITLE : "";
      // A champion on the field fights in the Mode it was flung in.
      const stance = bucket.stance(champion.t);
      champion.stance.value = stance;
      champion.stance.title = STANCE_TEXT[stance].title;
      champion.stance.disabled = !live || this.onField.includes(champion.t);
    }

    this.hint.textContent = !live
      ? "The attack is over."
      : bucket.isEmpty()
        ? "Set how many to send, then tap the yard to drop them."
        : `Tap the yard to drop ${describeComposition(bucket)}.`;
  }

  /**
   * One row against the bucket. `rewrite` says whether the number box's text
   * may be replaced, which it may not be while the player is typing in it.
   */
  private refreshRow(row: Row, rewrite: boolean): void {
    const bucket = this.bucket;
    const live = bucket.live();
    const id = row.id;
    const requested = bucket.requestedCount(id);
    const remaining = bucket.remaining(id);
    const max = bucket.max(id);
    const exhausted = remaining === 0;
    const clamped = !exhausted && requested > remaining;
    const shown = exhausted ? 0 : requested;

    row.stepper.sync({
      value: shown,
      max: Math.max(max, requested),
      disabled: !live || exhausted,
      rewrite: rewrite || exhausted,
    });
    row.count.textContent = `${remaining} housed`;
    row.element.classList.toggle("attack-army__row--clamped", clamped);
    row.element.classList.toggle("attack-army__row--exhausted", exhausted);
    row.note.textContent = exhausted ? "None left" : clamped ? `${remaining} left` : "";
  }
}

/** Bucket units, exact with a thousands separator: "2,150", never "2.2K". */
const units = (value: number): string => Math.round(value).toLocaleString("en-US");

/** "30 Pokey and 5 Fink with Krallen", for the hint line. */
const describeComposition = (bucket: Bucket): string => {
  const composition = bucket.composition();
  const parts = Object.entries(composition.monsters).map(
    ([id, count]) => `${count} ${monsterName(id)}`,
  );
  const last = parts[parts.length - 1] ?? "";
  const monsters =
    parts.length <= 1 ? last : `${parts.slice(0, -1).join(", ")} and ${last}`;
  const champion = composition.champion ? championName(composition.champion.t) : "";
  if (monsters && champion) return `${monsters} with ${champion}`;
  return monsters || champion;
};

const button = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
};

/**
 * A row's picture: the painted icon, else the server's own small portrait,
 * else the name's first letter in a box rather than a broken image.
 */
const portrait = (picture: Portrait, name: string): HTMLElement => {
  const box = document.createElement("span");
  box.className = "attack-army__icon";
  box.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  showPortrait(image, picture);
  image.alt = "";
  image.setAttribute("loading", "lazy");
  image.setAttribute("decoding", "async");
  image.addEventListener("error", () => {
    image.remove();
    box.classList.add("attack-army__icon--missing");
    box.textContent = name.slice(0, 1);
  });
  box.append(image);
  return box;
};
