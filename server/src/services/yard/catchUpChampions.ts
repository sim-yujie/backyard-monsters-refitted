import { atChampionLevel, STARVE_SECONDS } from "../../game-data/championCatalogue.js";
import {
  CHAMPION_STATUS,
  entryOf,
  feedsOf,
  foodBonusOf,
  levelOf,
  maxHealthOf,
  readChampions,
  statusOf,
} from "./champion.js";

/**
 * Catch-up step 5: champions in the cage heal and starve while the player is
 * away (`docs/design/yard-buildings.md` §7.2 "Catch-up", decision D11).
 *
 * The original did both in the champion's pen tick
 * (`client/scripts/com/monsters/monsters/champions/ChampionBase.tickBPen`,
 * `ChampionBase.as:1043-1109`), which also ran during the load replay:
 *
 * - **Heal**: every 5 seconds below full health, `int(max × 5 / healtime)`
 *   (`:1047-1053`). Counted here in whole 5-second periods of the clock
 *   (`floor(now / 5) − floor(from / 5)`), so frequent requests lose nothing to
 *   rounding and a second run at the same moment adds nothing.
 * - **Starving** (D11 and the owner's 2026-09-28 ruling: exactly as the
 *   original): a champion fed at `ft` is hungry from `ft` and starving past
 *   `ft + 24 h`. A catch-up that finds it starving takes away ONE feed below
 *   the top level (not below 0, `:1062-1076`) or ONE food-bonus rank at the
 *   top (not below 0, health down to the new full health, `:1091-1109`), and
 *   restarts the feed timer from that moment, `now + 23 h`, as the original
 *   did with `GLOBAL.Timestamp()`. At most one loss per catch-up, however long
 *   the player was away: nothing is back-filled.
 *
 * Frozen (1), juiced (2) and other statuses do nothing: a frozen champion does
 * not heal or starve (`CHAMPIONCHAMBER.as:127`, MH §7.6). Krallen (status 0,
 * alongside the basic champion) heals and starves like the others, as its
 * class shares the tick.
 *
 * Pure apart from mutating the save it is handed; idempotent.
 */

/** A champion starving, as `completed` spells it. Only written when it cost something. */
export interface StarveJob {
  kind: "starve";
  /** The champion, `G1`..`G5`. */
  id: string;
  t: null;
  /** Unix seconds the loss was taken: the catch-up's `now`. */
  at: number;
  detail: {
    /** The champion's level, which starving never changes. */
    level: number;
    /** Feeds at that level afterwards (below the top level). */
    feeds: number;
    /** Food-bonus rank afterwards (at the top level). */
    foodBonus: number;
  };
}

/** The slice of a save this step reads and writes. */
export interface CatchUpChampionsSave {
  champion?: unknown;
}

/** The original replayed at most 30 days on load (`advanceBuildingTimers.ts`). */
const MAX_ELAPSED_SECONDS = 60 * 60 * 24 * 30;

/** Seconds between two passive heals (`ChampionBase.as:1047`). */
const HEAL_PERIOD = 5;

/** A finite number off a jsonb field, 0 otherwise. */
const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/**
 * Heals and starves every champion in the cage from `from` to `now`.
 *
 * @param save - The yard, its `champion` column replaced when anything changed.
 * @param from - Unix seconds of the last catch-up (`savetime`).
 * @param now - Unix seconds to advance to.
 * @returns What starved, oldest first.
 */
export const catchUpChampions = (
  save: CatchUpChampionsSave,
  from: number,
  now: number
): StarveJob[] => {
  const champions = readChampions(save.champion);
  if (champions.length === 0) return [];

  const start = Math.min(now, Math.max(from, now - MAX_ELAPSED_SECONDS));
  const periods = Math.max(0, Math.floor(now / HEAL_PERIOD) - Math.floor(start / HEAL_PERIOD));
  const jobs: StarveJob[] = [];
  let changed = false;

  champions.forEach((stored, index) => {
    const entry = entryOf(stored);
    if (!entry || statusOf(stored) !== CHAMPION_STATUS.ACTIVE) return;
    const champion = { ...stored };
    const level = levelOf(champion, entry);

    const max = maxHealthOf(champion, entry);
    const hp = numberOf(champion.hp);
    if (hp < max && periods > 0) {
      const rate = Math.trunc((max * HEAL_PERIOD) / atChampionLevel(entry.healtime, level));
      champion.hp = Math.min(max, hp + rate * periods);
    }

    if (now > numberOf(champion.ft) + STARVE_SECONDS) {
      let lost = false;
      if (level >= entry.levels) {
        const rank = foodBonusOf(champion);
        if (rank > 0) {
          champion.fb = rank - 1;
          champion.hp = Math.min(numberOf(champion.hp), maxHealthOf(champion, entry));
          lost = true;
        }
      } else if (feedsOf(champion) > 0) {
        champion.fd = feedsOf(champion) - 1;
        lost = true;
      }
      champion.ft = now + entry.feedTime;
      if (lost) {
        jobs.push({
          kind: "starve",
          id: entry.id,
          t: null,
          at: now,
          detail: { level, feeds: feedsOf(champion), foodBonus: foodBonusOf(champion) },
        });
      }
    }

    if (champion.hp !== stored.hp || champion.ft !== stored.ft) {
      champions[index] = champion;
      changed = true;
    }
  });

  if (changed) save.champion = champions;
  return jobs;
};
