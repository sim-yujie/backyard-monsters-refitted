import type { CalendarView, EventReward, EventView, LadderView } from "@/api/events";
import { formatAmount, formatCompact, formatCountdown } from "@/ui/format";

/**
 * What the Events page shows, worked out from `GET /bm/events` (server
 * `services/events/eventViews.ts`). Pure, so the page and its tests share it.
 *
 * Every countdown runs on the server's clock: the list carries the server's
 * `now`, and {@link serverClock} keeps the gap to the device's clock, so a
 * phone set a day wrong still counts to the real end.
 */

/** A figure for a small tile: "10K" for 10,000, "12.5K" for 12,500, "20" for 20. */
export const shortAmount = (value: number): string => {
  if (value >= 1_000 && value < 1_000_000 && value % 1_000 === 0) return `${value / 1_000}K`;
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  return formatCompact(value);
};

/** The state of one calendar day. */
export type DayState =
  /** Paid already. */
  | "claimed"
  /** Claimable now. */
  | "today"
  /** The next one, claimable once the UTC day turns. */
  | "tomorrow"
  /** Further ahead. */
  | "locked";

export interface CalendarDayView {
  /** 1-based. */
  readonly day: number;
  readonly rewards: readonly EventReward[];
  readonly state: DayState;
}

/** Each calendar day with its state. */
export const calendarDays = (calendar: CalendarView): CalendarDayView[] =>
  calendar.days.map((rewards, index) => {
    const day = index + 1;
    let state: DayState = "locked";
    if (index < calendar.claimed) state = "claimed";
    else if (index === calendar.claimed) state = calendar.canClaim ? "today" : calendar.nextAt !== null ? "tomorrow" : "locked";
    return { day, rewards, state };
  });

/** The ladder tiers the player can claim now, by index. */
export const claimableTiers = (ladder: LadderView): number[] =>
  ladder.tiers.flatMap((tier, index) => (!tier.claimed && ladder.counter >= tier.need ? [index] : []));

/** How many rewards wait to be claimed across the events that are on. */
export const claimableCount = (events: readonly EventView[]): number =>
  events
    .filter((event) => event.status === "active")
    .reduce(
      (sum, event) =>
        sum + (event.calendar?.canClaim ? 1 : 0) + (event.ladder ? claimableTiers(event.ladder).length : 0),
      0,
    );

/** The device's clock moved onto the server's: `now()` in unix seconds. */
export interface ServerClock {
  now(): number;
}

/** A clock on the server's time, from the `now` it sent and the device's time then (ms). */
export const serverClock = (serverNow: number, deviceNowMs: number, read: () => number = Date.now): ServerClock => {
  const offset = serverNow - deviceNowMs / 1000;
  return { now: () => read() / 1000 + offset };
};

/** "Ends in 3d 4h" for an event on now, "Starts in 5d 2h" for one coming up. */
export const countdownText = (event: Pick<EventView, "status" | "startsAt" | "endsAt">, now: number): string =>
  event.status === "active"
    ? `Ends in ${formatCountdown(event.endsAt - now)}`
    : `Starts in ${formatCountdown(event.startsAt - now)}`;

/** Whether the event's window has run out at `now` (the list is then stale). */
export const isOver = (event: Pick<EventView, "status" | "startsAt" | "endsAt">, now: number): boolean =>
  event.status === "active" ? now >= event.endsAt : now >= event.startsAt;

/** The store buffs an event can give, by item code (server `game-data/store/storeItems.ts`). */
export const SHOP_ITEM_NAMES: Readonly<Record<string, string>> = {
  BST: "Sharper Tools",
  POD: "Production Overdrive",
  EXH: "Housing Expansion",
};

/** How long each buff runs once switched on, for the reward's text. */
export const SHOP_ITEM_DURATIONS: Readonly<Record<string, string>> = {
  BST: "7 days",
  POD: "12 hours",
  EXH: "24 hours",
};

/** The free speed-ups, by item code. */
export const SPEEDUP_NAMES: Readonly<Record<string, string>> = {
  SP2: "1-hour speed-up",
  SP3: "2-hour speed-up",
};

const RESOURCE_WORDS = { r1: "Twigs", r2: "Pebbles", r3: "Putty", r4: "Goo" } as const;

/** One reward in words: "10,000 Twigs", "25 Shiny", "2x 1-hour speed-up". */
export const rewardText = (reward: EventReward, decorationName: (type: number) => string): string => {
  switch (reward.kind) {
    case "resources":
      return (Object.keys(RESOURCE_WORDS) as (keyof typeof RESOURCE_WORDS)[])
        .filter((key) => (reward.amounts[key] ?? 0) > 0)
        .map((key) => `${formatAmount(reward.amounts[key])} ${RESOURCE_WORDS[key]}`)
        .join(", ");
    case "shiny":
      return `${formatAmount(reward.amount)} Shiny`;
    case "shopItem": {
      const name = SHOP_ITEM_NAMES[reward.item] ?? reward.item;
      const duration = SHOP_ITEM_DURATIONS[reward.item];
      return duration ? `${name} (${duration})` : name;
    }
    case "speedup": {
      const name = SPEEDUP_NAMES[reward.item] ?? "Speed-up";
      return reward.count === 1 ? name : `${reward.count}x ${name}`;
    }
    case "decoration": {
      const name = decorationName(reward.type);
      return reward.count === 1 ? name : `${reward.count}x ${name}`;
    }
  }
};

/** The events to list: the ones on now first, then what is coming up soonest first. */
export const sortEvents = (events: readonly EventView[]): { active: EventView[]; upcoming: EventView[] } => ({
  active: events.filter((event) => event.status === "active").sort((a, b) => a.endsAt - b.endsAt),
  upcoming: events.filter((event) => event.status === "upcoming").sort((a, b) => a.startsAt - b.startsAt),
});
