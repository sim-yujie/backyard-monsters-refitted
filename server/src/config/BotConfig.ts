/**
 * The switches for Map Room 1 bot neighbours (issue #235,
 * `docs/design/bot-neighbours.md` §10). All three are off unless set to `on`,
 * so a server that has never heard of bots behaves exactly as before.
 *
 * - `BOTS_FILL`    — `on`: bots fill the Map Room 1 neighbour places real
 *                    players leave empty.
 * - `BOTS_BRAIN`   — `on`: the bot sweep runs (grow, repair, rebalance).
 * - `BOTS_REVENGE` — `on`: an attacked bot may attack back. Off stops new
 *                    revenge and cancels pending jobs.
 * - `BOTS_TOTAL`          — how many active bots to keep (default 500).
 * - `BOTS_DAYS_PER_LEVEL` — the growth pace: days a bot spends on each level
 *                           (default 3).
 *
 * Read on each call rather than once at import, so tests can flip them.
 */

export const DEFAULT_BOTS_TOTAL = 500;
export const DEFAULT_BOTS_DAYS_PER_LEVEL = 3;

export interface BotConfig {
  readonly fill: boolean;
  readonly brain: boolean;
  readonly revenge: boolean;
  readonly total: number;
  readonly daysPerLevel: number;
}

/** Whether a switch is turned on: `on` or `true`, any case; anything else is off. */
export const isSwitchOn = (raw: string | undefined): boolean => {
  const value = raw?.trim().toLowerCase();
  return value === "on" || value === "true";
};

/** A positive number from the environment, or the fallback when absent or not one. */
export const positiveNumber = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value > 0 ? value : fallback;
};

/** The bot switches as the environment sets them now. */
export const botConfig = (): BotConfig => ({
  fill: isSwitchOn(process.env.BOTS_FILL),
  brain: isSwitchOn(process.env.BOTS_BRAIN),
  revenge: isSwitchOn(process.env.BOTS_REVENGE),
  total: Math.floor(positiveNumber(process.env.BOTS_TOTAL, DEFAULT_BOTS_TOTAL)) || DEFAULT_BOTS_TOTAL,
  daysPerLevel: positiveNumber(process.env.BOTS_DAYS_PER_LEVEL, DEFAULT_BOTS_DAYS_PER_LEVEL),
});
