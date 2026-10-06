import type { YardBuilding } from "@/game/yard/yardModel";

/**
 * The Trojan Horse — building **27** — as the web client knows it (issue
 * #327 WP4, `docs/design/trojan-horse.md` §3). The server owns placing it,
 * its army and the fight (WP1-WP3); this is only the shared bits this
 * package and the yard scene both need: its type id and how to find it.
 *
 * Mirrors `server/src/game-data/buildingFootprints.ts`'s `TROJAN_HORSE_TYPE`,
 * the same way `BAITER_TYPE` (`game/baiter/baiterSession.ts`) mirrors the
 * server's Monster Baiter constant: no shared import across the client/server
 * boundary, just the same number with its own comment.
 */
export const TROJAN_HORSE_TYPE = 27;

/**
 * The tribe name a landed Trojan Horse fight carries on `RaidView.tribe` and
 * `RaidResult.tribe` (design §6: "tribe `"wild"`"), which is never a real
 * tribe's name. The web client uses it to tell a sprung Trojan Horse's raid
 * apart from a wild monster tribe's, for the result wording (§6) and for
 * skipping the frequency popup (`raidAftermath.ts`).
 */
export const TROJAN_TRIBE = "wild";

/** The horse on this yard, or null when it holds none. */
export const findTrojanHorse = (buildings: readonly YardBuilding[]): YardBuilding | null =>
  buildings.find((building) => building.type === TROJAN_HORSE_TYPE) ?? null;
