import { mulberry32 } from "../../game-rules/combat/rng.js";

/**
 * A bot's Shiny (`save.credits`), about what a player of its level holds
 * (issue #254, owner decision on #245's leak audit, `docs/design/bot-neighbours.md` §4.6).
 * An attacker's view and attack loads carry the defender's credits, so every
 * bot holding the new-save 1,500 would be a tell.
 *
 * ## The band
 *
 * A player at level `L` has played about `3 (L - 1)` days at the bots' pace
 * (decision 17) and has earned the sign-up 1,500 (`GameConfig.ts` `shiny`),
 * 500 a month (`scripts/monthly-shiny.ts`, about 50 a level) and the golden
 * mushrooms (one mushroom per 4.8 hours, one in four golden at 3 or 8 Shiny:
 * about 6 a day, 18 a level): about `1500 + 68 (L - 1)` in all. What they hold
 * is that less what they spent on workers, expansions and speed-ups (20 to
 * 2,000 a time, `game-data/store/storeItems.ts`). So the band runs from a
 * spender's leftovers, {@link SHINY_FLOOR} + {@link SHINY_FLOOR_PER_LEVEL} a
 * level, to a saver who has spent next to nothing, {@link SHINY_CEILING} +
 * {@link SHINY_CEILING_PER_LEVEL} a level: 120-1,800 at level 1, 435-2,430 at
 * level 10, 1,485-4,530 at level 40.
 *
 * ## Draws and drift
 *
 * The factory draws a bot's Shiny from its seed ({@link shinyForSeed}), so a
 * run is repeatable without moving any other draw. Each grow
 * ({@link tendShiny}) lets it drift up a few as mushrooms and grants would,
 * spends a slice when it reaches the top of the band, and redraws it when it
 * is outside the band for the bot's level or still the new-save 1,500 (a bot
 * made before this). A drawn or drifted amount is never a multiple of ten,
 * so never the 1,500 every new save starts with.
 */

/** A spender's leftovers at level 1, and what a level adds to it. */
export const SHINY_FLOOR = 120;
export const SHINY_FLOOR_PER_LEVEL = 35;

/** A saver's hoard at level 1, and what a level adds to it. */
export const SHINY_CEILING = 1800;
export const SHINY_CEILING_PER_LEVEL = 70;

/** The new-save Shiny every bot was made with before the band (`GameConfig.ts`). */
export const LEGACY_BOT_SHINY = 1500;

/** The most a grow adds: about a golden mushroom and a slice of the month's grant. */
export const SHINY_DRIFT_MAX = 14;

/** Mixed into `bot.seed` so the Shiny draw is its own stream, apart from the yard's. */
const SHINY_SALT = 0x5a1e5;

/** The Shiny a player of `level` might hold, inclusive. */
export const shinyBand = (level: number): { min: number; max: number } => {
  const above = Math.max(0, Math.floor(level) - 1);
  return { min: SHINY_FLOOR + SHINY_FLOOR_PER_LEVEL * above, max: SHINY_CEILING + SHINY_CEILING_PER_LEVEL * above };
};

/** `amount` moved off a multiple of ten by 1-9, staying in `band`. */
const unround = (amount: number, band: { min: number; max: number }, rng: () => number): number => {
  if (amount % 10 !== 0) return amount;
  const step = 1 + Math.floor(rng() * 9);
  return amount + step <= band.max ? amount + step : amount - step;
};

/**
 * A fresh draw inside the band for `level`, leaning to its middle (the mean
 * of two draws), never a multiple of ten.
 */
export const drawShiny = (level: number, rng: () => number): number => {
  const band = shinyBand(level);
  const amount = band.min + Math.floor(((rng() + rng()) / 2) * (band.max - band.min + 1));
  return unround(amount, band, rng);
};

/** The factory's draw for a bot of `level` with `seed` (`bot.seed`): the same every time. */
export const shinyForSeed = (seed: number, level: number): number => {
  const rng = mulberry32((seed ^ SHINY_SALT) >>> 0);
  return drawShiny(level, rng.float);
};

/**
 * A bot's Shiny after a grow on `level` (see the file comment): redrawn when
 * outside the band or still the new-save 1,500, otherwise up by 1 to
 * {@link SHINY_DRIFT_MAX}, or, when that would pass the top, cut to 25-75% of
 * the way up from the bottom, as a player spending on a worker would.
 */
export const tendShiny = (credits: number, level: number, rng: () => number): number => {
  const band = shinyBand(level);
  const have = Math.floor(Number(credits) || 0);
  if (have === LEGACY_BOT_SHINY || have < band.min || have > band.max) return drawShiny(level, rng);
  const drifted = have + 1 + Math.floor(rng() * SHINY_DRIFT_MAX);
  const amount =
    drifted <= band.max ? drifted : band.min + Math.floor((have - band.min) * (0.25 + 0.5 * rng()));
  return unround(amount, band, rng);
};
