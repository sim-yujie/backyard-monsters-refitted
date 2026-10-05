import { raidApi } from "@/api/raid";
import { repairActions } from "@/api/yardRepair";
import { runRaidAftermath } from "@/game/raid/raidAftermath";
import { consumeRaidNote, consumeRaidResult, setRaidRun } from "@/game/raid/raidSession";
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
 * opens after a fight, the result and frequency popups.
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

export const raidYardPlugin: YardPlugin = (mounts) => {
  const { store, overlay, notices, scene } = mounts;
  if (store.kind !== "main") return;
  const notice = (message: string): void => notices.show("raid", message, { level: "info", timeoutMs: 6_000 });

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

  // Back from a fight: what it landed, or why it did not.
  const note = consumeRaidNote();
  if (note) notice(note);
  const result = consumeRaidResult();
  if (result) {
    void runRaidAftermath(
      { api: raidApi, view: raidAftermathView(overlay.modal, () => repairOffer(mounts), notice) },
      result,
    );
  }

  return () => {
    flow?.stop();
    ui.destroy();
  };
};

YARD_PLUGINS.push(raidYardPlugin);
