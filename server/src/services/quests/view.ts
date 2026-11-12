import type { EventReward } from "../../game-data/events/eventRewards.js";
import { DAILY_FREE_SWAPS, LOGIN_CARD_SHINY } from "../../game-data/quests.js";
import { nextUtcMidnight, nextUtcMonday, utcDay, utcWeek } from "./period.js";
import { allDone, bonusShiny, claimableCount, loginToday, type QuestRecord, type QuestSet } from "./state.js";

/**
 * What the quest window shows (`web/src/ui/quests/QuestsPanel.ts`): the
 * login card, today's and this week's quests, the all-done bonuses, the
 * countdowns and the red number. Built from a record already rolled over to
 * `now` (`updateQuests`).
 */

export interface QuestView {
  slot: number;
  kind: string;
  variant?: string;
  need: number;
  have: number;
  claimed: boolean;
  /** Finished and not claimed: the Claim button shows. */
  ready: boolean;
  rewards: EventReward[];
}

export interface QuestSetView {
  quests: QuestView[];
  bonus: { shiny: number; ready: boolean; claimed: boolean };
}

export interface QuestsView {
  now: number;
  /** When the daily quests and the login day turn over (next 00:00 UTC). */
  nextDayAt: number;
  /** When the weekly quests turn over (next Monday 00:00 UTC). */
  nextWeekAt: number;
  /** Everything waiting for a Claim tap. */
  claimable: number;
  login: {
    /** Today's day on the card, 1-7. */
    day: number;
    claimedToday: boolean;
    /** Days claimed on the card shown. */
    onCard: number;
    shiny: number[];
  };
  daily: QuestSetView & { swapsLeft: number };
  weekly: QuestSetView;
}

const setView = (set: QuestSet | null, period: string, bonus: number): QuestSetView => {
  const current = set?.period === period ? set : null;
  return {
    quests: (current?.quests ?? []).map((quest) => ({
      slot: quest.slot,
      kind: quest.kind,
      ...(quest.variant !== undefined && { variant: quest.variant }),
      need: quest.need,
      have: quest.have,
      claimed: quest.claimed,
      ready: !quest.claimed && quest.have >= quest.need,
      rewards: quest.rewards,
    })),
    bonus: { shiny: bonus, ready: !!current && !current.bonus && allDone(current), claimed: current?.bonus ?? false },
  };
};

export const questsView = (record: QuestRecord, now: number): QuestsView => {
  const day = utcDay(now);
  const daily = setView(record.daily, day, bonusShiny("daily"));
  return {
    now,
    nextDayAt: nextUtcMidnight(now),
    nextWeekAt: nextUtcMonday(now),
    claimable: claimableCount(record, now),
    login: { ...loginToday(record, now), shiny: [...LOGIN_CARD_SHINY] },
    daily: {
      ...daily,
      swapsLeft: record.daily?.period === day ? Math.max(0, DAILY_FREE_SWAPS - record.daily.swaps) : DAILY_FREE_SWAPS,
    },
    weekly: setView(record.weekly, utcWeek(now), bonusShiny("weekly")),
  };
};
