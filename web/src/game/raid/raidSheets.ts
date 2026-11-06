import type { RaidView } from "@/api/raid";
import { loadSheet, type SheetLoader } from "@/game/attack/AttackBattleLayer";
import { sheetStandInUrl, sheetUrl, spriteFor } from "@/game/attack/monsterSprites";
import type { Roster } from "@/game/combat/rules";

/**
 * Fetches a raid's monster sheets while its warning is up (patch 6.4), so the
 * fight draws its monsters from the first wave even on a slow line. A wild
 * raid lands its whole army at once, and the battle layer only asks for the
 * sheets when the fight starts: on Fast 3G a Dreadnaut raid's Crabatron and
 * Brain paintings (`@4x`) took about 30 s, and the fight was squares till then.
 * The warning is up a minute or more before the fight, and lists the army.
 *
 * Each sheet's small stand-in (`sheetStandInUrl`) is asked for first, then the
 * copy the Quality setting asks for: the same URLs, through the same loader
 * (`loadSheet`, Pixi's `Assets`, which keeps what it fetched), as the battle
 * layer will ask for, so it finds them already in. Nothing is fetched that the
 * fight would not fetch anyway, bar the stand-ins (a sixteenth of a `@4x`).
 */

/** The URLs a raid army's sheets come from: every stand-in first, then the full copies. */
export const raidSheetUrls = (monsters: Roster): string[] => {
  const standIns: string[] = [];
  const full: string[] = [];
  for (const [id, count] of Object.entries(monsters)) {
    if (!(count > 0)) continue;
    // Raiders are never champions, so the level does not pick the sheet.
    const sheet = spriteFor(id);
    if (!sheet) continue;
    const standIn = sheetStandInUrl(sheet);
    if (standIn && !standIns.includes(standIn)) standIns.push(standIn);
    const url = sheetUrl(sheet);
    if (!full.includes(url)) full.push(url);
  }
  return [...standIns, ...full];
};

/** Starts fetching a raid army's sheets; a failure is the fight's to retry. Returns the URLs asked for. */
export const warmRaidSheets = (monsters: Roster, load: SheetLoader = loadSheet): string[] => {
  const urls = raidSheetUrls(monsters);
  for (const url of urls) load(url).catch(() => {});
  return urls;
};

/**
 * A listener for the raid watch: warms each raid's sheets once, the first
 * time it is seen in its warning, so they are coming while the alert (or
 * Moloch's own warning) is up. A raid already fighting is another screen's.
 */
export const raidSheetWarmer = (load: SheetLoader = loadSheet): ((raid: RaidView | null) => void) => {
  const warmed = new Set<string>();
  return (raid) => {
    if (!raid || raid.phase !== "warning" || warmed.has(raid.id)) return;
    warmed.add(raid.id);
    warmRaidSheets(raid.monsters ?? {}, load);
  };
};
