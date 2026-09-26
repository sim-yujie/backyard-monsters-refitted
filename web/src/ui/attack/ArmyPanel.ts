import type { Bucket } from "@/game/attack/bucket";
import { CHAMPION_PROPS, championByType } from "@/game/combat/rules";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";

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
 * A press on `-` or `+` steps once at once, then after a short wait repeats,
 * quickening the longer it is held (`HOLD_*` below). It runs on pointer
 * events so one code path serves a mouse and a finger, and it stops on
 * `pointerup`, `pointercancel` or the pointer leaving the button. A keyboard
 * activation arrives as a `click` with no pointer press before it and steps
 * once.
 *
 * ## After a drop
 *
 * The bucket keeps the numbers the player set. A row whose true count fell
 * below its number is greyed and says what is left; a row that ran out shows
 * 0 and is disabled (§F2 "after a drop").
 */

/** Milliseconds a press must last before it starts repeating. */
export const HOLD_DELAY_MS = 350;
/** The first repeat interval, and the one it accelerates to. */
export const HOLD_START_MS = 120;
export const HOLD_FAST_MS = 40;
/** Milliseconds of holding over which the interval ramps from start to fast. */
export const HOLD_RAMP_MS = 2000;

/** How much ArrowUp/Down and PageUp/Down step the number box. */
const ARROW_STEP = 1;
const PAGE_STEP = 10;

/** Display names by roster id (`server/src/game-data/stats/monsterKeys.ts`). */
export const MONSTER_NAMES: Readonly<Record<string, string>> = {
  C1: "Pokey",
  C2: "Octo-ooze",
  C3: "Bolt",
  C4: "Fink",
  C5: "Eye-ra",
  C6: "Ichi",
  C7: "Bandito",
  C8: "Fang",
  C9: "Brain",
  C10: "Crabatron",
  C11: "Project X",
  C12: "D.A.V.E.",
  C13: "Wormzer",
  C14: "Teratorn",
  C15: "Zafreeti",
  C16: "Vorg",
  C17: "Slimeattikus",
  C19: "Rezghul",
  C200: "Looter",
  IC1: "Spurtz",
  IC2: "Zagnoid",
  IC3: "Malphus",
  IC4: "Valgos",
  IC5: "Balthazar",
  IC6: "Grokus",
  IC7: "Sabnox",
  IC8: "King Wormzer",
};

/** A monster's display name, or its id when the table has none. */
export const monsterName = (id: string): string => MONSTER_NAMES[id] ?? id;

/** A champion's display name from the stat table, or `G<t>`. */
export const championName = (t: number): string => {
  const id = championByType(t);
  return (id && CHAMPION_PROPS[id]?.name) || `G${t}`;
};

/** The small portrait the game server ships for a monster or a champion level. */
export const portraitUrl = (id: string, championLevel?: number): string =>
  championLevel === undefined
    ? `/assets/monsters/${id}-small.png`
    : `/assets/monsters/${id}_L${Math.max(1, Math.floor(championLevel))}-small.png`;

/** The repeat interval after `heldMs` of holding: a straight ramp. */
export const holdInterval = (heldMs: number): number => {
  const progress = Math.min(1, Math.max(0, (heldMs - HOLD_DELAY_MS) / HOLD_RAMP_MS));
  return Math.round(HOLD_START_MS + (HOLD_FAST_MS - HOLD_START_MS) * progress);
};

export interface ArmyPanelOptions {
  /**
   * Called whenever the panel's box changes size, for the bottom-sheet inset
   * (§4.3). Not called in a browser without `ResizeObserver`.
   */
  readonly onResize?: () => void;
}

interface Row {
  readonly id: string;
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly minus: HTMLButtonElement;
  readonly plus: HTMLButtonElement;
  readonly fill: HTMLButtonElement;
  readonly note: HTMLElement;
  readonly count: HTMLElement;
}

interface ChampionRow {
  readonly t: number;
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly note: HTMLElement;
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
  private readonly cancelHolds: Array<() => void> = [];
  private readonly radioName = `attack-champion-${Math.random().toString(36).slice(2, 9)}`;

  constructor(bucket: Bucket, options: ArmyPanelOptions = {}) {
    this.bucket = bucket;
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
    for (const cancel of this.cancelHolds.splice(0)) cancel();
    this.observer?.disconnect();
    this.unsubscribe();
    this.panel.close();
  }

  /** The number box for a row, for the tests. */
  inputFor(id: string): HTMLInputElement | null {
    return this.rows.find((row) => row.id === id)?.input ?? null;
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

    const icon = portrait(portraitUrl(id), monsterName(id));

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

    const controls = document.createElement("span");
    controls.className = "attack-army__controls";

    const minus = button("btn attack-army__step attack-army__step--minus", "−", () => {
      this.bucket.setCount(id, this.bucket.requestedCount(id) - 1);
    });
    minus.setAttribute("aria-label", `Fewer ${monsterName(id)}`);
    this.cancelHolds.push(holdToRepeat(minus, () => this.step(id, -1)));

    const input = document.createElement("input");
    input.type = "number";
    input.className = "field__input attack-army__count";
    input.min = "0";
    input.step = "1";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", `${monsterName(id)} to send`);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (input.value === "" || !Number.isFinite(value)) return;
      this.bucket.setCount(id, value);
    });
    input.addEventListener("change", () => this.refreshRow(this.rowFor(id), true));
    input.addEventListener("blur", () => this.refreshRow(this.rowFor(id), true));
    input.addEventListener("keydown", (event) => {
      const delta =
        event.key === "ArrowUp"
          ? ARROW_STEP
          : event.key === "ArrowDown"
            ? -ARROW_STEP
            : event.key === "PageUp"
              ? PAGE_STEP
              : event.key === "PageDown"
                ? -PAGE_STEP
                : 0;
      if (delta === 0) return;
      event.preventDefault();
      this.step(id, delta);
      this.refreshRow(this.rowFor(id), true);
    });
    input.addEventListener("focus", () => input.select());

    const plus = button("btn attack-army__step attack-army__step--plus", "+", () => {
      this.bucket.setCount(id, this.bucket.requestedCount(id) + 1);
    });
    plus.setAttribute("aria-label", `More ${monsterName(id)}`);
    this.cancelHolds.push(holdToRepeat(plus, () => this.step(id, 1)));

    const fill = button("btn btn--ghost attack-army__fill", "Fill", () => this.bucket.fill(id));
    fill.title = `Send as many ${monsterName(id)} as the flinger can carry`;

    controls.append(minus, input, plus, fill);

    const note = document.createElement("span");
    note.className = "attack-army__note";
    note.setAttribute("aria-live", "polite");

    item.append(icon, label, controls, note);
    return { id, element: item, input, minus, plus, fill, note, count };
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
    const icon = portrait(portraitUrl(id, l), championName(t));

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

    item.append(input, icon, label, note);
    return { t, element: item, input, note };
  }

  /* ── Refreshing ─────────────────────────────────────────────────────── */

  private step(id: string, delta: number): void {
    this.bucket.setCount(id, this.bucket.requestedCount(id) + delta);
  }

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
      champion.note.textContent = !entry
        ? ""
        : entry.hp <= 0
          ? "Hurt"
          : entry.status !== 0
            ? "Away"
            : !entry.available
              ? "On the field"
              : "";
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

    if (rewrite || exhausted) row.input.value = String(shown);
    row.input.max = String(Math.max(max, requested));
    row.input.disabled = !live || exhausted;
    row.minus.disabled = !live || exhausted || requested === 0;
    row.plus.disabled = !live || exhausted || requested >= max;
    row.fill.disabled = !live || exhausted || requested >= max;
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
  element.addEventListener("click", (event) => {
    // A pointer press already stepped through holdToRepeat; only an
    // activation with no press before it — the keyboard — steps here.
    if (event.detail !== 0 && element.dataset["held"] === "1") {
      delete element.dataset["held"];
      return;
    }
    delete element.dataset["held"];
    onClick();
  });
  return element;
};

/**
 * Makes a button step once on press and keep stepping while held, faster the
 * longer it is held. Returns the cancel, for teardown.
 *
 * Pointer events so a mouse and a finger share one path. The first step is
 * on `pointerdown`; the `click` that follows the release is swallowed by the
 * button's own handler (see {@link button}), which still steps once for a
 * keyboard activation.
 */
export const holdToRepeat = (element: HTMLButtonElement, step: () => void): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0;
  let pointerId: number | null = null;

  const stop = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pointerId !== null) {
      try {
        if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      } catch {
        // Already released; nothing to do.
      }
      pointerId = null;
    }
  };

  const tick = (): void => {
    if (element.disabled) {
      stop();
      return;
    }
    step();
    const held = Date.now() - startedAt;
    timer = setTimeout(tick, holdInterval(held));
  };

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || element.disabled) return;
    stop();
    element.dataset["held"] = "1";
    pointerId = event.pointerId;
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic event with no pointer to capture; the leave handler covers it.
    }
    startedAt = Date.now();
    step();
    timer = setTimeout(tick, HOLD_DELAY_MS);
  };

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
  element.addEventListener("pointerleave", stop);
  element.addEventListener("lostpointercapture", stop);
  // A long press on a touchscreen would otherwise open the context menu.
  element.addEventListener("contextmenu", (event) => event.preventDefault());

  return () => {
    stop();
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointerup", stop);
    element.removeEventListener("pointercancel", stop);
    element.removeEventListener("pointerleave", stop);
    element.removeEventListener("lostpointercapture", stop);
  };
};

/**
 * A row's picture: the small portrait the server ships, or the name's first
 * letter in a box when the file is missing, rather than a broken image.
 */
const portrait = (url: string, name: string): HTMLElement => {
  const box = document.createElement("span");
  box.className = "attack-army__icon";
  box.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  image.src = url;
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
