import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { YardRefusal } from "@/api/yard";
import {
  ChampionKey,
  championActions,
  type ChampionActions,
  type ChampionFeedReport,
  type FeedMode,
} from "@/api/yardChampion";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { championPortrait, showPortrait, type Portrait } from "@/game/portraits";
import { buttonUrl, silhouetteUrl } from "@/game/yard/buildButtonArt";
import type { YardKind } from "@/game/yard/buildingCosts";
import { brainSummary, learnedFromText, tendenciesText } from "@/game/yard/championBrain";
import type { ChampionEntry } from "@/game/yard/championCatalogue";
import {
  CHAMPION_CHAMBER_TYPE,
  CHAMPION_NAME_MAX,
  cageView,
  championPicture,
  freezeGate,
  freezeProblem,
  specialChampion,
  ChampionStatus,
  championView,
  type CageView,
  type ChampionStats,
  type ChampionView,
  type FreezeProblem,
  type RaiseChoice,
} from "@/game/yard/championModel";
import type { YardStore } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
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
 * Raising puts the champion in the cage straight away, as in the original
 * (owner 2026-10-28: no eggs, no juicing).
 * With a champion: its picture, name (**Rename**), level, how it fights (the
 * tendencies its learning brain picked up, #219), health with the
 * time to full and **Heal** (Shiny), its evolution (feeds so far of the
 * level's count; the food bonus at the top level), its hunger in plain words
 * with the time to the next feeding or to starving, the feed recipe against
 * what housing holds, **Feed**, **Feed with Shiny**, **Evolve now**,
 * and **Freeze in the Chamber** (#125; one tap, it can be thawed). Champions
 * cannot be juiced (owner, 2026-10-28), so a player without a Chamber keeps
 * the champion they raised.
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
  private freezeButton: HTMLButtonElement | null = null;
  private freezeSpecialButton: HTMLButtonElement | null = null;
  private specialHealth: HTMLElement | null = null;
  private renameSave: HTMLButtonElement | null = null;
  private renaming = false;
  private nameDraft = "";
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
    this.freezeButton = null;
    this.freezeSpecialButton = null;
    this.specialHealth = null;
    this.renameSave = null;
    this.raiseButtons.clear();

    const view = this.view;
    if (view.kind !== "active") this.renaming = false;
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
    // A locked Freeze stays pressable (it says why); only a running freeze disables it.
    if (this.freezeButton) this.freezeButton.disabled = store.isRunning(ChampionKey.freeze);
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
      "Raise a champion to guard your yard and join your attacks. Raising is free. One champion lives in the cage at a time.",
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
    // The icon, cut to the creature: the whole frame keeps each champion's
    // own level-1 size, which left Fomor a speck beside Gorgo and Drull.
    const picture = portrait(championPortrait(entry.id, 1, "icon"), "champion-card__picture");
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

  /**
   * Flash's two pages in one (`CHAMPIONCAGEPOPUP.as:151-152`): the champion
   * (big picture, level, health, Freeze beside it, stats under it),
   * then its evolution (this level's picture, the feeds bar and hunger clock,
   * the next level's picture) with the feed under it, and how it fights last.
   * It all fits a 1280x800 screen without scrolling (lead, 28 Oct).
   */
  private championBlocks(view: ChampionView): HTMLElement[] {
    const now = this.store.now();
    const health = document.createElement("p");
    health.className = "champion__line champion__line--health";
    const healthBar = document.createElement("div");
    healthBar.className = "monsters-bar champion__bar champion__bar--health";
    healthBar.setAttribute("role", "meter");
    healthBar.setAttribute("aria-label", healthLabel(view));
    healthBar.setAttribute("aria-valuemin", "0");
    const healthFill = document.createElement("div");
    healthFill.className = "monsters-bar__fill";
    healthBar.append(healthFill);
    const hunger = document.createElement("p");
    hunger.className = "champion__hunger";
    hunger.setAttribute("aria-live", "polite");
    this.live = { health, healthFill, healthBar, hunger };
    this.drawHealth(view, now);
    this.drawHunger(view, now);
    return [this.header(view), this.growthBlock(view), this.feedBlock(view), brainBlock(view)];
  }

  private header(view: ChampionView): HTMLElement {
    const header = document.createElement("div");
    header.className = "champion__header champion__header--hero";
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
    const live = this.live;
    const health = document.createElement("div");
    health.className = "champion__health";
    if (live) health.append(live.health, live.healthBar);
    health.append(this.heal.element);
    words.append(level, health);

    // The next level's picture on the feeds bar says what the arrows mean: the words for screen readers only.
    const stats = statsBlock(view);
    const arrows = stats.querySelector<HTMLElement>(".champion__note--arrows");
    if (arrows) unseen(arrows);
    header.append(portrait(championPicture(view.entry, view.level), "champion__picture"), words, stats, ...this.acts(view));
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

  private drawHealth(view: ChampionView, now: number): void {
    const live = this.live;
    if (!live) return;
    const full = view.health >= view.maxHealth;
    live.health.replaceChildren(
      gameIcon("health", { size: 16, label: healthLabel(view) }),
      " ",
      strong(`${formatAmount(Math.floor(view.health))} / ${formatAmount(view.maxHealth)}`),
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
    live.hunger.replaceChildren(
      gameIcon("time", { size: 16, decorative: true }),
      " ",
      strong(text.title),
      ` ${text.detail}`,
    );
  }

  /**
   * Flash's evolution page (`CHAMPIONCAGEPOPUP.as:152`): this level's picture,
   * the feeds bar, the next level's picture, then the hunger clock. At the top
   * level the bar is the food bonus and there is no next picture.
   */
  private growthBlock(view: ChampionView): HTMLElement {
    const block = document.createElement("div");
    block.className = "champion__part champion__part--growth";
    const line = document.createElement("p");
    line.className = "champion__line";
    const bar = document.createElement("div");
    bar.className = "monsters-bar champion__bar champion__bar--growth";
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
      line.replaceChildren(strong("Fully evolved"), ` · food bonus ${done} / ${of}`);
      line.title = "Each daily feed adds one food bonus, up to three; missing a day takes one away.";
      bar.setAttribute("aria-label", "Food bonus");
    } else {
      done = view.feeds;
      of = view.feedCount;
      line.replaceChildren(strong(`Feeds ${done} / ${of}`), ` to level ${view.level + 1}`);
      bar.setAttribute("aria-label", "Feeds to the next level");
    }
    bar.setAttribute("aria-valuemax", String(of));
    bar.setAttribute("aria-valuenow", String(done));
    bar.setAttribute("aria-valuetext", `${done} of ${of}`);
    fill.style.width = `${of > 0 ? +((Math.min(done, of) / of) * 100).toFixed(2) : 0}%`;

    const middle = document.createElement("div");
    middle.className = "champion__track-bar";
    middle.append(line, bar);
    const track = document.createElement("div");
    track.className = "champion__track";
    // The hunger clock under the bar: the Evolution heading is for screen readers only.
    if (this.live) middle.append(this.live.hunger);
    track.append(stagePicture(view.entry, view.level, `Level ${view.level}`), middle);
    if (!view.top) {
      const next = stagePicture(view.entry, view.level + 1, `Level ${view.level + 1}`);
      next.classList.add("champion__stage--next");
      track.append(next);
    }
    block.append(unseen(heading(view.top ? "Food bonus" : "Evolution")), track);
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
      item.title = `${formatAmount(row.need)} ${row.name}: you have ${formatAmount(row.have)}`;
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
    // "Not hungry yet" is what the hunger clock above already says: on hover only.
    if (gate) feed.title = gate;

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
      if (view.hunger === "fed") {
        this.evolve.element.title = "Evolve now buys every feed left at this level at double the Shiny price.";
      } else {
        this.evolve.element.removeAttribute("title");
      }
      buttons.append(this.evolve.element);
    }

    const parts: HTMLElement[] = [unseen(heading(view.top ? "Daily feed" : "Feed")), list, buttons];
    // What is short is the recipe's amber "you have" already; the sentence is the Feed button's hover.
    if (gate && view.hunger !== "fed") parts.push(unseen(gateLine(gate)));
    if (view.top && view.feedShiny !== null && view.hunger === "fed") {
      parts.push(note("Not hungry yet: a food bonus bought now costs double."));
    }
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
    header.append(portrait(championPicture(view.entry, view.level), "champion__picture"), words);
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
    const hint = actHint();
    const freeze = this.freezeTile(view, hint, () => void this.runSpecial("freeze"));
    freeze.classList.add("champion-act--special");
    freeze.disabled = this.store.isRunning(ChampionKey.freezeSpecial);
    this.freezeSpecialButton = freeze;
    const row = document.createElement("div");
    row.className = "champion__acts";
    row.append(freeze);
    block.append(row, hint);
    return [block];
  }

  private drawSpecialHealth(now: number): void {
    const line = this.specialHealth;
    const champion = specialChampion(this.store.save);
    const view = champion ? championView(this.store.save, champion, now) : null;
    if (!line || !view) return;
    const full = view.health >= view.maxHealth;
    line.replaceChildren(
      strong(`${healthLabel(view)} ${formatAmount(Math.floor(view.health))} / ${formatAmount(view.maxHealth)}`),
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

  /**
   * Freeze as a picture (owner, 28 Oct: no sentences) beside the champion's
   * picture, under it on a phone: the building that does it, a one-word action
   * and a few words on what it does or what it needs. The full sentence stays
   * for hover and screen readers, and a tap on a locked one says it under the
   * champion. Juice is gone (owner, 2026-10-28).
   */
  private acts(view: ChampionView): HTMLElement[] {
    const hint = actHint();
    const freeze = this.freezeTile(view, hint, () => void this.runFreeze(view));
    freeze.disabled = this.store.isRunning(ChampionKey.freeze);
    this.freezeButton = freeze;
    const row = document.createElement("div");
    row.className = "champion__acts";
    row.append(freeze);
    return [row, hint];
  }

  /** Freeze into the Champion Chamber (#125): reversible, so one tap. */
  private freezeTile(view: ChampionView, hint: HTMLElement, onFreeze: () => void): HTMLButtonElement {
    const problem = freezeProblem(this.store.save, view);
    return actTile({
      act: "freeze",
      type: CHAMPION_CHAMBER_TYPE,
      kind: this.store.kind,
      word: "Freeze",
      short: problem ? FREEZE_SHORT[problem] : "Keeps its level",
      sentence:
        freezeGate(this.store.save, view) ??
        "Freeze in the Chamber: frozen champions keep their level and do not get hungry. Thaw it from the Champion Chamber.",
      locked: problem !== null,
      missing: problem === "noChamber",
      hint,
      onPress: onFreeze,
    });
  }

  /* ── Requests ─────────────────────────────────────────────────────── */

  private async runRaise(entry: ChampionEntry): Promise<void> {
    const result = await this.actions.raise(entry.t);
    this.setStatus(
      result.ok
        ? { tone: "good", content: [`${entry.name} is in your cage.`] }
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
  // The heading on the tendencies' own line, to keep the cage on one screen.
  const row = document.createElement("div");
  row.className = "champion__brain-row";
  row.append(heading("How it fights"), list);
  block.append(
    row,
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

/**
 * Whose health a live health line shows, e.g. "Fomor's health": the cage
 * panel also shows the cage's own health and the champion's full health.
 */
export const healthLabel = (view: Pick<ChampionView, "name">): string => `${view.name}'s health`;

/** The numbers on a champion's card: current, with what evolving (or the next food-bonus rank) adds. */
export const statsBlock = (view: ChampionView): HTMLElement => {
  const wrap = document.createElement("div");
  wrap.className = "champion__stats-wrap";
  const list = document.createElement("ul");
  list.className = "champion__stats";
  list.setAttribute("aria-label", "Stats");
  // A painted icon where there is one; Range and Buff have none yet, so keep their word.
  const rows: ReadonlyArray<
    readonly [string, keyof ChampionStats, (value: number) => string, GameIconName | null]
  > = [
    ["Damage", "damage", formatAmount, "damage"],
    ["Max health", "health", formatAmount, "health"],
    ["Speed", "speed", (value) => String(Math.round(value * 10) / 10), "speed"],
    ["Range", "range", formatAmount, null],
    ["Buff", "buff", (value) => `${value}%`, null],
  ];
  for (const [label, key, spell, icon] of rows) {
    const now = view.stats[key];
    if (key === "buff" && now <= 0) continue;
    const item = document.createElement("li");
    item.className = "champion__stat";
    item.dataset["stat"] = key;
    const next = view.nextStats?.[key];
    const grows = next !== undefined && next !== now;
    item.title = `${label} ${spell(now)}${grows ? ` → ${spell(next)}` : ""}`;
    item.append(icon ? gameIcon(icon, { size: 16, label, tooltip: false }) : `${label} `, strong(spell(now)));
    if (grows) {
      const after = document.createElement("span");
      after.className = "champion__stat-next";
      after.textContent = ` → ${spell(next)}`;
      item.append(after);
    }
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
  if (view.nextStats) {
    const arrows = note(`Arrows show level ${view.level + 1}.`);
    arrows.classList.add("champion__note--arrows");
    wrap.append(arrows);
  }
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

/** Kept for screen readers, not drawn: what it labels shows for itself. */
const unseen = (element: HTMLElement): HTMLElement => {
  element.classList.add("u-visually-hidden");
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

/** A champion's picture, from the game's own art. */
const portrait = (picture: Portrait, className: string): HTMLImageElement => {
  const image = document.createElement("img");
  image.className = className;
  showPortrait(image, picture);
  image.alt = "";
  image.width = 150;
  image.height = 150;
  image.decoding = "async";
  return image;
};

/** A champion at a level, small, for the two ends of the evolution bar (Flash's `mcCurrGuardian`, `mcNextGuardian`). */
const stagePicture = (entry: ChampionEntry, level: number, label: string): HTMLElement => {
  const at = Math.min(Math.max(level, 1), entry.levels);
  const wrap = document.createElement("span");
  wrap.className = "champion__stage";
  const image = document.createElement("img");
  image.className = "champion__stage-picture";
  showPortrait(image, championPortrait(entry.id, at, "icon"));
  image.alt = "";
  image.width = 56;
  image.height = 56;
  image.decoding = "async";
  const badge = document.createElement("span");
  badge.className = "champion__stage-level";
  badge.textContent = `L${at}`;
  badge.setAttribute("aria-label", label);
  wrap.append(image, badge);
  return wrap;
};

/** The few words under a locked Freeze; the hover keeps {@link freezeGate}'s sentence. */
export const FREEZE_SHORT: Readonly<Record<FreezeProblem, string>> = {
  noChamber: "Needs a Chamber",
  chamberBuilding: "Chamber being built",
  hurt: "Heal it first",
  hungry: "Feed it first",
};

/** Where a tap on a locked tile says why, under the row. */
export const actHint = (): HTMLElement => {
  const hint = gateLine("");
  hint.classList.add("champion__act-hint");
  hint.setAttribute("aria-live", "polite");
  hint.hidden = true;
  return hint;
};

export interface ActTileOptions {
  readonly act: "freeze" | "thaw";
  /** The building that does it, whose picture the tile shows. */
  readonly type: number;
  readonly kind: YardKind;
  readonly word: string;
  /** What it does, or what it needs while locked: a few words. */
  readonly short: string;
  /** The whole sentence, for hover and screen readers. */
  readonly sentence: string;
  readonly locked: boolean;
  /** The building is not in the yard at all: its dark silhouette, as in the build menu. */
  readonly missing: boolean;
  readonly hint: HTMLElement;
  readonly onPress: () => void;
}

/**
 * The cage's Freeze picture, or the chamber's Freeze / Thaw.
 * A locked one is `aria-disabled` rather than disabled, so hovering it still shows why and a tap (a phone has
 * no hover) writes the reason under the row.
 */
export const actTile = (options: ActTileOptions): HTMLButtonElement => {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = `champion-act champion-act--${options.act}`;
  tile.classList.toggle("champion-act--locked", options.locked);
  tile.title = options.sentence;
  if (options.locked) tile.setAttribute("aria-disabled", "true");
  const art = document.createElement("img");
  art.className = "champion-act__art";
  art.src = (options.missing ? silhouetteUrl(options.type, options.kind) : null) ?? buttonUrl(options.type, options.kind);
  art.alt = "";
  art.width = 60;
  art.height = 80;
  art.decoding = "async";
  art.draggable = false;
  const word = document.createElement("span");
  word.className = "champion-act__word";
  word.textContent = options.word;
  const short = document.createElement("span");
  short.className = "champion-act__short";
  short.textContent = options.short;
  short.setAttribute("aria-hidden", "true");
  const spoken = document.createElement("span");
  spoken.className = "u-visually-hidden";
  spoken.textContent = `. ${options.sentence}`;
  tile.append(art, word, short, spoken);
  tile.addEventListener("click", () => {
    if (!options.locked) {
      options.onPress();
      return;
    }
    options.hint.textContent = options.sentence;
    options.hint.hidden = false;
  });
  return tile;
};
