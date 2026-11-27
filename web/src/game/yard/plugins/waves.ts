import { raidRefusal } from "@/api/raid";
import { waveApi, type WaveApi, type WaveStatus } from "@/api/waves";
import { setRaidRun } from "@/game/raid/raidSession";
import { raidWatch } from "@/game/raid/raidWatch";
import { WaveHud } from "@/ui/waves/WaveHud";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for the wave events (beta 10, Wild Monster Invasion), on
 * the main yard only: while a wave event is on, the wave bar (`WaveHud`)
 * names the next wave and "Start wave N" calls it (`POST
 * /bm/events/wave/next`); the server answers with the wave already fought,
 * and the raid scene plays it as a raid (`RaidRun.wave`). Its result shows
 * when the yard opens again (`plugins/raid.ts`, `showWaveResult`), whose
 * "Next wave" comes back here ({@link callNextWave}).
 */

/** How often the yard asks again whether a wave event is on (the dashboard starts one). */
export const WAVE_STATUS_REFRESH_MS = 120_000;

export const WAVE_START_FAILED = "Could not start the wave. Try again.";

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

  const go = (): void => {
    if (busy || !status || status.next === null) return;
    busy = true;
    hud.update(status, true);
    void startWave(mounts).then((started) => {
      if (started || gone) return;
      busy = false;
      hud.update(status, false);
    });
  };
  const hud = new WaveHud({ onStart: go }).mount(overlay.content);
  hud.update(null);
  caller = go;

  const refresh = async (): Promise<void> => {
    try {
      const answer = await waveApi.status();
      if (gone) return;
      status = answer.wave;
      // Hidden while a wild raid is open or fighting: the server would refuse the wave anyway.
      hud.update(raidWatch.current ? null : status, busy);
    } catch {
      /* the bar stays as it was; the next refresh tries again */
    }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), WAVE_STATUS_REFRESH_MS);
  const stopWatch = raidWatch.subscribe(() => hud.update(raidWatch.current ? null : status, busy));

  return () => {
    gone = true;
    if (caller === go) caller = null;
    clearInterval(timer);
    stopWatch();
    hud.remove();
  };
};

YARD_PLUGINS.push(wavesYardPlugin);
