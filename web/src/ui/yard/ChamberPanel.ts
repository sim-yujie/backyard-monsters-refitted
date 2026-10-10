import type { YardRefusal } from "@/api/yard";
import { ChampionKey, championActions, type ChampionActions } from "@/api/yardChampion";
import {
  chamberView,
  championPicture,
  freezeGate,
  thawGate,
  type ChamberView,
  type ChampionView,
  type FrozenView,
} from "@/game/yard/championModel";
import { showPortrait } from "@/game/portraits";
import type { ChampionEntry } from "@/game/yard/championCatalogue";
import type { YardStore } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import "@/ui/styles/champion.css";

/**
 * The Champion Chamber's controls, inside its building panel
 * (`docs/design/yard-buildings.md` §7.2; issue #125).
 *
 * Opened by the panel's **Open chamber**. Like the original's chamber popup
 * (`client/scripts/CHAMPIONCHAMBERPOPUP.as:42-110`), it lists the champion in
 * the cage with **Freeze** and every frozen champion with **Thaw**. Both are
 * free and can be undone, so each is one tap; when one cannot run, the reason
 * the original gave is shown under it in plain words (injured, hungry, the
 * chamber damaged, the cage already holding a champion).
 */

type Status = { readonly tone: "good" | "bad"; readonly content: string };

export interface ChamberPanelOptions {
  readonly store: YardStore;
  /** The routes; `championActions(store)` unless a test swaps them. */
  readonly actions?: ChampionActions;
}

export class ChamberPanel {
  readonly element: HTMLElement;

  private readonly store: YardStore;
  private readonly actions: ChampionActions;
  private readonly status: HTMLElement;
  private readonly body: HTMLElement;
  private view: ChamberView | null = null;
  private shape = "";
  private freezeButton: HTMLButtonElement | null = null;
  private thawButtons = new Map<number, HTMLButtonElement>();

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
    this.view = view;
    this.shape = shapeOf(view);
    this.freezeButton = null;
    this.thawButtons.clear();

    if (view.kind === "noChamber") {
      this.body.replaceChildren(note("This Champion Chamber is gone."));
    } else if (view.kind === "building") {
      this.body.replaceChildren(note("The chamber takes champions once it is built."));
    } else {
      const parts: HTMLElement[] = [
        note("Keep a champion on ice while you raise another. Frozen champions keep their level and do not get hungry."),
      ];
      if (view.active) parts.push(this.activeRow(view.active));
      const list = document.createElement("ul");
      list.className = "chamber__list";
      list.setAttribute("aria-label", "Frozen champions");
      for (const frozen of view.frozen) list.append(this.frozenRow(frozen, view));
      parts.push(heading("Frozen"), view.frozen.length > 0 ? list : note("No champion is frozen yet."));
      this.body.replaceChildren(...parts);
    }
    this.syncPending();
  }

  /** Once a second: redraws only when what can be pressed has changed (a champion healed or turned hungry). */
  tick(): void {
    if (shapeOf(chamberView(this.store.save, this.store.now())) !== this.shape) this.show();
  }

  /** Disables the buttons while one of the chamber's requests runs. */
  syncPending(): void {
    const view = this.view;
    if (view?.kind !== "ready") return;
    if (this.freezeButton && view.active) {
      this.freezeButton.disabled =
        freezeGate(this.store.save, view.active) !== null || this.store.isRunning(ChampionKey.freeze);
    }
    for (const [type, button] of this.thawButtons) {
      const gate = thawGate(view, view.frozen.find((one) => one.entry.t === type)?.entry.kind === "special");
      button.disabled = gate !== null || this.store.isRunning(ChampionKey.thaw(type));
    }
  }

  destroy(): void {
    this.element.remove();
  }

  private activeRow(active: ChampionView): HTMLElement {
    const block = document.createElement("div");
    block.className = "champion__part chamber__active";
    const row = champRow(
      active.entry,
      active.level,
      active.name,
      `In the cage · Level ${active.level} · Health ${formatAmount(Math.floor(active.health))} / ${formatAmount(active.maxHealth)}`,
    );
    const freeze = document.createElement("button");
    freeze.type = "button";
    freeze.className = "btn btn--primary chamber__freeze";
    freeze.textContent = `Freeze ${active.name}`;
    freeze.addEventListener("click", () => void this.run(() => this.actions.freeze(), `${active.name} is frozen.`));
    this.freezeButton = freeze;
    const gate = freezeGate(this.store.save, active);
    block.append(row, freeze);
    if (gate) block.append(gateLine(gate));
    return block;
  }

  private frozenRow(frozen: FrozenView, view: ChamberView): HTMLElement {
    const item = document.createElement("li");
    item.className = "chamber__row";
    item.dataset["champion"] = frozen.entry.id;
    const fed =
      frozen.fedFor > 0
        ? `fed for ${formatCountdown(frozen.fedFor)} after thawing`
        : "hungry as soon as it thaws";
    item.append(
      champRow(
        frozen.entry,
        frozen.level,
        frozen.name,
        `Level ${frozen.level} · Health ${formatAmount(frozen.health)} / ${formatAmount(frozen.maxHealth)} · ${fed}`,
      ),
    );
    const thaw = document.createElement("button");
    thaw.type = "button";
    thaw.className = "btn chamber__thaw";
    thaw.textContent = `Thaw ${frozen.name}`;
    thaw.addEventListener("click", () =>
      void this.run(() => this.actions.thaw(frozen.entry.t), `${frozen.name} is back in the cage.`),
    );
    this.thawButtons.set(frozen.entry.t, thaw);
    item.append(thaw);
    const gate = thawGate(view, frozen.entry.kind === "special");
    if (gate) item.append(gateLine(gate));
    return item;
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

/** What the tick compares: which buttons can be pressed. */
const shapeOf = (view: ChamberView): string => {
  if (view.kind !== "ready") return view.kind;
  return [
    view.damaged,
    view.cage,
    view.active ? `${view.active.entry.id}:${view.active.hunger}:${view.active.health >= view.active.maxHealth}` : "-",
    view.frozen.map((one) => one.entry.id).join(),
  ].join("|");
};

/** A champion's picture, name and one line under it. */
const champRow = (entry: ChampionEntry, level: number, name: string, sub: string): HTMLElement => {
  const block = document.createElement("span");
  block.className = "chamber__name";
  const image = document.createElement("img");
  image.className = "chamber__picture";
  showPortrait(image, championPicture(entry, level));
  image.alt = "";
  image.decoding = "async";
  const words = document.createElement("span");
  words.className = "chamber__words";
  const strong = document.createElement("strong");
  strong.textContent = name;
  const line = document.createElement("span");
  line.className = "chamber__sub";
  line.textContent = sub;
  words.append(strong, line);
  block.append(image, words);
  return block;
};

const heading = (text: string): HTMLElement => {
  const element = document.createElement("h4");
  element.className = "champion__heading";
  element.textContent = text;
  return element;
};

const note = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "champion__note";
  element.textContent = text;
  return element;
};

const gateLine = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "champion__gate";
  element.textContent = text;
  return element;
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
