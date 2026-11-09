import type { ChampionSaveEntry } from "@/api/types";
import { isHealthyChampion } from "@/game/attack/attackEntry";
import { availableSiege, parseSiegeStock, siegeWeapon, type SiegeWeaponId } from "@/game/attack/AttackInput";
import { combatKind } from "@/game/attack/AttackSession";
import type { AttackRoster, AttackTarget, AttackTargetKind } from "@/game/attack/attackTarget";
import { BOMBS, championByType, monsterName } from "@/game/combat/rules";
import { championPortrait, monsterPortrait, showPortrait, type Portrait } from "@/game/portraits";
import { bombName } from "@/ui/attack/CatapultPanel";
import { championName } from "@/ui/attack/ArmyPanel";
import { formatAmount } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { resourceIcon, resourceKeyOf, resourceName } from "@/ui/resourceIcon";
import "@/ui/styles/attack-window.css";

/**
 * The attack window (owner, 9 Nov 2026, option A): Flash's `PopupAttackA`
 * (`maproom_advanced/PopupAttackA.as`), a centred window between the map's
 * Attack and the battle that shows what the player can bring before they
 * commit: the Catapult's bombs and the siege weapon, the champion, and the
 * monsters in range with their counts. Attack goes on into the battle exactly
 * as before; Cancel, the close disc, Escape or the scrim leave the player on
 * the map.
 *
 * Everything comes from the roster the map already built
 * (`attackEntry.ts`, `rosterInRange`): no new server data. Flash's "flung
 * from" list of source yards is left out on the owner's word ("i dont need to
 * know where its flung from"), as are its profile and alliance pictures.
 *
 * It is a {@link Popup}, so it wears the game's own window: the painted steel
 * frame in Modern, Flash's refreshed parchment in Classic (`skin.css`), with
 * the title on the sign, the close disc, and the two button plates. Pictures
 * not words: painted portraits (the originals in Classic,
 * `game/portraits.ts`), the resource piles for the bombs and the siege
 * weapon's own button art, each with a number under it and its words in the
 * tooltip and for a screen reader.
 */

/* ── What it shows ──────────────────────────────────────────────────────── */

/** The sizes a bomb comes in, smallest first (the Catapult panel's words). */
const TIER_LABELS = ["Small", "Big", "Huge", "Massive"] as const;

/** One bomb slot: Flash's `CATAPULTITEM`, one per resource. */
export interface BombSlot {
  /** 1 twigs, 2 pebbles, 3 putty. */
  readonly resource: number;
  /** The tier shown: the biggest the player can pay for, else the smallest. */
  readonly id: string;
  /** "Small", "Big", "Huge" or "Massive". */
  readonly size: string;
  /** `ready` to fire; `locked` below its Catapult level; `poor` when not even the smallest is paid for. */
  readonly state: "ready" | "locked" | "poor";
  /** The Catapult level this resource's bombs need. */
  readonly needs: number;
}

/** The siege weapon the attack offers (`SiegeWeapons.availableWeapon`). */
export interface SiegeSlot {
  readonly id: SiegeWeaponId;
  readonly name: string;
  readonly level: number;
}

export interface ChampionSlot {
  readonly t: number;
  readonly id: string;
  readonly name: string;
  readonly level: number;
}

export interface MonsterSlot {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** Its academy level, when the save carries one. */
  readonly level: number | null;
}

export interface AttackWindowModel {
  readonly catapultLevel: number;
  readonly bombs: readonly BombSlot[];
  readonly siege: SiegeSlot | null;
  readonly champions: readonly ChampionSlot[];
  readonly monsters: readonly MonsterSlot[];
  /** Every monster in range, all types together. */
  readonly total: number;
}

/**
 * The bomb each resource offers, as Flash chose it (`PopupAttackA.Update`,
 * `:330-389`): with the Catapult high enough, the biggest tier the player's
 * resources cover, walking up from the smallest and stopping at the first
 * they cannot pay for; else the smallest, greyed.
 */
export const bombSlots = (catapultLevel: number, resources: AttackRoster["resources"]): BombSlot[] =>
  [1, 2, 3].map((resource) => {
    const tiers = BOMBS.filter((bomb) => bomb.resource === resource);
    const needs = tiers[0]?.catapultLevel ?? resource;
    const held = Number(resources?.[resourceKeyOf(resource) as "r1" | "r2" | "r3"] ?? 0) || 0;
    let best = -1;
    if (catapultLevel >= needs) {
      for (const [index, bomb] of tiers.entries()) {
        if (held < bomb.cost) break;
        best = index;
      }
    }
    const shown = Math.max(0, best);
    return {
      resource,
      id: tiers[shown]?.id ?? `${resource}`,
      size: TIER_LABELS[shown] ?? "",
      state: catapultLevel < needs ? "locked" : best < 0 ? "poor" : "ready",
      needs,
    };
  });

/**
 * The champions that would go along: healthy ones only, one ordinary champion
 * and Krallen (type 5) beside it, as Flash listed them
 * (`PopupAttackA.as:267-286`) and as the attack screen allows.
 */
export const championSlots = (champions: readonly ChampionSaveEntry[]): ChampionSlot[] => {
  const slots: ChampionSlot[] = [];
  let ordinary = false;
  for (const champion of champions) {
    if (!isHealthyChampion(champion)) continue;
    if (champion.t !== 5) {
      if (ordinary) continue;
      ordinary = true;
    }
    slots.push({
      t: champion.t,
      id: championByType(champion.t) ?? `G${champion.t}`,
      name: championName(champion.t),
      level: Math.max(1, Math.trunc(champion.l) || 1),
    });
  }
  return slots;
};

/** C1, C2 … C19, then the Inferno's IC1 …: by letters, then by number. */
const byMonsterId = (a: string, b: string): number => {
  const [, aPrefix = a, aNumber = "0"] = /^([A-Z]+)(\d+)$/.exec(a) ?? [];
  const [, bPrefix = b, bNumber = "0"] = /^([A-Z]+)(\d+)$/.exec(b) ?? [];
  if (aPrefix !== bPrefix) return aPrefix.length - bPrefix.length || (aPrefix < bPrefix ? -1 : 1);
  return Number(aNumber) - Number(bNumber);
};

/** What the window shows for a roster. */
export const attackWindowModel = (roster: AttackRoster): AttackWindowModel => {
  const monsters = Object.entries(roster.monsters)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => byMonsterId(a, b))
    .map(([id, count]) => ({
      id,
      name: monsterName(id),
      count,
      level: typeof roster.levels[id] === "number" ? roster.levels[id] : null,
    }));
  const offered = availableSiege(parseSiegeStock(roster.siege));
  return {
    catapultLevel: roster.catapultLevel,
    bombs: bombSlots(roster.catapultLevel, roster.resources),
    siege: offered
      ? { id: offered.id, name: siegeWeapon(offered.id)?.name ?? offered.id, level: offered.level }
      : null,
    champions: championSlots(roster.champions),
    monsters,
    total: monsters.reduce((sum, monster) => sum + monster.count, 0),
  };
};

/**
 * Whether an attack opens this window first: a Map Room 2 yard, outpost or
 * wild camp. Map Room 1 had none in Flash (it has no range), and the
 * Inferno's own flows keep theirs.
 */
export const showsAttackWindow = (
  target: Pick<AttackTarget, "cell" | "kind" | "mapversion" | "descentYard" | "infernoTribe" | "infernoPlayer">,
): boolean => target.cell !== undefined && target.mapversion !== 1 && combatKind(target) !== "inferno";

/* ── The words ──────────────────────────────────────────────────────────── */

export const ATTACK_WINDOW_TEXT = {
  title: "Attack",
  kind: { main: "Main yard", outpost: "Outpost", wild: "Wild monsters" } satisfies Record<AttackTargetKind, string>,
  weapons: "Weapons",
  monsters: "Monsters",
  cancel: "Cancel",
  attack: "Attack",
  none: "None in range",
  level: (level: number): string => `Lv ${level}`,
  count: (count: number): string => `×${formatAmount(count)}`,
  bombTip: (slot: BombSlot): string =>
    slot.state === "locked"
      ? `${resourceName(resourceKeyOf(slot.resource), "surface")} bombs: need a level ${slot.needs} Catapult`
      : slot.state === "poor"
        ? `${bombName(slot.id)}: not enough ${resourceName(resourceKeyOf(slot.resource), "surface")}`
        : bombName(slot.id),
  siegeTip: (slot: SiegeSlot): string => `${slot.name}, level ${slot.level}`,
  championTip: (slot: ChampionSlot): string => `${slot.name}, level ${slot.level}`,
  monsterTip: (slot: MonsterSlot): string =>
    slot.level === null ? `${slot.name} ×${slot.count}` : `${slot.name} (level ${slot.level}) ×${slot.count}`,
} as const;

/* ── The window ─────────────────────────────────────────────────────────── */

/** What of the attack the window reads. */
export type AttackWindowTarget = Pick<AttackTarget, "name" | "kind" | "roster">;

/**
 * Opens the window over `container` (the overlay's modal layer) and resolves
 * true on Attack, false on Cancel, the close disc, Escape or the scrim.
 */
export const confirmAttackWindow = (container: HTMLElement, target: AttackWindowTarget): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const popup = new Popup({
      title: ATTACK_WINDOW_TEXT.title,
      className: "attack-window",
      onClose: () => answer(false),
    });
    const model = attackWindowModel(target.roster);

    popup.setHead(targetLine(target));
    popup.setContent(weaponsSection(model), monstersSection(model));

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--outline attack-window__cancel";
    cancel.textContent = ATTACK_WINDOW_TEXT.cancel;
    cancel.addEventListener("click", () => popup.close());
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--primary attack-window__go";
    go.dataset["attack"] = "";
    go.textContent = ATTACK_WINDOW_TEXT.attack;
    go.addEventListener("click", () => {
      answer(true);
      popup.close();
    });
    const actions = document.createElement("div");
    actions.className = "attack-window__actions";
    actions.append(cancel, go);
    // Under the body, not in it: the buttons stay in sight when the monsters scroll.
    popup.element.append(actions);

    popup.mount(container);
    go.focus();
  });

/** "Kozu  [Outpost]": who is being attacked. */
const targetLine = (target: AttackWindowTarget): HTMLElement => {
  const line = document.createElement("p");
  line.className = "attack-window__target";
  const name = document.createElement("strong");
  name.className = "attack-window__name";
  name.textContent = target.name;
  name.title = target.name;
  const kind = document.createElement("span");
  kind.className = "chip attack-window__kind";
  kind.textContent = ATTACK_WINDOW_TEXT.kind[target.kind];
  line.append(name, kind);
  return line;
};

const section = (icon: GameIconName, words: string, extra: HTMLElement | null, grid: HTMLElement): HTMLElement => {
  const element = document.createElement("section");
  element.className = "attack-window__section";
  const heading = document.createElement("h3");
  heading.className = "attack-window__heading";
  const label = document.createElement("span");
  label.textContent = words;
  heading.append(gameIcon(icon, { size: 24, decorative: true }), label);
  if (extra) heading.append(extra);
  element.setAttribute("aria-label", words);
  element.append(heading, grid);
  return element;
};

/** One square: a picture and a short line under it, its words in the tooltip. */
const tile = (picture: HTMLElement, caption: string, tip: string, className: string): HTMLElement => {
  const element = document.createElement("div");
  element.className = `attack-window__tile ${className}`;
  element.title = tip;
  element.setAttribute("role", "listitem");
  element.setAttribute("aria-label", tip);
  const art = document.createElement("span");
  art.className = "attack-window__art";
  art.setAttribute("aria-hidden", "true");
  art.append(picture);
  const line = document.createElement("span");
  line.className = "attack-window__caption";
  line.setAttribute("aria-hidden", "true");
  line.textContent = caption;
  element.append(art, line);
  return element;
};

const grid = (className: string): HTMLElement => {
  const element = document.createElement("div");
  element.className = `attack-window__grid ${className}`;
  element.setAttribute("role", "list");
  return element;
};

const weaponsSection = (model: AttackWindowModel): HTMLElement => {
  const list = grid("attack-window__weapons");
  for (const slot of model.bombs) {
    const icon = resourceIcon(resourceKeyOf(slot.resource), { decorative: true, realm: "surface" });
    const caption = slot.state === "locked" ? ATTACK_WINDOW_TEXT.level(slot.needs) : slot.size;
    const element = tile(icon, caption, ATTACK_WINDOW_TEXT.bombTip(slot), "attack-window__tile--bomb");
    element.dataset["bomb"] = slot.id;
    element.dataset["state"] = slot.state;
    if (slot.state !== "ready") element.classList.add("attack-window__tile--off");
    list.append(element);
  }
  if (model.siege) {
    const image = document.createElement("img");
    image.src = `/assets/siegebuttons/${model.siege.id}.png`;
    image.alt = "";
    image.decoding = "async";
    const element = tile(
      image,
      ATTACK_WINDOW_TEXT.level(model.siege.level),
      ATTACK_WINDOW_TEXT.siegeTip(model.siege),
      "attack-window__tile--siege",
    );
    element.dataset["siege"] = model.siege.id;
    list.append(element);
  }
  return section("resourcebomb", ATTACK_WINDOW_TEXT.weapons, null, list);
};

const monstersSection = (model: AttackWindowModel): HTMLElement => {
  const list = grid("attack-window__monsters");
  for (const slot of model.champions) {
    const element = tile(
      portrait(championPortrait(slot.id, slot.level, "icon")),
      ATTACK_WINDOW_TEXT.level(slot.level),
      ATTACK_WINDOW_TEXT.championTip(slot),
      "attack-window__tile--champion",
    );
    element.dataset["champion"] = slot.id;
    list.append(element);
  }
  for (const slot of model.monsters) {
    const element = tile(
      portrait(monsterPortrait(slot.id, "icon")),
      ATTACK_WINDOW_TEXT.count(slot.count),
      ATTACK_WINDOW_TEXT.monsterTip(slot),
      "attack-window__tile--monster",
    );
    element.dataset["monster"] = slot.id;
    list.append(element);
  }
  if (list.childElementCount === 0) {
    const none = document.createElement("p");
    none.className = "attack-window__none";
    none.textContent = ATTACK_WINDOW_TEXT.none;
    list.append(none);
  }
  const total = document.createElement("span");
  total.className = "chip attack-window__total";
  total.textContent = formatAmount(model.total);
  total.title = `${formatAmount(model.total)} monsters in range`;
  return section("swords", ATTACK_WINDOW_TEXT.monsters, model.total > 0 ? total : null, list);
};

/** A portrait image; a broken one is dropped rather than shown as a broken picture. */
const portrait = (picture: Portrait): HTMLImageElement => {
  const image = document.createElement("img");
  showPortrait(image, picture);
  image.alt = "";
  image.decoding = "async";
  image.addEventListener("error", () => image.remove());
  return image;
};
