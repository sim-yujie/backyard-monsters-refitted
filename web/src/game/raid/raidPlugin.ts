import { raidApi, type RaidApi } from "@/api/raid";
import type { AttackPlugin } from "@/game/attack/attackPlugins";
import { battlePlugin } from "@/game/attack/plugins/battle";
import "@/ui/styles/raid.css";
import { finishRaidFight, type RaidFinish } from "./raidFinish";
import { raidEvents, setRaidNote, setRaidResult } from "./raidSession";
import { DONT_PANIC } from "./raidText";
import { raidWatch } from "./raidWatch";

/**
 * The raid scene's own package (issue #226 WP4, `docs/design/wild-raids.md`
 * §4.3): plays the fight the server already fought on the player's own yard,
 * with "Don't Panic!" in the strip, and when it is over lands it
 * (`/raid/finish`) and opens the yard, which shows the result.
 *
 * The scene mounts only {@link RAID_PLUGINS}: the battle layer, which draws
 * the fight, and this. No drop, no army and no save of an attack.
 *
 * At 2x the fight can end here before the server takes a finish; the finish
 * then waits (`tooEarly`), with "Don't Panic!" swapped for a waiting line.
 */

export interface RaidPluginDeps {
  readonly api: Pick<RaidApi, "finish">;
  /** Server unix seconds now. */
  readonly serverNow: () => number;
  /** Forgets the raid once it has landed or gone. */
  readonly clearRaid: () => void;
  readonly wait: (ms: number) => Promise<void>;
}

/** What the yard says when the fight did not land. */
export const finishNotice = (finish: RaidFinish): string | null => {
  if (finish.kind === "cancelled") return "The raid was called off: the wild monsters will be back.";
  if (finish.kind === "failed") return "Could not reach the server to land the raid. Your yard shows what the server has.";
  return null;
};

export const createRaidPlugin =
  (deps: RaidPluginDeps): AttackPlugin =>
  (mounts) => {
    const run = mounts.raid;
    if (!run) return;
    const { session } = mounts;

    const waves = raidEvents(run);
    session.playScript(waves, run.fight.tick);
    // The view turns to meet the first wave, as the Baiter's does: halfway
    // between it and the yard.
    const first = waves[0];
    if (first && mounts.camera) {
      mounts.camera.centreOn(mounts.renderer.yardToWorld(first.x / 2, first.y / 2));
      mounts.camera.dirty = true;
    }

    const banner = document.createElement("span");
    banner.className = "raid-panic";
    banner.setAttribute("role", "status");
    banner.textContent = DONT_PANIC;
    mounts.hudSlot.append(banner);

    let finishing = false;
    let gone = false;
    const finish = async (): Promise<void> => {
      if (finishing) return;
      finishing = true;
      banner.textContent = "The raid is over…";
      const outcome = await finishRaidFight({
        api: deps.api,
        id: run.raid.id,
        serverNow: deps.serverNow,
        wait: deps.wait,
      });
      // Kept for the yard even when this screen has gone meanwhile.
      if (outcome.kind === "landed") setRaidResult(outcome.result);
      deps.clearRaid();
      const notice = finishNotice(outcome);
      if (notice) setRaidNote(notice);
      if (!gone) mounts.goToYard?.();
    };

    const unsubscribe = session.subscribe((state) => {
      if (state.phase === "ended") void finish();
    });
    if (session.state().phase === "ended") void finish();

    return () => {
      gone = true;
      unsubscribe();
      banner.remove();
    };
  };

export const raidPlugin: AttackPlugin = createRaidPlugin({
  api: raidApi,
  serverNow: () => raidWatch.serverNow(),
  clearRaid: () => raidWatch.set(null),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/** What the raid scene mounts, and nothing else. */
export const RAID_PLUGINS: readonly AttackPlugin[] = [battlePlugin, raidPlugin];
