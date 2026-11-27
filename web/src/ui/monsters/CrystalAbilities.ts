import type { ChampionActions } from "@/api/yardChampion";
import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import {
  ABILITIES_PER_CHAMPION,
  CHAMPION_ABILITIES,
  CRYSTAL_CHAMPION_NAMES,
  CRYSTAL_CHAMPION_TYPES,
  CRYSTAL_ICON,
  abilitiesUnlocked,
  championIdOf,
  crystalsHeld,
  type AbilityInfo,
} from "@/game/events/crystals";
import { championPortrait, showPortrait } from "@/game/portraits";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/crystals.css";

/**
 * The Champion tab's Abilities view and its pop-ups (Monster Madness
 * crystals, owner's grilling 27 Nov 2026; neon's design A and pop-up 1):
 *
 * - {@link CrystalAbilities}: the crystals held, then Gorgo, Drull, Fomor and
 *   Korath, a row each: portrait, name and level (or "Not owned"), his three
 *   abilities in unlock order (unlocked, next, locked) and Unlock for one
 *   crystal; one line under them names the ability last touched.
 * - {@link confirmUnlock}: Unlock asks first, a crystal being a week's work.
 * - {@link showAbilityUnlocked}: the champion's portrait and the new ability.
 * - {@link showCrystalEarned}: a clear's crystal, with Spend now.
 *
 * The words and counts are `game/events/crystals.ts`; the server checks every
 * spend (`champion/crystal`).
 */

const BASE = import.meta.env.BASE_URL;
const url = (path: string): string => `${BASE}${path.replace(/^\//, "")}`;

/** Each ability's painted icon: the fight's stickers where one fits, else its own. */
const ABILITY_ICON: Readonly<Record<AbilityInfo["id"], string>> = {
  stoneSkin: "/status-icons/stone.webp",
  chestPound: "/ui/abilities/chest-pound.webp",
  groundSlam: "/ui/abilities/ground-slam.webp",
  bloodthirst: "/ui/abilities/bloodthirst.webp",
  twinBite: "/ui/abilities/twin-bite.webp",
  pounce: "/ui/abilities/pounce.webp",
  healingMist: "/ui/abilities/healing-mist.webp",
  bubble: "/status-icons/shielded.webp",
  acidSpit: "/status-icons/marked.webp",
  burn: "/ui/abilities/burn.webp",
  breathOfFire: "/ui/abilities/breath-of-fire.webp",
  fistsOfDoom: "/ui/abilities/fists-of-doom.webp",
};

export const abilityIconUrl = (ability: AbilityInfo): string => url(ABILITY_ICON[ability.id]);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const image = (src: string, className: string, alt = ""): HTMLImageElement => {
  const picture = el("img", className);
  picture.src = src;
  picture.alt = alt;
  picture.decoding = "async";
  return picture;
};

export const crystalIcon = (className = "crystal-icon"): HTMLImageElement => image(url(CRYSTAL_ICON), className);

/** The player's champion of type `t` as the row shows it: level, and whether frozen; null when not owned. */
export const ownedChampion = (
  champions: readonly ChampionSaveEntry[] | null | undefined,
  t: number,
): { level: number; frozen: boolean } | null => {
  const entry = (champions ?? []).find((one) => Number(one.t) === t && Number(one.status ?? 0) !== 2);
  if (!entry) return null;
  return { level: Math.max(1, Math.floor(Number(entry.l) || 1)), frozen: Number(entry.status ?? 0) === 1 };
};

/** Whether an unlocked ability waits on the champion's level (Korath's Flash gates). */
const waitsForLevel = (ability: AbilityInfo, owned: { level: number } | null): boolean =>
  ability.fromLevel > 1 && (owned?.level ?? 1) < ability.fromLevel;

/** What the Unlock confirm and the unlocked pop-up add under the sentence, or null. */
export const unlockNote = (t: number, ability: AbilityInfo, owned: { level: number } | null): string | null => {
  const name = CRYSTAL_CHAMPION_NAMES[t] ?? "him";
  if (!owned) return `Ready when you get ${name}.`;
  if (waitsForLevel(ability, owned)) return `Works from ${name} level ${ability.fromLevel}.`;
  return null;
};

export interface CrystalAbilitiesOptions {
  readonly read: () => Pick<BaseLoadResponse, "rewards" | "champion">;
  readonly actions?: Pick<ChampionActions, "crystal">;
  /** Where its pop-ups mount; the page body by default. */
  readonly popups?: () => HTMLElement;
}

/** The Abilities view: crystals held, and every crystal champion's three abilities. */
export class CrystalAbilities {
  readonly element: HTMLElement;
  private readonly options: CrystalAbilitiesOptions;
  private readonly count: HTMLElement;
  private readonly total: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly status: HTMLElement;
  private busy = false;
  private picked: { t: number; index: number } | null = null;

  constructor(options: CrystalAbilitiesOptions) {
    this.options = options;
    this.element = el("div", "crystal-abilities");
    const head = el("div", "crystal-abilities__head");
    const held = el("div", "crystal-abilities__held");
    this.count = el("strong", "crystal-abilities__count");
    held.append(crystalIcon("crystal-abilities__crystal"), this.count);
    held.setAttribute("aria-live", "polite");
    this.total = el("span", "crystal-abilities__total");
    const how = el("p", "crystal-abilities__how", "Clear Monster Madness for crystals. Each unlocks one ability.");
    head.append(held, how, this.total);
    this.rows = el("ol", "crystal-abilities__rows panel__list");
    this.inspector = el("p", "crystal-abilities__inspector");
    this.status = el("p", "crystal-abilities__status");
    this.status.setAttribute("role", "status");
    this.element.append(head, this.rows, this.inspector, this.status);
  }

  render(): void {
    const save = this.options.read();
    const crystals = crystalsHeld(save.rewards);
    this.count.textContent = String(crystals);
    this.count.setAttribute("aria-label", `${crystals} ${crystals === 1 ? "crystal" : "crystals"}`);
    const unlocked = CRYSTAL_CHAMPION_TYPES.reduce((sum, t) => sum + abilitiesUnlocked(save.rewards, t), 0);
    this.total.textContent = `${unlocked} / ${CRYSTAL_CHAMPION_TYPES.length * ABILITIES_PER_CHAMPION}`;
    this.total.title = "Abilities unlocked";
    this.rows.replaceChildren(...CRYSTAL_CHAMPION_TYPES.map((t) => this.row(t, save, crystals)));
    this.showPicked(save);
  }

  private row(t: number, save: Pick<BaseLoadResponse, "rewards" | "champion">, crystals: number): HTMLElement {
    const owned = ownedChampion(save.champion, t);
    const count = abilitiesUnlocked(save.rewards, t);
    const abilities = CHAMPION_ABILITIES[t] ?? [];
    const row = el("li", `crystal-row${owned ? "" : " crystal-row--unowned"}`);
    row.dataset.type = String(t);

    const who = el("div", "crystal-row__who");
    const portrait = el("img", "crystal-row__portrait");
    portrait.alt = "";
    showPortrait(portrait, championPortrait(championIdOf(t), owned?.level ?? 1, "icon"));
    const name = el("div", "crystal-row__name");
    name.append(el("strong", "", CRYSTAL_CHAMPION_NAMES[t] ?? ""));
    const pill = owned
      ? el("span", "crystal-pill", owned.frozen ? `Lv ${owned.level} · Frozen` : `Lv ${owned.level}`)
      : el("span", "crystal-pill crystal-pill--muted", "Not owned");
    name.append(pill);
    who.append(portrait, name);

    const slots = el("div", "crystal-row__slots");
    abilities.forEach((ability, index) => {
      const state = index < count ? "unlocked" : index === count ? "next" : "locked";
      const slot = el("button", `crystal-slot crystal-slot--${state}`);
      slot.type = "button";
      slot.append(image(abilityIconUrl(ability), "crystal-slot__icon"), el("span", "crystal-slot__name", ability.name));
      if (state === "next" && crystals > 0) slot.classList.add("crystal-slot--ready");
      if (ability.fromLevel > 1) {
        const gate = el("span", "crystal-slot__gate", `Lv ${ability.fromLevel}+`);
        if (state === "unlocked" && !waitsForLevel(ability, owned)) gate.classList.add("crystal-slot__gate--met");
        slot.append(gate);
      }
      if (state === "unlocked") slot.append(el("span", "crystal-slot__tick", "✓"));
      const words = { unlocked: "unlocked", next: "next to unlock", locked: "locked" }[state];
      slot.setAttribute("aria-label", `${ability.name}, ${words}. ${ability.line}`);
      slot.setAttribute("aria-pressed", String(this.picked?.t === t && this.picked.index === index));
      slot.addEventListener("click", () => {
        this.picked = { t, index };
        this.render();
      });
      slots.append(slot);
    });

    const act = el("div", "crystal-row__act");
    if (count >= ABILITIES_PER_CHAMPION) {
      act.append(el("span", "crystal-row__done", "3/3 ✓"));
    } else {
      const unlock = el("button", "btn btn--primary crystal-row__unlock");
      unlock.type = "button";
      unlock.append(crystalIcon("crystal-row__unlock-icon"), el("span", "", "Unlock"));
      unlock.disabled = crystals < 1 || this.busy || !this.options.actions;
      unlock.title = crystals < 1 ? "No crystal yet" : `Unlock ${abilities[count]?.name ?? ""}`;
      unlock.setAttribute("aria-label", `Unlock ${abilities[count]?.name ?? ""} for ${CRYSTAL_CHAMPION_NAMES[t]}, 1 crystal`);
      unlock.addEventListener("click", () => void this.spend(t, count, owned));
      act.append(unlock);
    }
    row.append(who, slots, act);
    return row;
  }

  private showPicked(save: Pick<BaseLoadResponse, "rewards" | "champion">): void {
    const picked = this.picked ?? this.firstNext(save);
    const ability = picked ? CHAMPION_ABILITIES[picked.t]?.[picked.index] : undefined;
    if (!picked || !ability) {
      this.inspector.replaceChildren();
      return;
    }
    const note = unlockNote(picked.t, ability, ownedChampion(save.champion, picked.t));
    this.inspector.replaceChildren(
      image(abilityIconUrl(ability), "crystal-abilities__inspector-icon"),
      el("strong", "", `${ability.name}: `),
      document.createTextNode(ability.line),
      ...(note ? [el("span", "crystal-abilities__note", ` ${note}`)] : []),
    );
  }

  private firstNext(save: Pick<BaseLoadResponse, "rewards">): { t: number; index: number } | null {
    for (const t of CRYSTAL_CHAMPION_TYPES) {
      const count = abilitiesUnlocked(save.rewards, t);
      if (count < ABILITIES_PER_CHAMPION) return { t, index: count };
    }
    return null;
  }

  private async spend(t: number, index: number, owned: { level: number } | null): Promise<void> {
    const actions = this.options.actions;
    const ability = CHAMPION_ABILITIES[t]?.[index];
    if (!actions || !ability || this.busy) return;
    const container = this.options.popups?.() ?? document.body;
    if (!(await confirmUnlock(container, t, ability, owned))) return;
    this.busy = true;
    this.status.textContent = "";
    this.render();
    const result = await actions.crystal(t);
    this.busy = false;
    if (result.ok) {
      this.picked = { t, index };
      showAbilityUnlocked(container, t, index, owned);
    } else {
      this.status.textContent = result.refusal.message;
    }
    this.render();
  }
}

/** The portrait with the ability's icon on its corner, as both pop-ups show it. */
const hero = (t: number, ability: AbilityInfo, level: number): HTMLElement => {
  const wrap = el("div", "crystal-hero");
  const portrait = el("img", "crystal-hero__portrait");
  portrait.alt = CRYSTAL_CHAMPION_NAMES[t] ?? "";
  showPortrait(portrait, championPortrait(championIdOf(t), level, "card"));
  wrap.append(portrait, image(abilityIconUrl(ability), "crystal-hero__icon"));
  return wrap;
};

const actionsRow = (...buttons: HTMLElement[]): HTMLElement => {
  const row = el("div", "crystal-dialog__actions");
  row.append(...buttons);
  return row;
};

const button = (text: string, className: string, onClick: () => void): HTMLButtonElement => {
  const element = el("button", `btn ${className}`);
  element.type = "button";
  element.addEventListener("click", onClick);
  if (className.includes("crystal")) element.append(crystalIcon("crystal-dialog__button-icon"));
  element.append(el("span", "", text));
  return element;
};

/** Unlock asks first; true on Unlock, false on Cancel, Escape or the scrim. */
export const confirmUnlock = (
  container: HTMLElement,
  t: number,
  ability: AbilityInfo,
  owned: { level: number } | null,
): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const popup = new Popup({ title: `Unlock ${ability.name}?`, className: "crystal-dialog", onClose: () => answer(false) });
    const note = unlockNote(t, ability, owned);
    popup.setContent(
      hero(t, ability, owned?.level ?? 1),
      el("p", "crystal-dialog__line", ability.line),
      ...(note ? [el("p", "crystal-dialog__note", note)] : []),
      actionsRow(
        button("Cancel", "btn--ghost", () => popup.close()),
        button("Unlock · 1", "btn--primary crystal-dialog__go", () => {
          answer(true);
          popup.close();
        }),
      ),
    );
    popup.mount(container);
  });

/** The proper unlock pop-up (owner): the champion's portrait and the new ability. */
export const showAbilityUnlocked = (
  container: HTMLElement,
  t: number,
  index: number,
  owned: { level: number } | null,
): Popup | null => {
  const ability = CHAMPION_ABILITIES[t]?.[index];
  if (!ability) return null;
  const popup = new Popup({ title: "Ability unlocked", className: "crystal-dialog crystal-dialog--unlocked" });
  const note = unlockNote(t, ability, owned);
  popup.setContent(
    hero(t, ability, owned?.level ?? 1),
    el("h3", "crystal-dialog__name", ability.name),
    el("p", "crystal-dialog__sub", `${CRYSTAL_CHAMPION_NAMES[t]} · Ability ${index + 1}`),
    el("p", "crystal-dialog__line", ability.line),
    ...(note ? [el("p", "crystal-dialog__note", note)] : []),
    actionsRow(button("OK", "btn--primary", () => popup.close())),
  );
  popup.mount(container);
  return popup;
};

/** A clear's crystal: +1, and Spend now opens the Abilities view. */
export const showCrystalEarned = (container: HTMLElement, held: number, onSpend: () => void): Popup => {
  const popup = new Popup({ title: "Crystal earned", className: "crystal-dialog crystal-dialog--earned" });
  const big = el("div", "crystal-dialog__earned");
  big.append(crystalIcon("crystal-dialog__earned-icon"), el("strong", "", "+1 Crystal"));
  popup.setContent(
    big,
    el("p", "crystal-dialog__line", "Unlock any champion ability."),
    el("p", "crystal-dialog__sub", `You hold ${held}.`),
    actionsRow(
      button("Later", "btn--ghost", () => popup.close()),
      button("Spend now", "btn--primary", () => {
        popup.close();
        onSpend();
      }),
    ),
  );
  popup.mount(container);
  return popup;
};
