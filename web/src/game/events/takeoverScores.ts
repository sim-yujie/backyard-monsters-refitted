import { shortAmount } from "./eventsModel";

/**
 * What a takeover scored in the events that count takeovers (Monster Madness,
 * server `services/events/takeoverEvents.ts`): the takeover answer's
 * `eventPoints`. The answer arrives on the map or the end-of-attack panel and
 * the new outpost's "Veni, Vidi, Vici!" shows it, so the last answer's scores
 * wait here, one per tab, until that yard takes them.
 */
export interface TakeoverScore {
  /** The event's id, e.g. `monster-madness-1762819200`. */
  readonly event: string;
  /** The points this takeover added. */
  readonly points: number;
  /** The player's points in the event now. */
  readonly total: number;
}

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** The answer's `eventPoints`, checked: the field is the server's. */
export const takeoverScoresOf = (value: unknown): TakeoverScore[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((one: unknown) => {
    if (typeof one !== "object" || one === null) return [];
    const { event, points, total } = one as Record<string, unknown>;
    const scored = whole(points);
    const sum = whole(total);
    if (typeof event !== "string" || event === "" || !scored || sum === null) return [];
    return [{ event, points: scored, total: sum }];
  });
};

/** Whether an event id is a Monster Madness run's (`monster-madness-<start>`). */
export const isMonsterMadness = (event: string): boolean => event.startsWith("monster-madness");

/** The event's name for a score: "Monster Madness", or "Event" for one this client does not know. */
const eventName = (event: string): string => (isMonsterMadness(event) ? "Monster Madness" : "Event");

/** A score in words, for a screen reader and the hover: "+2.1M Monster Madness points, 45M in all". */
export const takeoverScoreText = (score: TakeoverScore): string =>
  `+${shortAmount(score.points)} ${eventName(score.event)} points, ${shortAmount(score.total)} in all`;

let waiting: TakeoverScore[] = [];

export const takeoverScores = {
  /** A takeover's answer: replaces what an earlier one left unshown. */
  set(value: unknown): void {
    waiting = takeoverScoresOf(value);
  },
  /** The scores waiting, once: the next call gives none. */
  take(): TakeoverScore[] {
    const scores = waiting;
    waiting = [];
    return scores;
  },
};
