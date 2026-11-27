/**
 * Monster skins: the same monster, drawn another way (beta 10's Christmas
 * frost tribe, owner 27 Nov 2026: roster C, "strong frost").
 *
 * A skin changes ONLY how a creep looks. A frost Pokey is a Pokey: same id
 * (`C1`), same stats, same abilities, same frames and headings, so the
 * combat rules, the server and the replays never hear of skins. Whoever puts
 * a fight on screen says which side wears one (a frost raid's raiders, a
 * frost camp's defenders; {@link BattleSkins}) and the battle layer draws
 * those creeps from the skin's sheets.
 *
 * A skinned sheet is the base sheet's table row with its own cache key
 * (`C1~frost`, so a frost and a normal Pokey in one fight get their own
 * textures) and the same `file`, so everything keyed by the base file (the
 * repaint, its layout, mirrored headings, the Quality copies) applies
 * unchanged. Only the URL differs: `monsters/<name>` becomes
 * `monsters/frost/<name>`, the same picture recoloured cell for cell
 * (`web/tools/frost-kit/frost_sheets.py`), for the Flash sheet (Classic look)
 * and for each copy of the painting (Modern look, High/Medium/Low).
 */

import type { MonsterSheet } from "./monsterSpriteData";

/** The skins there are. */
export type MonsterSkin = "frost";

/** Which side of a fight wears a skin; absent, the side is drawn as itself. */
export interface BattleSkins {
  /** The side that came to the yard: an attack's monsters, a raid's or wave's raiders. */
  readonly attackers?: MonsterSkin;
  /** The yard's own side: bunker monsters, guards, a camp's defenders. */
  readonly defenders?: MonsterSkin;
}

/** The skin a creep is drawn with: its side's, if its monster has that skin. */
export const creepSkin = (
  skins: BattleSkins | null | undefined,
  monsterId: string,
  friendly: boolean,
): MonsterSkin | undefined => {
  const skin = friendly ? skins?.defenders : skins?.attackers;
  return skin && hasSkin(monsterId, skin) ? skin : undefined;
};

/**
 * The frost tribe's monsters (roster C): one per role. Every other monster
 * in a frost fight is drawn as itself.
 */
export const FROST_MONSTERS: ReadonlySet<string> = new Set(["C1", "C5", "C6", "C8", "C9", "C10", "C14", "C16"]);

/** Whether a monster has sheets for a skin. */
export const hasSkin = (monsterId: string, skin: MonsterSkin): boolean =>
  skin === "frost" && FROST_MONSTERS.has(monsterId);

/** A sheet as a skin draws it; see {@link skinnedSheet}. */
export interface SkinnedSheet extends MonsterSheet {
  readonly skin?: MonsterSkin;
}

const skinned = new Map<MonsterSkin, Map<MonsterSheet, SkinnedSheet>>();

/** The base sheet with the skin's cache key; the same object each time. */
export const skinnedSheet = (sheet: MonsterSheet, skin: MonsterSkin): SkinnedSheet => {
  const bySheet = skinned.get(skin) ?? new Map<MonsterSheet, SkinnedSheet>();
  skinned.set(skin, bySheet);
  const known = bySheet.get(sheet);
  if (known) return known;
  const made: SkinnedSheet = { ...sheet, key: `${sheet.key}~${skin}`, skin };
  bySheet.set(sheet, made);
  return made;
};

/** The skin a sheet was made for, if any. */
export const sheetSkin = (sheet: MonsterSheet): MonsterSkin | undefined => (sheet as SkinnedSheet).skin;

/** `monsters/pokey-anim@4x.png` -> `monsters/frost/pokey-anim@4x.png`: the skin's copy of a file. */
export const skinFile = (file: string, skin: MonsterSkin): string => {
  const slash = file.lastIndexOf("/");
  return `${file.slice(0, slash + 1)}${skin}/${file.slice(slash + 1)}`;
};
