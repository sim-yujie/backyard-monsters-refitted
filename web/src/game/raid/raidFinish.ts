import { raidRefusal, type RaidApi, type RaidResult } from "@/api/raid";

/**
 * Landing a raid's fight once it has played out here (issue #226 WP4,
 * `/raid/finish`).
 *
 * The server will not take a finish sooner than the fight could have run at
 * 2x (`tooEarly`, with `readyAt`); the client then waits until then and asks
 * again. Any other refusal ends the raid without a result: `cancelled` (the
 * game was closed during the fight, so nothing landed and the raid comes back
 * on the next yard visit), `notFighting` or `noRaid` (it is not open any
 * more). A failure to reach the server is tried again a few times.
 */

export type RaidFinish =
  | { readonly kind: "landed"; readonly result: RaidResult }
  | { readonly kind: "cancelled" }
  | { readonly kind: "gone" }
  | { readonly kind: "failed" };

export interface RaidFinishOptions {
  readonly api: Pick<RaidApi, "finish">;
  readonly id: string;
  /** Server unix seconds now. */
  readonly serverNow: () => number;
  /** Waits that many milliseconds. */
  readonly wait: (ms: number) => Promise<void>;
  /** Tries after a failure to reach the server; 3 by default. */
  readonly attempts?: number;
}

/** How long to wait before asking again after a failure to reach the server. */
export const FINISH_RETRY_MS = 2_000;
/** The most `tooEarly` waits in a row, so a confused clock cannot loop for ever. */
const MAX_EARLY_WAITS = 5;

export const finishRaidFight = async (options: RaidFinishOptions): Promise<RaidFinish> => {
  let failures = 0;
  let early = 0;
  for (;;) {
    try {
      const answer = await options.api.finish(options.id);
      return { kind: "landed", result: answer.result };
    } catch (caught) {
      const refusal = raidRefusal(caught);
      if (refusal?.reason === "tooEarly" && early < MAX_EARLY_WAITS) {
        early += 1;
        const readyAt = refusal.readyAt ?? options.serverNow() + 1;
        await options.wait(Math.max(250, (readyAt - options.serverNow()) * 1000 + 250));
        continue;
      }
      if (refusal?.reason === "cancelled") return { kind: "cancelled" };
      if (refusal) return { kind: "gone" };
      failures += 1;
      if (failures >= (options.attempts ?? 3)) return { kind: "failed" };
      await options.wait(FINISH_RETRY_MS);
    }
  }
};
