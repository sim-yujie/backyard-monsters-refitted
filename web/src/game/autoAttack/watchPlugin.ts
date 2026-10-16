import type { AttackMounts, AttackPlugin } from "@/game/attack/attackPlugins";
import { summariseAttack } from "@/game/attack/attackSave";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { defenceDrift, logDefenceDrift } from "@/game/defences/defenceWatch";
import { setMapFocus } from "@/game/maproom/mapFocus";
import { DefenceDock, DefenceResultPanel } from "@/ui/attack/DefencePanels";
import { WatchDock, WatchSummaryPanel } from "@/ui/attack/WatchPanels";
import { watchEvents, type DefenceWatch } from "./watchRun";

/**
 * The watch scene's own package (issues #221, #362): plays the battle back
 * and, when it is over, offers Watch again and Back.
 *
 * The scene mounts only {@link WATCH_PLUGINS}: the battle layer, which draws
 * the fight, and this. The save, the checkpoint and the drop and army
 * controls are not mounted, so nothing on this screen reaches the server.
 */
export const watchPlugin: AttackPlugin = (mounts) => {
  const run = mounts.watch;
  if (!run) return;
  if (run.kind === "defence") return defenceWatch(mounts, run);
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

/** How often the result waits on the screen to catch up, and for how long at most (as the end panel, #148). */
const RESULT_POLL_MS = 100;
const RESULT_MAX_WAIT_MS = 6000;

/**
 * A defence replay (issue #362, `docs/design/defence-replays.md` §7): the
 * dock with Skip to end, and at the end the STORED result, once the monsters
 * left standing have walked off. A replay that skipped to its end shows the
 * result at once, over the yard as the battle left it. If the engine's end
 * damage is not the stored one, that is logged (`defence-replay-drift`); the
 * panel still shows the stored figures.
 */
const defenceWatch = (mounts: AttackMounts, run: DefenceWatch): (() => void) => {
  const { session, presentation } = mounts;
  session.playScript(watchEvents(run), run.replay.tick);
  const dock = new DefenceDock({ defence: run.defence, onSkip: () => session.skipToEnd() }).mount(mounts.dock);

  let result: DefenceResultPanel | null = null;
  let waiting: number | null = null;
  let ended = false;
  const openResult = (): void => {
    if (result) return;
    result = new DefenceResultPanel({
      defence: run.defence,
      onAgain: () => mounts.openWatch?.(run),
      onBack: () => (mounts.goToYard ?? mounts.goToMap)(),
    }).mount(mounts.modal);
  };
  const onEnded = (): void => {
    if (ended) return;
    ended = true;
    // Leaving the screen ends the session too; that is no result to check or show.
    if (session.endedBy === "left") return;
    const state = session.state();
    const drift = defenceDrift(run, state.damagePercent, state.tick);
    if (drift) logDefenceDrift(drift);
    if (!presentation.playing()) {
      openResult();
      return;
    }
    const since = Date.now();
    waiting = window.setInterval(() => {
      if (presentation.playing() && Date.now() - since < RESULT_MAX_WAIT_MS) return;
      if (waiting !== null) window.clearInterval(waiting);
      waiting = null;
      openResult();
    }, RESULT_POLL_MS);
  };

  const unsubscribe = session.subscribe((state) => {
    dock.update(state, session.skipping);
    if (state.phase === "ended") onEnded();
  });
  dock.update(session.state(), session.skipping);

  return () => {
    unsubscribe();
    if (waiting !== null) window.clearInterval(waiting);
    dock.destroy();
    result?.close();
  };
};

/** What the watch scene mounts, and nothing else. */
export const WATCH_PLUGINS: readonly AttackPlugin[] = [battlePlugin, watchPlugin];
