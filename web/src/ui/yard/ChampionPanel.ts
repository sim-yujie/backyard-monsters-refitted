import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { YardRefusal } from "@/api/yard";
import {
  ChampionKey,
  championActions,
  type ChampionActions,
  type ChampionFeedReport,
  type FeedMode,
} from "@/api/yardChampion";
import { juicerProblemText, juicerStatus } from "@/game/monsters/juice";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { showPortrait } from "@/game/portraits";
import { brainSummary, learnedFromText, tendenciesText } from "@/game/yard/championBrain";
import type { ChampionEntry } from "@/game/yard/championCatalogue";
import {
  CHAMPION_NAME_MAX,
  cageView,
  championPicture,
  freezeGate,
  specialChampion,
  ChampionStatus,
  championView,
  type CageView,
  type ChampionStats,
  type ChampionView,
  type RaiseChoice,
} from "@/game/yard/championModel";
import type { YardStore } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { monsterPicture } from "@/ui/monsters/LockerTab";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/champion.css";
import { ShinyButton } from "./ShinyButton";

/**
 * The Champion Cage's controls, inside its building panel
 * (`docs/design/yard-buildings.md` §7.2, decisions D11 and D17; issue #124).
 *
 * Opened by the panel's **Open cage**. With no champion in the cage: one card
 * each for Gorgo, Drull and Fomor (Korath and Krallen are not offered), each
 * with **Raise** (free), or a note when that one is frozen in the Chamber.
 * With a champion: its picture, name (**Rename**), level, how it fights (the
 * tendencies its learning brain picked up, #219), health with the
 * time to full and **Heal** (Shiny), its evolution (feeds so far of the
 * level's count; the food bonus at the top level), its hunger in plain words
 * with the time to the next feeding or to starving, the feed recipe against
 * what housing holds, **Feed**, **Feed with Shiny**, **Evolve now**,
 * **Freeze in the Chamber** (#125; one tap, it can be thawed), and **Juice**
 * (confirmed inline: it cannot be undone and gives no goo).
 *
 * The original closed the whole popup after every feed
 * (`CHAMPIONCAGEPOPUP.as:175-178`); this stays open and redraws from the
 * answer (§7.2). Shiny buttons are two-tap ({@link ShinyButton}) and live as
 * long as the panel, so an armed one survives the redraws. {@link tick}
 * (once a second) moves the clocks and the healing health bar without
 * rebuilding anything a finger or the keyboard may be on.
 */

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

export interface ChampionPanelOptions {
  readonly store: YardStore;
  /** The routes; `championActions(store)` unless a test swaps them. */
  readonly actions?: ChampionActions;
}

/** The nodes {@link ChampionPanel.tick} rewrites in place. */
interface LiveRefs {
  readonly health: HTMLElement;
  readonly healthFill: HTMLElement;
  readonly healthBar: HTMLElement;
  readonly hunger: HTMLElement;
}

export class ChampionPanel {
  readonly element: HTMLElement;

  private readonly store: YardStore;
  private readonly actions: ChampionActions;
  private readonly status: HTMLElement;
  private readonly body: HTMLElement;
  private readonly heal: ShinyButton;
  private readonly feedShiny: ShinyButton;
  private readonly evolve: ShinyButton;
  private readonly healSpecial: ShinyButton;

  private view: CageView | null = null;
  /** What the drawn body shows; a tick that sees another shape redraws. */
  private shape = "";
  private live: LiveRefs | null = null;
  private feedButton: HTMLButtonElement | null = null;
  private raiseButtons = new Map<number, HTMLButtonElement>();
  private juiceYes: HTMLButtonElement | null = null;
  private freezeButton: HTMLButtonElement | null = null;
  private freezeSpecialButton: HTMLButtonElement | null = null;
  private specialHealth: HTMLElement | null = null;
  private renameSave: HTMLButtonElement | null = null;
  private renaming = false;
  private nameDraft = "";
  private confirmingJuice = false;
  /** Set once a starving champion asked the server for its state, so it asks once. */
  private refreshedStarving = false;

  constructor(options: ChampionPanelOptions) {
    this.store = options.store;
    this.actions = options.actions ?? championActions(options.store);

    this.element = document.createElement("section");
    this.element.className = "champion";
    this.element.setAttribute("aria-label", "Champion Cage");

    this.status = document.createElement("p");
    this.status.className = "champion__status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.body = document.createElement("div");
    this.body.className = "champion__body";

    this.heal = new ShinyButton({
      label: "Heal now",
      spell: formatAmount,
      onSpend: () => void this.runHeal(),
      className: "champion__heal",
    });
    this.feedShiny = new ShinyButton({
      label: "Feed with Shiny",
      spell: formatAmount,
      onSpend: () => void this.runFeed("shiny"),
      className: "champion__feed-shiny",
    });
    this.evolve = new ShinyButton({
      label: "Evolve now",
      spell: formatAmount,
      onSpend: () => void this.runEvolve(),
      className: "champion__evolve",
    });

    this.healSpecial = new ShinyButton({
      label: "Heal now",
      spell: formatAmount,
      onSpend: () => void this.runSpecial("heal"),
      className: "champion__heal champion__heal--special",
    });

    this.element.append(this.status, this.body);
  }

  /** Redraws from the store: called on open and on every yard change. */
  show(): void {
    const now = this.store.now();
    this.view = cageView(this.store.save, now);
    this.shape = shapeOf(this.view) + specialShapeOf(this.store.save, now);
    this.live = null;
    this.feedButton = null;
    this.juiceYes = null;
    this.freezeButton = null;
    this.freezeSpecialButton = null;
    this.specialHealth = null;
    this.renameSave = null;
    this.raiseButtons.clear();

    const view = this.view;
    if (view.kind !== "active") {
      this.renaming = false;
      this.confirmingJuice = false;
    }
    switch (view.kind) {
      case "noCage":
        this.body.replaceChildren(note("This Champion Cage is gone."));
        break;
      case "building":
        this.body.replaceChildren(note("The cage takes a champion once it is built."));
        break;
      case "empty":
        this.body.replaceChildren(...this.raiseCards(view.choices), ...this.specialBlocks(now));
        break;
      case "active":
        this.refreshedStarving = view.view.hunger === "starving" && this.refreshedStarving;
        this.body.replaceChildren(...this.championBlocks(view.view), ...this.specialBlocks(now));
        break;
    }
    this.syncPending();
  }

  /** Once a second: the clocks, the healing bar and the Heal price, in place. */
  tick(): void {
    const now = this.store.now();
    const view = cageView(this.store.save, now);
    if (shapeOf(view) + specialShapeOf(this.store.save, now) !== this.shape) {
      this.show();
      return;
    }
    this.view = view;
    this.drawSpecialHealth(now);
    if (view.kind !== "active" || !this.live) return;
    const champion = view.view;
    this.drawHealth(champion, now);
    this.drawHunger(champion, now);
    this.heal.setPrice(champion.healShiny);
    if (champion.hunger === "starving" && !this.refreshedStarving) {
      // The server takes the feed on its next answer; ask for it now.
      this.refreshedStarving = true;
      void this.store.refresh();
    }
  }

  /** Disables the buttons while one of the cage's requests runs. */
  syncPending(): void {
    const store = this.store;
    this.heal.setBusy(store.isRunning(ChampionKey.heal));
    this.feedShiny.setBusy(store.isRunning(ChampionKey.feed("shiny")));
    this.evolve.setBusy(store.isRunning(ChampionKey.evolve));
    this.healSpecial.setBusy(store.isRunning(ChampionKey.healSpecial));
    if (this.freezeSpecialButton) this.freezeSpecialButton.disabled = store.isRunning(ChampionKey.freezeSpecial);
    const view = this.view?.kind === "active" ? this.view.view : null;
    if (this.feedButton && view) {
      this.feedButton.disabled = feedGate(view) !== null || store.isRunning(ChampionKey.feed("monsters"));
    }
    for (const button of this.raiseButtons.values()) button.disabled = store.isRunning(ChampionKey.raise);
    if (this.juiceYes) this.juiceYes.disabled = store.isRunning(ChampionKey.juice);
    if (this.freezeButton && view) {
      this.freezeButton.disabled = freezeGate(store.save, view) !== null || store.isRunning(ChampionKey.freeze);
    }
    if (this.renameSave) this.renameSave.disabled = store.isRunning(ChampionKey.rename);
  }

  destroy(): void {
    this.heal.destroy();
    this.feedShiny.destroy();
    this.evolve.destroy();
    this.healSpecial.destroy();
    this.element.remove();
  }

  /* ── No champion: the raise cards ─────────────────────────────────── */

  private raiseCards(choices: readonly RaiseChoice[]): HTMLElement[] {
    const intro = note(
      "Raise a champion to guard your yard and join your attacks. Raising is free; one champion lives in the cage at a time.",
    );
    const list = document.createElement("ul");
    list.className = "champion__cards";
    list.setAttribute("aria-label", "Champions you can raise");
    for (const choice of choices) list.append(this.raiseCard(choice));
    return [heading("Raise a champion"), intro, list];
  }

  private raiseCard({ entry, frozen }: RaiseChoice): HTMLElement {
    const card = document.createElement("li");
    card.className = "champion-card";
    card.dataset["champion"] = entry.id;
    const picture = portrait(entry, 1, "champion-card__picture");
    const words = document.createElement("div");
    words.className = "champion-card__words";
    const name = document.createElement("strong");
    name.className = "champion-card__name";
    name.textContent = entry.name;
    const role = document.createElement("span");
    role.className = "champion-card__role";
    role.textContent = entry.role ?? "";
    const blurb = document.createElement("p");
    blurb.className = "champion-card__blurb";
    blurb.textContent = entry.description;
    words.append(name, role, blurb);
    card.append(picture, words);
    if (frozen) {
      const gate = document.createElement("p");
      gate.className = "champion__gate";
      gate.textContent = `Your ${entry.name} is frozen in the Champion Chamber. Thaw it there instead.`;
      card.append(gate);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn champion-card__raise";
      button.textContent = `Raise ${entry.name}`;
      button.addEventListener("click", () => void this.runRaise(entry));
      this.raiseButtons.set(entry.t, button);
      card.append(button);
    }
    return card;
  }

  /* ── A champion in the cage ───────────────────────────────────────── */

  private championBlocks(view: ChampionView): HTMLElement[] {
    const now = this.store.now();
    return [
      this.header(view),
      brainBlock(view),
      this.healthBlock(view, now),
      this.growthBlock(view),
      this.feedBlock(view),
      this.freezeBlock(view),
      this.juiceBlock(view),
    ];
  }

  private header(view: ChampionView): HTMLElement {
    const header = document.createElement("div");
    header.className = "champion__header";
    const words = document.createElement("div");
    words.className = "champion__who";

    if (this.renaming) {
      words.append(this.renameForm(view));
    } else {
      const name = document.createElement("h4");
      name.className = "champion__name";
      name.textContent = view.name;
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "btn btn--ghost champion__rename";
      rename.textContent = "Rename";
      rename.setAttribute("aria-label", `Rename ${view.name}`);
      rename.addEventListener("click", () => {
        this.renaming = true;
        this.nameDraft = view.name;
        this.show();
        this.element.querySelector<HTMLInputElement>(".champion__name-input")?.select();
      });
      const nameRow = document.createElement("div");
      nameRow.className = "champion__name-row";
      nameRow.append(name, rename);
      words.append(nameRow);
    }

    const level = document.createElement("p");
    level.className = "champion__level";
    level.textContent =
      `${view.entry.name !== view.name ? `${view.entry.name} · ` : ""}` +
      `Level ${view.level} of ${view.entry.levels}` +
      (view.entry.role ? ` · ${view.entry.role}` : "");
    words.append(level, statsBlock(view));

    header.append(portrait(view.entry, view.level, "champion__picture"), words);
    return header;
  }

  private renameForm(view: ChampionView): HTMLElement {
    const form = document.createElement("form");
    form.className = "champion__rename-form";
    const label = document.createElement("label");
    label.className = "u-visually-hidden";
    label.htmlFor = "champion-name";
    label.textContent = "Champion's name";
    const input = document.createElement("input");
    input.id = "champion-name";
    input.className = "champion__name-input";
    input.maxLength = CHAMPION_NAME_MAX;
    input.value = this.nameDraft;
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      this.nameDraft = input.value;
    });
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn btn--primary";
    save.textContent = "Save";
    this.renameSave = save;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Cancel";
    const stop = (): void => {
      this.renaming = false;
      this.show();
      this.element.querySelector<HTMLButtonElement>(".champion__rename")?.focus();
    };
    cancel.addEventListener("click", stop);
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      stop();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.runRename(input.value, view);
    });
    const row = document.createElement("div");
    row.className = "map-row";
    row.append(save, cancel);
    form.append(label, input, row);
    return form;
  }

  private healthBlock(view: ChampionView, now: number): HTMLElement {
    const block = document.createElement("div");
    block.className = "champion__part";
    const line = document.createElement("p");
    line.className = "champion__line";
    const bar = document.createElement("div");
    bar.className = "monsters-bar champion__bar champion__bar--health";
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-label", "Health");
    bar.setAttribute("aria-valuemin", "0");
    const fill = document.createElement("div");
    fill.className = "monsters-bar__fill";
    bar.append(fill);
    const hunger = document.createElement("p");
    hunger.className = "champion__hunger";
    hunger.setAttribute("aria-live", "polite");
    this.live = { health: line, healthFill: fill, healthBar: bar, hunger };
    this.drawHealth(view, now);
    this.drawHunger(view, now);
    block.append(line, bar, this.heal.element, hunger);
    return block;
  }

  private drawHealth(view: ChampionView, now: number): void {
    const live = this.live;
    if (!live) return;
    const full = view.health >= view.maxHealth;
    live.health.replaceChildren(
      strong(`Health ${formatAmount(Math.floor(view.health))} / ${formatAmount(view.maxHealth)}`),
      full
        ? " · full"
        : view.fullAt !== null
          ? ` · full in ${formatCountdown(view.fullAt - now)}`
          : "",
    );
    const fraction = view.maxHealth > 0 ? Math.min(1, view.health / view.maxHealth) : 0;
    live.healthFill.style.width = `${+(fraction * 100).toFixed(2)}%`;
    live.healthBar.setAttribute("aria-valuemax", String(view.maxHealth));
    live.healthBar.setAttribute("aria-valuenow", String(Math.floor(view.health)));
    live.healthBar.setAttribute(
      "aria-valuetext",
      `${formatAmount(Math.floor(view.health))} of ${formatAmount(view.maxHealth)}`,
    );
    this.heal.element.hidden = full;
    this.heal.setPrice(view.healShiny);
    this.heal.setBlocked(full ? "Already at full health." : this.store.credits < view.healShiny ? "Not enough Shiny." : null);
  }

  private drawHunger(view: ChampionView, now: number): void {
    const live = this.live;
    if (!live) return;
    const text = hungerText(view, now);
    live.hunger.className = `champion__hunger champion__hunger--${view.hunger}`;
    live.hunger.replaceChildren(strong(text.title), ` ${text.detail}`);
  }

  private growthBlock(view: ChampionView): HTMLElement {
    const block = document.createElement("div");
    block.className = "champion__part";
    const line = document.createElement("p");
    line.className = "champion__line";
    const bar = document.createElement("div");
    bar.className = "monsters-bar champion__bar";
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-valuemin", "0");
    const fill = document.createElement("div");
    fill.className = "monsters-bar__fill";
    bar.append(fill);
    let done: number;
    let of: number;
    if (view.top) {
      done = view.foodBonus;
      of = 3;
      line.replaceChildren(
        strong("Fully evolved"),
        ` · food bonus ${done} of ${of}. Each daily feed adds one, up to three; missing a day takes one away.`,
      );
      bar.setAttribute("aria-label", "Food bonus");
    } else {
      done = view.feeds;
      of = view.feedCount;
      line.replaceChildren(
        strong(`Feeds ${done} / ${of}`),
        ` to level ${view.level + 1}`,
      );
      bar.setAttribute("aria-label", "Feeds to the next level");
    }
    bar.setAttribute("aria-valuemax", String(of));
    bar.setAttribute("aria-valuenow", String(done));
    bar.setAttribute("aria-valuetext", `${done} of ${of}`);
    fill.style.width = `${of > 0 ? +((Math.min(done, of) / of) * 100).toFixed(2) : 0}%`;
    block.append(line, bar);
    return block;
  }

  private feedBlock(view: ChampionView): HTMLElement {
    const block = document.createElement("div");
    block.className = "champion__part champion__part--feed";
    const list = document.createElement("ul");
    list.className = "champion__recipe";
    list.setAttribute("aria-label", "One feed eats");
    for (const row of view.recipe) {
      const item = document.createElement("li");
      item.className = "champion__recipe-row";
      const short = row.have < row.need;
      item.classList.toggle("champion__recipe-row--short", short);
      const monster = monsterEntry(row.monster);
      if (monster) item.append(monsterPicture(monster, "small", "champion__recipe-picture"));
      const words = document.createElement("span");
      words.className = "champion__recipe-words";
      words.append(strong(`${formatAmount(row.need)} ${row.name}`));
      const have = document.createElement("span");
      have.className = "champion__recipe-have";
      have.textContent = `you have ${formatAmount(row.have)}`;
      words.append(have);
      item.append(words);
      list.append(item);
    }

    const feed = document.createElement("button");
    feed.type = "button";
    feed.className = "btn btn--primary champion__feed";
    tutTarget(feed, TutTarget.CHAMPION_FEED);
    feed.textContent = "Feed now";
    feed.addEventListener("click", () => void this.runFeed("monsters"));
    this.feedButton = feed;
    const gate = feedGate(view);
    feed.disabled = gate !== null;

    const buttons = document.createElement("div");
    buttons.className = "champion__buttons";
    buttons.append(feed);

    if (view.feedShiny !== null) {
      this.feedShiny.setPrice(view.feedShiny);
      this.feedShiny.setBlocked(this.store.credits < view.feedShiny ? "Not enough Shiny." : null);
      buttons.append(this.feedShiny.element);
    }
    if (view.evolveShiny !== null) {
      this.evolve.setPrice(view.evolveShiny);
      this.evolve.setBlocked(this.store.credits < view.evolveShiny ? "Not enough Shiny." : null);
      buttons.append(this.evolve.element);
    }

    const parts: HTMLElement[] = [heading(view.top ? "Daily feed" : "Feed"), list, buttons];
    if (gate) {
      const line = document.createElement("p");
      line.className = "champion__gate";
      line.textContent = gate;
      parts.push(line);
    }
    const explain = view.top
      ? view.feedShiny !== null && view.hunger === "fed"
        ? "Not hungry yet: a food bonus bought now costs double."
        : null
      : view.hunger === "fed"
        ? "Evolve now buys every feed left at this level at double the Shiny price."
        : null;
    if (explain) parts.push(note(explain));
    block.append(...parts);
    return block;
  }

  /* ── Krallen: beside the champion, not in the cage ────────────────── */

  /** Krallen's card (view, heal, freeze) once he is in the yard; nothing before. */
  private specialBlocks(now: number): HTMLElement[] {
    const champion = specialChampion(this.store.save);
    const view = champion ? championView(this.store.save, champion, now) : null;
    if (!champion || !view) return [];
    const frozen = Number(champion.status ?? 0) === ChampionStatus.FROZEN;
    const block = document.createElement("div");
    block.className = "champion__part champion__part--special";
    block.dataset["champion"] = view.entry.id;
    const header = document.createElement("div");
    header.className = "champion__header";
    const words = document.createElement("div");
    words.className = "champion__who";
    const name = document.createElement("h4");
    name.className = "champion__name";
    name.textContent = view.name;
    const level = document.createElement("p");
    level.className = "champion__level";
    level.textContent = `Level ${view.level} of ${view.entry.levels}${frozen ? " · frozen in the Chamber" : ""}`;
    words.append(name, level, statsBlock(view));
    header.append(portrait(view.entry, view.level, "champion__picture"), words);
    block.append(heading("Your second champion"), header);
    if (frozen) {
      block.append(note("Krallen is asleep in the Champion Chamber. Thaw him from there."));
      return [block];
    }
    const health = document.createElement("p");
    health.className = "champion__line";
    this.specialHealth = health;
    this.drawSpecialHealth(now);
    block.append(health);
    if (view.health < view.maxHealth) {
      this.healSpecial.setPrice(view.healShiny);
      this.healSpecial.setBlocked(this.store.credits < view.healShiny ? "Not enough Shiny." : null);
      block.append(this.healSpecial.element);
    }
    const freeze = document.createElement("button");
    freeze.type = "button";
    freeze.className = "btn champion__freeze champion__freeze--special";
    freeze.textContent = "Freeze in the Chamber";
    const gate = freezeGate(this.store.save, view);
    freeze.disabled = gate !== null || this.store.isRunning(ChampionKey.freezeSpecial);
    freeze.addEventListener("click", () => void this.runSpecial("freeze"));
    this.freezeSpecialButton = freeze;
    block.append(freeze);
    if (gate) block.append(gateLine(gate));
    return [block];
  }

  private drawSpecialHealth(now: number): void {
    const line = this.specialHealth;
    const champion = specialChampion(this.store.save);
    const view = champion ? championView(this.store.save, champion, now) : null;
    if (!line || !view) return;
    const full = view.health >= view.maxHealth;
    line.replaceChildren(
      strong(`Health ${formatAmount(Math.floor(view.health))} / ${formatAmount(view.maxHealth)}`),
      full ? " · full" : view.fullAt !== null ? ` · full in ${formatCountdown(view.fullAt - now)}` : "",
    );
  }

  private async runSpecial(what: "heal" | "freeze"): Promise<void> {
    if (what === "heal") {
      const result = await this.actions.healSpecial();
      this.setStatus(
        result.ok
          ? {
              tone: "good",
              content: ["Krallen healed to full for ", resourceAmount("shiny", formatAmount(result.report.credits)), "."],
            }
          : bad(result.refusal),
      );
    } else {
      const result = await this.actions.freezeSpecial();
      this.setStatus(
        result.ok ? { tone: "good", content: ["Krallen is frozen in the Champion Chamber."] } : bad(result.refusal),
      );
    }
    this.show();
  }

  /** Freeze into the Champion Chamber (#125): reversible, so one tap. */
  private freezeBlock(view: ChampionView): HTMLElement {
    const block = document.createElement("div");
    block.className = "champion__part champion__part--freeze";
    const freeze = document.createElement("button");
    freeze.type = "button";
    freeze.className = "btn champion__freeze";
    freeze.textContent = "Freeze in the Chamber";
    const gate = freezeGate(this.store.save, view);
    freeze.disabled = gate !== null || this.store.isRunning(ChampionKey.freeze);
    freeze.addEventListener("click", () => void this.runFreeze(view));
    this.freezeButton = freeze;
    block.append(
      freeze,
      gate
        ? gateLine(gate)
        : note("Frozen champions keep their level and do not get hungry. Thaw it from the Champion Chamber."),
    );
    return block;
  }

  private juiceBlock(view: ChampionView): HTMLElement {
    const block = document.createElement("div");
    block.className = "champion__part champion__part--juice";
    const juicer = juicerStatus(this.store.save);
    if (this.confirmingJuice) {
      const wrap = document.createElement("div");
      wrap.className = "champion__confirm";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Confirm juice");
      const question = document.createElement("p");
      question.className = "champion__question";
      question.textContent = `Juice ${view.name}? It is gone for good and gives no goo. You can raise a new champion afterwards.`;
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "btn btn--danger champion__juice-yes";
      yes.textContent = `Yes, juice ${view.name}`;
      yes.addEventListener("click", () => void this.runJuice(view));
      this.juiceYes = yes;
      const keep = document.createElement("button");
      keep.type = "button";
      keep.className = "btn";
      keep.textContent = "Keep it";
      const stop = (): void => {
        this.confirmingJuice = false;
        this.show();
        this.element.querySelector<HTMLButtonElement>(".champion__juice")?.focus();
      };
      keep.addEventListener("click", stop);
      wrap.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        stop();
      });
      const row = document.createElement("div");
      row.className = "map-row";
      row.append(yes, keep);
      wrap.append(question, row);
      block.append(wrap);
      return block;
    }
    const juice = document.createElement("button");
    juice.type = "button";
    juice.className = "btn btn--ghost champion__juice";
    juice.textContent = "Juice champion";
    juice.disabled = !juicer.ok;
    juice.addEventListener("click", () => {
      this.confirmingJuice = true;
      this.show();
      this.juiceYes?.focus();
    });
    block.append(juice);
    if (!juicer.ok) {
      const gate = document.createElement("p");
      gate.className = "champion__gate";
      gate.textContent = juicerProblemText(juicer.problem);
      block.append(gate);
    }
    return block;
  }

  /* ── Requests ─────────────────────────────────────────────────────── */

  private async runRaise(entry: ChampionEntry): Promise<void> {
    const result = await this.actions.raise(entry.t);
    this.setStatus(
      result.ok
        ? { tone: "good", content: [`${entry.name} hatched in your cage. Feed it every day so it grows.`] }
        : { tone: "bad", content: [refusalText(result.refusal)] },
    );
    this.show();
  }

  private async runFeed(mode: FeedMode): Promise<void> {
    const result = await this.actions.feed(mode);
    this.setStatus(result.ok ? { tone: "good", content: fedText(result.report) } : bad(result.refusal));
    this.show();
  }

  private async runEvolve(): Promise<void> {
    const result = await this.actions.evolve();
    this.setStatus(
      result.ok
        ? {
            tone: "good",
            content: [
              `Evolved to level ${result.report.champion.l} for `,
              resourceAmount("shiny", formatAmount(result.report.credits)),
              ".",
            ],
          }
        : bad(result.refusal),
    );
    this.show();
  }

  private async runHeal(): Promise<void> {
    const result = await this.actions.heal();
    this.setStatus(
      result.ok
        ? {
            tone: "good",
            content: ["Healed to full for ", resourceAmount("shiny", formatAmount(result.report.credits)), "."],
          }
        : bad(result.refusal),
    );
    this.show();
  }

  private async runRename(name: string, view: ChampionView): Promise<void> {
    const result = await this.actions.rename(name);
    if (result.ok) {
      this.renaming = false;
      this.setStatus({ tone: "good", content: [`${view.entry.name} is now called ${result.report.champion.nm ?? name}.`] });
    } else {
      this.setStatus(bad(result.refusal));
    }
    this.show();
  }

  private async runFreeze(view: ChampionView): Promise<void> {
    const result = await this.actions.freeze();
    this.setStatus(
      result.ok
        ? { tone: "good", content: [`${view.name} is frozen in the Champion Chamber. The cage is free to raise another.`] }
        : bad(result.refusal),
    );
    this.show();
  }

  private async runJuice(view: ChampionView): Promise<void> {
    const result = await this.actions.juice();
    this.confirmingJuice = false;
    this.setStatus(
      result.ok ? { tone: "good", content: [`${view.name} went into the Juicer.`] } : bad(result.refusal),
    );
    this.show();
  }

  private setStatus(status: Status): void {
    this.status.hidden = false;
    this.status.className = `champion__status champion__status--${status.tone}`;
    this.status.replaceChildren(...status.content);
  }
}

/**
 * How it fights (issue #219): the tendencies its own attacks taught it, in
 * plain words, strongest first, or that it is still learning. There is no
 * reset: the owner wants what it learned to stay with it.
 */
export const brainBlock = (view: ChampionView): HTMLElement => {
  const block = document.createElement("div");
  block.className = "champion__part champion__part--brain";
  const summary = brainSummary(view.champion);
  const list = document.createElement("ul");
  list.className = "champion__tendencies";
  list.setAttribute("aria-label", "What it has learned");
  const words = summary.tendencies.length > 0 ? summary.tendencies : [tendenciesText(summary)];
  for (const text of words) {
    const item = document.createElement("li");
    item.className = "champion__tendency";
    item.classList.toggle("champion__tendency--learning", summary.tendencies.length === 0);
    item.textContent = text;
    list.append(item);
  }
  block.append(
    heading("How it fights"),
    list,
    note(`${learnedFromText(summary)} Each attack teaches it by its Mode's goal.`),
  );
  return block;
};

/* ── Words ──────────────────────────────────────────────────────────── */

/** What Krallen's card compares: his status, level and whether he is hurt or hungry. */
const specialShapeOf = (save: YardStore["save"], now: number): string => {
  const champion = specialChampion(save);
  const view = champion ? championView(save, champion, now) : null;
  if (!champion || !view) return "";
  return `|K:${champion.status ?? 0}:${view.level}:${view.health >= view.maxHealth}:${view.hunger}:${view.healShiny}`;
};

/** The numbers on a champion's card: current, with what evolving (or the next food-bonus rank) adds. */
export const statsBlock = (view: ChampionView): HTMLElement => {
  const wrap = document.createElement("div");
  wrap.className = "champion__stats-wrap";
  const list = document.createElement("ul");
  list.className = "champion__stats";
  list.setAttribute("aria-label", "Stats");
  const rows: ReadonlyArray<readonly [string, keyof ChampionStats, (value: number) => string]> = [
    ["Damage", "damage", formatAmount],
    ["Health", "health", formatAmount],
    ["Speed", "speed", (value) => String(Math.round(value * 10) / 10)],
    ["Range", "range", formatAmount],
    ["Buff", "buff", (value) => `${value}%`],
  ];
  for (const [label, key, spell] of rows) {
    const now = view.stats[key];
    if (key === "buff" && now <= 0) continue;
    const item = document.createElement("li");
    item.className = "champion__stat";
    const next = view.nextStats?.[key];
    item.append(`${label} `, strong(spell(now)));
    if (next !== undefined && next !== now) item.append(` → ${spell(next)}`);
    list.append(item);
  }
  wrap.append(list);
  if (view.nextBonus) {
    const gain = view.nextBonus;
    const parts = [
      gain.damage > 0 ? `+${formatAmount(gain.damage)} damage` : "",
      gain.health > 0 ? `+${formatAmount(gain.health)} health` : "",
      gain.speed > 0 ? `+${gain.speed} speed` : "",
      gain.range > 0 ? `+${formatAmount(gain.range)} range` : "",
      gain.buff > 0 ? `+${gain.buff}% buff` : "",
    ].filter(Boolean);
    if (parts.length > 0) {
      wrap.append(note(`Next food-bonus rank (${view.foodBonus + 1} of 3): ${parts.join(", ")}.`));
    }
  }
  if (view.nextStats) wrap.append(note(`Arrows show level ${view.level + 1}.`));
  return wrap;
};

/** What the tick compares to decide whether the body must be rebuilt. */
const shapeOf = (view: CageView): string => {
  if (view.kind !== "active") {
    return view.kind === "empty"
      ? `empty:${view.choices.map((one) => `${one.entry.id}${one.frozen ? "f" : ""}`).join()}`
      : view.kind;
  }
  const champion = view.view;
  return [
    champion.entry.id,
    champion.level,
    champion.feeds,
    champion.foodBonus,
    champion.hunger,
    champion.name,
    champion.feedShiny,
    champion.evolveShiny,
    champion.canFeedMonsters,
    champion.health >= champion.maxHealth,
    tendenciesText(brainSummary(champion.champion)),
    brainSummary(champion.champion).attacks,
  ].join(":");
};

/** The hunger line: a short state and what happens next. */
export const hungerText = (view: ChampionView, now: number): { title: string; detail: string } => {
  const loses = view.top
    ? view.foodBonus > 0
      ? "or it loses a food bonus"
      : null
    : view.feeds > 0
      ? "or it loses a feed"
      : null;
  switch (view.hunger) {
    case "fed":
      return { title: "Fed.", detail: `Hungry in ${formatCountdown(view.hungryAt - now)}.` };
    case "hungry":
      return {
        title: "Hungry!",
        detail: loses
          ? `Feed it within ${formatCountdown(view.starvesAt - now)} ${loses}.`
          : `Feed it to keep it growing (${formatCountdown(view.starvesAt - now)} before it starves).`,
      };
    case "starving":
      return {
        title: "Starving!",
        detail: loses ? `It went too long without food and ${loses.replace("or it ", "")}.` : "Feed it soon.",
      };
  }
};

/** Why Feed now cannot be pressed, or null. */
export const feedGate = (view: ChampionView): string | null => {
  if (view.hunger === "fed") return "Not hungry yet. Champions eat once a day.";
  const short = view.recipe.find((row) => row.have < row.need);
  if (short) {
    return `Not enough ${short.name}: you have ${formatAmount(short.have)} of ${formatAmount(short.need)}. Hatch more, or feed with Shiny.`;
  }
  return null;
};

const fedText = (report: ChampionFeedReport): (Node | string)[] => {
  const eaten = Object.entries(report.eaten)
    .map(([id, n]) => `${formatAmount(n)} ${monsterEntry(id)?.name ?? id}`)
    .join(" and ");
  const paid: (Node | string)[] =
    report.mode === "shiny" ? ["Fed for ", resourceAmount("shiny", formatAmount(report.credits))] : [`Fed ${eaten}`];
  if (report.evolved) return [...paid, `. It evolved to level ${report.champion.l}!`];
  return [...paid, ". Next feeding in 23 hours."];
};

const bad = (refusal: YardRefusal): Status => ({ tone: "bad", content: [refusalText(refusal)] });

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";

const heading = (text: string): HTMLElement => {
  const element = document.createElement("h4");
  element.className = "champion__heading";
  element.textContent = text;
  return element;
};

const gateLine = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "champion__gate";
  element.textContent = text;
  return element;
};

const note = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "champion__note";
  element.textContent = text;
  return element;
};

const strong = (text: string): HTMLElement => {
  const element = document.createElement("strong");
  element.textContent = text;
  return element;
};

/** The champion's picture at a level, from the game's own art. */
const portrait = (entry: ChampionEntry, level: number, className: string): HTMLImageElement => {
  const image = document.createElement("img");
  image.className = className;
  showPortrait(image, championPicture(entry, level));
  image.alt = "";
  image.width = 150;
  image.height = 150;
  image.decoding = "async";
  return image;
};
