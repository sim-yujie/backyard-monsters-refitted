import type { RaidView } from "@/api/raid";
import { sheetStandInUrl, sheetUrl, spriteFor } from "@/game/attack/monsterSprites";
import { raidSheetQueue, type SheetLoader } from "@/game/attack/sheetQueue";
import type { Roster } from "@/game/combat/rules";
import { TROJAN_ROSTER } from "@/game/trojan/trojanHorse";

/**
 * Fetches a raid's monster sheets while its warning is up (patch 6.4), so the
 * fight draws its monsters from the first wave even on a slow line. A wild
 * raid lands its whole army at once, and the battle layer only asks for the
 * sheets when the fight starts: on Fast 3G a Dreadnaut raid's Crabatron and
 * Brain paintings (`@4x`) took about 30 s, and the fight was squares till then.
 * The warning is up a minute or more before the fight, and lists the army.
 *
 * Each sheet's small stand-in (`sheetStandInUrl`) is asked for first, then the
 * copy the Quality setting asks for: the same URLs, through the same queue
 * (`sheetQueue.ts`'s `raidSheetQueue`, over Pixi's `Assets`, which keeps what
 * it fetched), as the battle layer will ask for, so it finds them already in
 * or already coming. The queue fetches every stand-in before any painting,
 * and only two paintings at a time. Nothing is fetched that the fight would
 * not fetch anyway, bar the stand-ins (a sixteenth of a `@4x`).
 *
 * The Trojan Horse has no warning: its fight starts the moment its letter is
 * answered. Its army is always the same ten kinds (`TROJAN_ROSTER`), so their
 * stand-ins are fetched as soon as the horse is seen on the yard, and the
 * paintings once its letter opens ({@link warmTrojanSheets}).
 */

/** One sheet to fetch, and whether it is a stand-in. */
export interface RaidSheetAsk {
  readonly url: string;
  readonly standIn: boolean;
}

/** What a raid army's sheets come from, in order: every stand-in first, then the full copies. */
export const raidSheetAsks = (monsters: Roster): RaidSheetAsk[] => {
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
  return [
    ...standIns.map((url) => ({ url, standIn: true })),
    ...full.map((url) => ({ url, standIn: false })),
  ];
};

/** The URLs a raid army's sheets come from: every stand-in first, then the full copies. */
export const raidSheetUrls = (monsters: Roster): string[] => raidSheetAsks(monsters).map((ask) => ask.url);

/** The raid queue's loader; a test hands in its own. */
const queued: SheetLoader = (url, want) => raidSheetQueue.load(url, want);

const fetchAll = (asks: readonly RaidSheetAsk[], load: SheetLoader): string[] => {
  for (const ask of asks) {
    let fetching: Promise<unknown>;
    try {
      fetching = load(ask.url, ask.standIn ? { standIn: true } : undefined);
    } catch {
      continue;
    }
    fetching.catch(() => {});
  }
  return asks.map((ask) => ask.url);
};

/** Starts fetching a raid army's sheets; a failure is the fight's to retry. Returns the URLs asked for. */
export const warmRaidSheets = (monsters: Roster, load: SheetLoader = queued): string[] =>
  fetchAll(raidSheetAsks(monsters), load);

/** The Trojan Horse's army as a roster, kinds in the order they come out (Object keys keep it). */
const trojanRoster = (): Roster => Object.fromEntries(TROJAN_ROSTER.map((id) => [id, 1]));

/**
 * Starts fetching the Trojan Horse's sheets: with `full` false only the
 * stand-ins (the horse is on the yard, maybe for days, and the stand-ins are
 * small), with `full` the paintings too (its letter is open: the fight is a
 * click away). Asked twice, the queue and Pixi's cache fetch each once.
 */
export const warmTrojanSheets = (full: boolean, load: SheetLoader = queued): string[] => {
  const asks = raidSheetAsks(trojanRoster());
  return fetchAll(full ? asks : asks.filter((ask) => ask.standIn), load);
};

/**
 * A listener for the raid watch: warms each raid's sheets once, the first
 * time it is seen in its warning, so they are coming while the alert (or
 * Moloch's own warning) is up. A raid already fighting is another screen's.
 */
export const raidSheetWarmer = (load: SheetLoader = queued): ((raid: RaidView | null) => void) => {
  const warmed = new Set<string>();
  return (raid) => {
    if (!raid || raid.phase !== "warning" || warmed.has(raid.id)) return;
    warmed.add(raid.id);
    warmRaidSheets(raid.monsters ?? {}, load);
  };
};
