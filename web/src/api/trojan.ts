import type { RaidFight, RaidView } from "./raid";
import { postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * Springing the Trojan Horse (issue #327 WP4, `docs/design/trojan-horse.md`
 * §7 "Springing"): the one new route this work package adds.
 *
 *   POST /api/:apiVersion/bm/raid/trojan
 *
 * No request fields: it is always the caller's own main yard, and the
 * server refuses it unless the horse is there, unsprung, and nothing else is
 * already fighting that yard. The server builds the army itself and opens
 * the fight at once; the reply carries what `/raid/start` does, so the raid
 * scene plays it the same way (`raidSession.ts`'s `RaidRun`, tagged
 * `trojan: true`).
 *
 * Finishing it reuses `/raid/finish` (`api/raid.ts`'s `finishRaid`): the
 * design's §7 "Finishing reuses raid/finish and its checks" needs no route
 * of its own.
 */

const TROJAN_SPRING_PATH = "/api/:apiVersion/bm/raid/trojan";

export interface TrojanSpringResponse extends ApiEnvelope {
  readonly raid: RaidView;
  readonly fight: RaidFight;
}

export const springTrojan = (): Promise<TrojanSpringResponse> =>
  postJson<TrojanSpringResponse>(TROJAN_SPRING_PATH);

/** The one call the letter popup's flow makes, as one object a test can replace. */
export interface TrojanApi {
  spring(): Promise<TrojanSpringResponse>;
}

export const trojanApi: TrojanApi = {
  spring: springTrojan,
};
