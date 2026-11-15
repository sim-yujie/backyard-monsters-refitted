import { raidApi } from "@/api/raid";
import { repairActions } from "@/api/yardRepair";
import { isMolochRaid } from "@/game/inferno/molochRaid";
import { runRaidAftermath } from "@/game/raid/raidAftermath";
import {
  adoptLoadedRaidResult,
  consumeRaidNote,
  consumeRaidResult,
  onRaidNews,
  raidResultWaiting,
  setRaidRun,
} from "@/game/raid/raidSession";
import { raidSheetWarmer } from "@/game/raid/raidSheets";
import { raidWatch } from "@/game/raid/raidWatch";
import { RaidYardFlow } from "@/game/raid/raidYardFlow";
import { repairAllOffer } from "@/game/yard/shop";
import { RaidYardUi, raidAftermathView, type RaidRepairOffer } from "@/ui/raid/RaidScreens";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for wild monster raids (issue #226 WP4,
 * `docs/design/wild-raids.md` §4.3), on the main yard only: the alert, the
 * top bar's countdown and the lock (`RaidYardFlow`, drawn by `RaidYardUi`),
 * the hand-over to the raid scene when the fight is due, and, when the yard
 * opens after a fight, the result and frequency popups. Not after Moloch's
 * raids: Flash showed only "stage passed" for those (`GoodDefense` and
 * `PoorDefense`), which the Inferno's plugin plays.
 */

/** Repair now for the result popup, as the Shop prices it, or null when nothing is damaged. */
const repairOffer = (mounts: YardMounts): RaidRepairOffer | null => {
  const offer = repairAllOffer(mounts.store);
  if (!offer) return null;
  return {
    price: offer.price,
    blocked: offer.blocked,
    buy: async () => {
      const result = await repairActions(mounts.store).now();
      return result.ok ? null : result.refusal.message;
    },
  };
};

/** How often a late result waiting on the Planner or a building in hand looks again. */
export const LATE_RESULT_CHECK_MS = 1_000;

/** Warms each raid's monster sheets once, across yard visits (`raidSheets.ts`). */
const warmRaidSheets = raidSheetWarmer();

export const raidYardPlugin: YardPlugin = (mounts) => {
  const { store, overlay, notices, scene } = mounts;
  if (store.kind !== "main") return;
  const notice = (message: string): void => notices.show("raid", message, { level: "info", timeoutMs: 6_000 });

  // A fight this yard's load landed (patch 7.5) is over, though its finish
  // has not answered yet: the yard is not locked for it.
  const loaded = store.save.raidresult;
  if (loaded && raidWatch.current?.id === loaded.id) raidWatch.set(null);

  // The alert lists the army a minute or more before the fight: fetch its
  // sheets now, so a slow line has them by the first wave.
  warmRaidSheets(raidWatch.current);
  const stopWarming = raidWatch.subscribe(warmRaidSheets);

  let flow: RaidYardFlow | null = null;
  const ui = new RaidYardUi({
    modal: overlay.modal,
    content: overlay.content,
    onEngage: () => void flow?.engage(),
    onPrepare: () => void flow?.prepare(),
    onMap: () => scene.openMap(),
    notice,
  });
  flow = new RaidYardFlow({
    watch: raidWatch,
    api: raidApi,
    plannerOpen: () => scene.plannerOpen(),
    view: ui,
    fight: (start) => {
      setRaidRun({ raid: start.raid, fight: start.fight, save: store.save });
      scene.openRaid();
    },
    reload: () => scene.reload(),
  }).start();

  // Back from a fight: what it landed, or why it did not. The load may have
  // landed it itself, with its finish still on the way (patch 7.5); the
  // result first, so a "did not land" line for the same raid is dropped.
  adoptLoadedRaidResult(store.save.raidresult);
  const result = consumeRaidResult((landed) => !isMolochRaid(landed));
  if (result) {
    void runRaidAftermath(
      { api: raidApi, view: raidAftermathView(overlay.modal, () => repairOffer(mounts), notice) },
      result,
    );
  }
  const note = consumeRaidNote();
  if (note) notice(note);

  // The finish's answer can come after the player went back to the yard
  // ("Back to yard", sol's review): a line is shown at once; a result opens
  // the yard afresh, as the server has it now, and the new yard shows it
  // (this plugin's, or Moloch's in the Inferno's). Not under the Planner or
  // with a building in hand: that waits until they are done.
  let reloadTimer: ReturnType<typeof setInterval> | null = null;
  const stopReloadTimer = (): void => {
    if (reloadTimer !== null) clearInterval(reloadTimer);
    reloadTimer = null;
  };
  const reloadIfFree = (): void => {
    if (!raidResultWaiting()) return stopReloadTimer();
    if (scene.plannerOpen() || scene.carrying()) return;
    stopReloadTimer();
    scene.reload();
  };
  const stopNews = onRaidNews(() => {
    const late = consumeRaidNote();
    if (late) notice(late);
    if (!raidResultWaiting() || reloadTimer !== null) return;
    reloadTimer = setInterval(reloadIfFree, LATE_RESULT_CHECK_MS);
    reloadIfFree();
  });

  return () => {
    stopNews();
    stopReloadTimer();
    stopWarming();
    flow?.stop();
    ui.destroy();
  };
};

YARD_PLUGINS.push(raidYardPlugin);
