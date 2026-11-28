import type { EventDefinition } from "../../../game-data/events/events.js";
import { waveEventByKey } from "./waveEvents.js";
import { runId, waveRuns, type WaveRun } from "./waveRuns.js";

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

/**
 * Each wave event run as an Events page entry (kind `wave`, or `yards` for
 * the Brukkarg attack events): its title, words, window and banner. The
 * card's wave counter and "Next wave" come from `GET /bm/events/wave`
 * (`waveFight.ts`), not from a ladder; a yard card's yards from
 * `GET /bm/events/yards`.
 */
export const waveRunEvents = (list: readonly WaveRun[] = waveRuns()): EventDefinition[] =>
  list.flatMap((run) => {
    const event = waveEventByKey(run.event);
    if (!event) return [];
    return [
      {
        id: runId(run),
        title: event.title,
        text: event.text,
        // The Brukkarg attack events keep their yard card (kind `yards`).
        kind: event.card ?? "wave",
        series: `${event.card ?? "wave"}-${event.key}`,
        startsAt: iso(run.startsAt),
        endsAt: iso(run.endsAt),
        banner: event.banner.modern,
        bannerClassic: event.banner.classic,
        ...(event.requires ? { requires: event.requires } : {}),
      },
    ];
  });
