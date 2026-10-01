import type { AttackMounts, AttackPlugin } from "@/game/attack/attackPlugins";
import { summariseAttack } from "@/game/attack/attackSave";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { typeName } from "@/game/yard/planner/summary";
import { BaiterDock, BaiterSummaryPanel, type BaiterOutcome } from "@/ui/attack/BaiterSummary";
import { baiterRecorder, type BaiterRecorder } from "./baiterRecord";
import { spawnPointOf } from "./baiterSession";

/**
 * The Baiter scene's own package (issue #126): the practice attack's army
 * comes in from the chosen direction as the scene opens, and when the battle
 * ends a summary says how the yard held, with Run again and Back to yard.
 *
 * The scene mounts only {@link BAITER_PLUGINS}: the battle layer, which draws
 * the fight, and this. The attack's end package (the save), its checkpoint
 * package and the drop and army controls are not mounted, so nothing a real
 * attack sends to the server exists on this screen (`baiterPlugin.test.ts`).
 *
 * The army lands where the original's did: every monster at the direction's
 * point 1,000 yard units out (`client/scripts/WMATTACK.as:711`), in one
 * fling, which scatters them as a fling of that size scatters.
 *
 * Nothing of the run is sent. The one exception is the Goals record of a
 * finished run (issue #227, `baiterRecord.ts`): a token asked for as the run
 * starts and handed back when it really finishes.
 */

/** "Cannon Tower × 3, Sniper Tower": the towers that fired, by type, most first. */
const towerNames = (ids: Iterable<number>, mounts: AttackMounts): string[] => {
  const byType = new Map<number, number>();
  for (const id of ids) {
    const building = mounts.yard.buildings.find((one) => one.id === id);
    if (building) byType.set(building.type, (byType.get(building.type) ?? 0) + 1);
  }
  return [...byType]
    .sort((one, other) => other[1] - one[1] || typeName(one[0]).localeCompare(typeName(other[0])))
    .map(([type, count]) => (count > 1 ? `${typeName(type)} × ${count}` : typeName(type)));
};

/** The Baiter package, with the Goals run record as a parameter so tests can watch it. */
export const createBaiterPlugin = (recorder: () => BaiterRecorder): AttackPlugin => (mounts) => {
  const run = mounts.practice;
  if (!run) return;
  const { session } = mounts;
  const record = recorder();
  record.start();

  const dock = new BaiterDock(run).mount(mounts.dock);

  // The attack comes in at once; the first fling starts the clock. The view
  // turns to meet it, as the original focused the first monster
  // (`client/scripts/CUSTOMATTACKS.as:59-60`): halfway between it and the yard.
  const at = spawnPointOf(run.direction);
  session.appendFling({ x: at.x, y: at.y, monsters: { ...run.picks } });
  mounts.camera?.centreOn(mounts.renderer.yardToWorld(at.x / 2, at.y / 2));
  if (mounts.camera) mounts.camera.dirty = true;

  // Which towers fired, read from the battle's short event memory on every
  // notification (a quarter of a second, well inside its 160 ticks).
  const fired = new Set<number>();
  let seenTick = -1;
  const collect = (): void => {
    const battle = session.battle();
    if (!battle) return;
    for (const event of battle.recentEvents(seenTick + 1)) {
      if (event.kind === "shot") fired.add(event.towerId);
    }
    seenTick = battle.tick;
  };

  let summary: BaiterSummaryPanel | null = null;
  const showSummary = (): void => {
    if (summary) return;
    collect();
    const state = session.state();
    record.finish(state.endReason);
    const facts = summariseAttack(session);
    const traps = session.battle()?.state().firedTraps ?? [];
    const outcome: BaiterOutcome = {
      endReason: state.endReason,
      damagePercent: facts.damagePercent,
      buildingsDestroyed: facts.buildingsDestroyed,
      buildingsTotal: facts.buildingsTotal,
      attackersSent: facts.monstersSent,
      attackersBeaten: facts.monstersLost,
      towersFired: towerNames(fired, mounts),
      trapsFired: traps.length,
    };
    summary = new BaiterSummaryPanel({
      outcome,
      onAgain: () => mounts.runAgain?.(run),
      onBack: () => mounts.goToYard?.(),
    }).mount(mounts.modal);
  };

  const unsubscribe = session.subscribe((state) => {
    collect();
    dock.update(state);
    if (state.phase === "ended") showSummary();
  });
  if (session.state().phase === "ended") showSummary();

  return () => {
    unsubscribe();
    dock.destroy();
    summary?.close();
  };
};

export const baiterPlugin: AttackPlugin = createBaiterPlugin(() => baiterRecorder());

/** What the Baiter scene mounts, and nothing else: no save, no checkpoint, no drop controls. */
export const BAITER_PLUGINS: readonly AttackPlugin[] = [battlePlugin, baiterPlugin];
