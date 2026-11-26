import type { JsonObject } from "../../types/JsonObject.js";

/**
 * When the next monster hatches in a yard, read off its army blob as the map
 * sends it (`monstersForMap`: already caught up to now), or undefined when no
 * hatchery is counting down. The live map (beta 9) sends it on the owner's
 * own cells as `nh`; the map asks that cell again then, as it does when an
 * outpost's worker finishes, so its `m` stays right without a timed re-ask.
 *
 * Read from the hatcheries' own countdowns (`h`, `hstage`), not a forward
 * simulation: a hatchery producing (stage 1) finishes after its countdown at
 * 1x, sooner while the overdrive (`overdrivepower` for `overdrivetime` more
 * seconds) runs. A hatchery waiting for housing (stage 2) waits on the
 * player, not the clock. A paused one (an upgrade) is asked a little early;
 * the answer then carries the next time.
 *
 * @param monsters - The cell's caught-up army blob.
 * @param now - Server seconds the blob describes.
 */
export const nextHatchAt = (monsters: JsonObject | null | undefined, now: number): number | undefined => {
  const h: unknown[] = Array.isArray(monsters?.h) ? monsters.h : [];
  const stages: unknown[] = Array.isArray(monsters?.hstage) ? monsters.hstage : [];
  const power = Math.max(1, Number(monsters?.overdrivepower) || 1);
  const boosted = Math.max(0, Number(monsters?.overdrivetime) || 0);

  let soonest = Infinity;
  for (let i = 0; i < h.length; i++) {
    const entry = h[i];
    if (!Array.isArray(entry) || !entry[0] || Number(stages[i]) !== 1) continue;
    const left = Number(entry[1]);
    if (!Number.isFinite(left) || left <= 0) continue;
    // Seconds of real time: `power` seconds of work per second while the overdrive lasts.
    const seconds = left <= boosted * power ? left / power : boosted + (left - boosted * power);
    soonest = Math.min(soonest, seconds);
  }
  return Number.isFinite(soonest) ? Math.ceil(now + soonest) : undefined;
};
