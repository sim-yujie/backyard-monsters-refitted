import { noteCoins, onCoinsGained, type CoinsGained } from "@/game/eventCoins";
import { coinGain, coinWords } from "@/ui/events/coinUi";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for event coins (beta 7, `game/eventCoins.ts`): hands the
 * yard load's purse to the coin module, and shows a short "[coin] +25"
 * notice each time coins arrive that no claim notice already shows. Coins
 * come from big events' calendar days and ladder tiers (owner, 8 Nov 2026)
 * and from weekend events: 25 on the first yard load of the weekend (this
 * load's `coinsgained`), 75 for the first boost used (owner, 12 Nov 2026).
 */

export const COINS_NOTICE = "event-coins";
const NOTICE_MS = 6_000;

/** What paid, in one or two words; "" when the server did not say. */
const REASON_WORDS: Readonly<Record<string, string>> = {
  calendar: "Daily",
  ladder: "Event",
  "weekend-played": "Weekend",
  "weekend-boost": "Boost",
  // An announcement's Glimmers gift (server `GLIMMERS_REASON`).
  announcement: "Gift",
};

/** "Daily", "Daily + Event", or "" for an unnamed gain. */
export const gainWords = (reasons: readonly string[]): string =>
  [
    ...new Set(
      reasons
        .map((reason) => REASON_WORDS[reason])
        .filter((word): word is string => Boolean(word)),
    ),
  ].join(" + ");

/** The notice's line: "[coin] +15 Daily". */
export const gainLine = (gained: CoinsGained): HTMLElement => {
  const line = document.createElement("span");
  line.className = "coins-gained";
  const words = gainWords(gained.reasons);
  line.setAttribute(
    "aria-label",
    `${coinWords(gained.amount)} gained${words ? `: ${words}` : ""}`,
  );
  line.append(coinGain(gained.amount, { size: 24, decorative: true }));
  if (words) {
    const why = document.createElement("span");
    why.className = "coins-gained__why";
    why.textContent = words;
    line.append(" ", why);
  }
  return line;
};

/**
 * Coins a claim on the Events page paid show on that claim's own "Day 3
 * claimed" notice; a second "+15" beside it would say the same twice
 * (ASSUMED).
 */
export const claimOnly = (reasons: readonly string[]): boolean =>
  reasons.length > 0 && reasons.every((reason) => reason === "calendar" || reason === "ladder");

export const eventCoinsPlugin: YardPlugin = ({ store, notices }) => {
  const stop = onCoinsGained((gained) => {
    if (claimOnly(gained.reasons)) return;
    notices.show(COINS_NOTICE, gainLine(gained), { level: "info", timeoutMs: NOTICE_MS });
  });
  // The main yard's load carries the purse.
  const save = store.save;
  if (typeof save.eventcoins === "number") noteCoins(save.eventcoins, save.coinsgained);
  return () => {
    stop();
    notices.clear(COINS_NOTICE);
  };
};

YARD_PLUGINS.push(eventCoinsPlugin);
