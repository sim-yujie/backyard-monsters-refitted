import { artUrl } from "@/artUrl";
import { classicLook } from "@/game/classicLook";
import { championPortrait, monsterPortrait, showPortrait } from "@/game/portraits";
import { monsterName } from "@/game/combat/rules";

/**
 * Pictures for the wave events' screens: the totem at a level in the look the
 * player chose (Flash's `top<n>.png`, Modern's `totem-l<n>.modern@2x.webp`,
 * `decorationModernArt.ts`), and a wave's monsters as portraits.
 */

const TOTEM_FOLDERS: Readonly<Record<number, string>> = { 121: "wmitotem", 131: "wmitotem2" };

/** The totem's picture at `level` (1-6; 0 shows level 1). */
export const totemPicture = (type: number, level: number): string => {
  const folder = TOTEM_FOLDERS[type] ?? "wmitotem";
  const at = Math.min(6, Math.max(1, Math.trunc(level) || 1));
  const file = classicLook() ? (at === 5 ? "top5.v2.png" : `top${at}.png`) : `totem-l${at}.modern@2x.webp`;
  return artUrl(`/assets/buildings/decorations/${folder}/${file}`);
};

/** An `<img>` of the totem. */
export const totemImage = (type: number, level: number, className: string): HTMLImageElement => {
  const image = document.createElement("img");
  image.className = className;
  image.alt = "";
  image.decoding = "async";
  image.src = totemPicture(type, level);
  return image;
};

const CHAMPION_NAMES: Readonly<Record<string, string>> = { G1: "Gorgo", G2: "Drull", G3: "Fomor" };

/** A wave's monster (or champion, `G1`-`G3`) by name. */
export const waveMonsterName = (id: string): string => CHAMPION_NAMES[id] ?? monsterName(id);

/** A wave's monster's portrait. */
export const waveMonsterImage = (id: string, className: string): HTMLImageElement => {
  const image = document.createElement("img");
  image.className = className;
  image.alt = "";
  image.decoding = "async";
  showPortrait(image, id in CHAMPION_NAMES ? championPortrait(id, 1, "icon") : monsterPortrait(id, "icon"));
  return image;
};
