/**
 * Feeding the champion, as Flash drew it: the rules, with no Pixi.
 *
 * A feed is decided on the server (`POST /bm/yard/champion/feed`): the
 * monsters are out of housing and the champion fed before any of this starts.
 * What follows is only the picture (`feedNews.ts`), so leaving the yard or
 * reloading half way loses nothing and doubles nothing.
 *
 * ## The walk (`CHAMPIONCAGE.as:819-843`, `MonsterBase.as:770-775`)
 *
 * Each monster eaten is sent in feed mode (`changeModeFeed`): it waypoints from
 * where it stands to the champion's point (`CREATURES._guardian._tmpPoint`), a
 * flyer climbing first as one sent to the Juicer does. The ones not standing
 * in a pen are made beside a random Housing and walk from there.
 *
 * ## The burst (`CreepBase.as:1289-1291`)
 *
 * When it gets there it is gone in a spurt of blood,
 * `GIBLETS.Create(_tmpPoint, 0.8, 100, _goo / 400, 36)`: the Juicer's giblets
 * (`juicerShow.ts` `planGiblets`), `_goo / 400` of them (`_goo` its hatch
 * cost), 36 px further down the screen, each splatting with `splat5` where it
 * lands. A Shiny feed sends nobody and shows nothing.
 *
 * Three departures from Flash, so a feed always shows, never floods and reads well:
 * - Flash's count is `int(_goo / 400)`, which is 0 for a level 1 Pokey (250
 *   goo) or Bolt (350), so most early feeds showed no blood at all. Here every
 *   monster throws at least {@link FEED_GIBLETS_MIN}.
 * - Flash had no top (an Inferno IC8 is over 1,000 giblets). Here one monster
 *   throws at most {@link FEED_GIBLETS_MAX}; the Juicer's "no new spurt while
 *   20 are in the air" (`GIBLETS.as:58`) still holds.
 * - A flyer bursts where it flies, its giblets raining to the ground, rather
 *   than from the ground under it.
 */

/** How far down the screen a feed's giblet lands from where it was aimed (`CreepBase.as:1290`). */
export const FEED_BURST_HEIGHT = 36;

/** The fewest giblets one eaten monster throws (Flash: `int(_goo / 400)`, often 0). */
export const FEED_GIBLETS_MIN = 6;

/** The most giblets one eaten monster throws (Flash: no top). */
export const FEED_GIBLETS_MAX = 40;

/** The most monsters one feed walks to the champion; the rest are eaten unseen. */
export const MAX_FEED_WALKERS = 40;

/** How many giblets one eaten monster of hatch cost `goo` throws. */
export const feedGiblets = (goo: number): number =>
  Math.min(FEED_GIBLETS_MAX, Math.max(FEED_GIBLETS_MIN, Math.floor(Math.max(0, goo) / 400)));
