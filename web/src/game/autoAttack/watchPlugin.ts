import type { AttackPlugin } from "@/game/attack/attackPlugins";
import { summariseAttack } from "@/game/attack/attackSave";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { setMapFocus } from "@/game/maproom/mapFocus";
import { WatchDock, WatchSummaryPanel } from "@/ui/attack/WatchPanels";
import { watchEvents } from "./watchRun";

/**
 * The watch scene's own package (issue #221): plays the auto-attack's battle
 * back and, when it is over, offers Watch again and Back to map.
 *
 * The scene mounts only {@link WATCH_PLUGINS}: the battle layer, which draws
 * the fight, and this. The save, the checkpoint and the drop and army
 * controls are not mounted, so nothing on this screen reaches the server.
 */
export const watchPlugin: AttackPlugin = (mounts) => {
  const run = mounts.watch;
  if (!run) return;
  const { session } = mounts;

  session.playScript(watchEvents(run), run.replay.tick);
  const dock = new WatchDock(run.replay.name).mount(mounts.dock);

  let summary: WatchSummaryPanel | null = null;
  const showSummary = (): void => {
    if (summary) return;
    summary = new WatchSummaryPanel({
      summary: summariseAttack(session),
      onAgain: () => mounts.openWatch?.(run),
      onBack: () => {
        if (run.cell) setMapFocus({ cell: run.cell });
        mounts.goToMap();
      },
    }).mount(mounts.modal);
  };

  const unsubscribe = session.subscribe((state) => {
    dock.update(state);
    if (state.phase === "ended") showSummary();
  });

  return () => {
    unsubscribe();
    dock.destroy();
    summary?.close();
  };
};

/** What the watch scene mounts, and nothing else. */
export const WATCH_PLUGINS: readonly AttackPlugin[] = [battlePlugin, watchPlugin];
