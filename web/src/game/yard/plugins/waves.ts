import { raidRefusal } from "@/api/raid";
import { waveApi, type WaveApi, type WaveStatus } from "@/api/waves";
import { setRaidRun } from "@/game/raid/raidSession";
import { rememberWaveArmy } from "@/game/waves/waveText";
import { raidWatch } from "@/game/raid/raidWatch";
import { setWaveFeed } from "@/game/waves/waveFeed";
import { waveIntroPopup } from "@/ui/waves/WaveScreens";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for the wave events (beta 10, Wild Monster Invasion), on
 * the main yard only: while a wave event is on, its status goes to the wave
 * feed (`game/waves/waveFeed.ts`) for the Events card and button (no bar on
 * the yard, owner 27 Nov 2026), and "Start wave N" calls it (`POST
 * /bm/events/wave/next`); the server answers with the wave already fought,
 * and the raid scene plays it as a raid (`RaidRun.wave`). Its result shows
 * when the yard opens again (`plugins/raid.ts`, `showWaveResult`), whose
 * "Next wave" comes back here ({@link callNextWave}).
 */

/** How often the yard asks again whether a wave event is on (the dashboard starts one). */
export const WAVE_STATUS_REFRESH_MS = 120_000;

export const WAVE_START_FAILED = "Could not start the wave. Try again.";

const SEEN_KEY = "bymr.waveIntroSeen";

/** Whether this device has yet to show run `run`'s arrival pop-up. */
export const introDue = (run: string): boolean => {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== run;
  } catch {
    return false;
  }
};

/** Marks run `run`'s arrival pop-up seen, once the player has closed it (a yard reload under it shows it again). */
export const markIntroSeen = (run: string): void => {
  try {
    window.localStorage.setItem(SEEN_KEY, run);
  } catch {
    /* private mode: shown again next time */
  }
};

/** The open yard's caller, for the result pop-up's "Next wave". */
let caller: (() => void) | null = null;

/** Calls the next wave from the open yard, if one is open. */
export const callNextWave = (): void => caller?.();

/**
 * Calls the next wave: the server fights it, the raid scene plays it. A
 * refusal says why in the server's words; anything else gets a general line.
 */
export const startWave = async (
  mounts: Pick<YardMounts, "store" | "scene" | "notices">,
  api: Pick<WaveApi, "next"> = waveApi,
): Promise<boolean> => {
  try {
    const response = await api.next();
    if (response.wave.next !== null) rememberWaveArmy(response.wave.run, response.wave.next, response.wave.preview);
    setRaidRun({ raid: response.raid, fight: response.fight, save: mounts.store.save, wave: response.wave });
    mounts.scene.openRaid();
    return true;
  } catch (caught) {
    const refused = raidRefusal(caught) !== null && caught instanceof Error && caught.message !== "";
    mounts.notices.show("wave", refused ? caught.message : WAVE_START_FAILED, { level: "info", timeoutMs: 6_000 });
    return false;
  }
};

export const wavesYardPlugin: YardPlugin = (mounts) => {
  const { store, overlay } = mounts;
  if (store.kind !== "main") return;
  let status: WaveStatus | null = null;
  let busy = false;
  let gone = false;
  let intro: { close(): void } | null = null;

  const go = (): void => {
    if (busy || !status || status.next === null) return;
    busy = true;
    publish();
    void startWave(mounts).then((started) => {
      if (started || gone) return;
      busy = false;
      publish();
    });
  };
  // The Events card and button read this (no bar on the yard, owner 27 Nov 2026).
  const publish = (): void => setWaveFeed(status, busy, raidWatch.current !== null);
  setWaveFeed(null);
  caller = go;

  const refresh = async (): Promise<void> => {
    try {
      const answer = await waveApi.status();
      if (gone) return;
      status = answer.wave;
      // The event's arrival, once per run on this device, before its first wave.
      if (status && !intro && status.beaten === 0 && status.lost === 0 && !raidWatch.current && introDue(status.run)) {
        const run = status.run;
        intro = waveIntroPopup(status, go, () => markIntroSeen(run)).mount(overlay.modal);
      }
      publish();
    } catch {
      /* the card keeps what it had; the next refresh tries again */
    }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), WAVE_STATUS_REFRESH_MS);
  // A wild raid open or fighting: the card's Start waits (the server would refuse the wave).
  const stopWatch = raidWatch.subscribe(publish);

  return () => {
    gone = true;
    if (caller === go) caller = null;
    clearInterval(timer);
    stopWatch();
    setWaveFeed(null);
  };
};

YARD_PLUGINS.push(wavesYardPlugin);
