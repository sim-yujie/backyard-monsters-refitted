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
 * - **Starving** (D11, "keep original"): a champion fed at `ft` is hungry
 *   from `ft` and starves at `ft + 24 h`. Below the top level it then loses
 *   one feed (not below 0, `:1062-1076`); at the top level one food-bonus rank
 *   (not below 0) and its health comes down to the new full health
 *   (`:1091-1109`). Either way the next feeding is due 23 hours after the
 *   starving, which can starve again 24 hours after that. The original
 *   restarted the timer from whenever the game next noticed; the server
 *   restarts it from the moment it starved, so the result does not depend on
 *   when the player looks. A feed time already older than the window (a save
 *   no catch-up has seen) starves once, at the window's start.
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
  /** Unix seconds it starved: its feed time plus 24 hours. */
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

    let fedAt = numberOf(champion.ft);
    while (now > fedAt + STARVE_SECONDS) {
      const at = Math.max(fedAt + STARVE_SECONDS, start);
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
      fedAt = at + entry.feedTime;
      champion.ft = fedAt;
      if (lost) {
        jobs.push({
          kind: "starve",
          id: entry.id,
          t: null,
          at,
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
