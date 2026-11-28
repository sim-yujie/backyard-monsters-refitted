import { yardEventByKey } from "../../../game-data/events/yardEvents.js";
import type { YardEventKey } from "../../../game-data/tribes/events/index.js";
import { BRUKWAR_WAVES } from "./data/brukwarWaves.js";
import { WMI1_WAVES } from "./data/wmi1Waves.js";
import { WMI2_WAVES } from "./data/wmi2Waves.js";
import { brukwarWavePrizes, flashWavePrizes } from "./waveRewards.js";
import type { WavePrize, WaveEventDefinition, WaveTable } from "./waveTypes.js";

/**
 * A Brukkarg attack event (`game-data/events/yardEvents.ts`, bruk-port) on
 * the event control: its title, words, days and banners are the yard
 * event's own; its card is the yard card; its waves, if any, unlock its
 * yards (`services/events/yards/yardEventGate.ts`).
 */
const yardEvent = (key: YardEventKey, waves: WaveTable, prizes: readonly WavePrize[]): WaveEventDefinition => {
  const event = yardEventByKey(key)!;
  return {
    key,
    title: event.title,
    text: event.text,
    days: event.days,
    waves,
    prizes,
    firstBonusWave: waves.length + 1,
    banner: event.banner,
    requires: { tutorial: true },
    card: "yards",
  };
};

/**
 * Every wave event the dashboard can start (beta 10). Adding one:
 *
 * 1. Its waves as a {@link WaveTable} in `data/<key>Waves.ts` (one `creep(...)`
 *    or `champ(...)` line per spawn group; Flash tables convert with the
 *    `WAVES` array as-is, see `data/wmi1Waves.ts`).
 * 2. One {@link WaveEventDefinition} below: key, words, days, the table, one
 *    prize per wave (`waveRewards.ts`), the totem decoration if any, the first
 *    bonus wave, and the banner art under `web/public/events/`.
 * 3. Nothing else: the dashboard lists it, a run puts it on the Events page,
 *    the HUD's "Next wave" plays it and the landing pays its prizes.
 *
 * Only one wave event runs at a time (owner, 27 Nov 2026).
 */
export const WAVE_EVENTS: readonly WaveEventDefinition[] = [
  {
    key: "wmi1",
    title: "Wild Monster Invasion",
    text: "30 waves + 2 bonus. Call each when ready; hold your yard to grow your Victory Totem.",
    days: 7,
    waves: WMI1_WAVES,
    prizes: flashWavePrizes(),
    totemType: 121,
    firstBonusWave: 31,
    banner: { modern: "/events/wmi1-banner.jpg", classic: "/events/wmi1-banner-classic.jpg" },
    requires: { tutorial: true },
  },
  {
    key: "wmi2",
    title: "Wild Monster Invasion 2",
    text: "30 Inferno waves + 2 bonus. Call each when ready; hold your yard to grow your Inferno Totem.",
    days: 7,
    waves: WMI2_WAVES,
    prizes: flashWavePrizes(),
    totemType: 131,
    firstBonusWave: 31,
    banner: { modern: "/events/wmi2-banner.jpg", classic: "/events/wmi2-banner-classic.jpg" },
    requires: { tutorial: true },
  },
  // Creature Carnage: attack yards only, no waves ("Next wave" refuses it).
  yardEvent("carnage", [], []),
  // Brukkarg War: 25 waves; every 5 beaten opens the next yard.
  yardEvent("brukwar", BRUKWAR_WAVES, brukwarWavePrizes(BRUKWAR_WAVES.length)),
];

/** The wave event with this key, or null. */
export const waveEventByKey = (key: string): WaveEventDefinition | null => WAVE_EVENTS.find((event) => event.key === key) ?? null;
