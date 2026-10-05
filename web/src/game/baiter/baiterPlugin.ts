import type { AttackMounts, AttackPlugin } from "@/game/attack/attackPlugins";
import { summariseAttack } from "@/game/attack/attackSave";
import { testArmyPlugin } from "@/game/attack/plugins/army";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { testDropPlugin } from "@/game/attack/plugins/drop";
import { typeName } from "@/game/yard/planner/summary";
import { BaiterDock, BaiterSummaryPanel, type BaiterOutcome } from "@/ui/attack/BaiterSummary";
import { baiterRecorder, type BaiterRecorder } from "./baiterRecord";

/**
 * The Baiter scene's own package (issue #126): a test plays like a real
 * attack (#22, WP3, `docs/design/baiter-simulator.md` §5.2): the test army
 * sits in the real attack's army panel, the player taps anywhere a real
 * attack may drop, as many drops as the army allows, the champion from its
 * row, and the clock starts at the first drop. When the battle ends a
 * summary says how the yard held, with Run again and Back to yard.
 *
 * The scene mounts only {@link BAITER_PLUGINS}: the army and drop packages in
 * their test flavour (no last army kept, no champion's Mode saved, no
 * Catapult or siege), the battle layer, which draws the fight, and this. The
 * attack's end package (the save), its checkpoint package and the tutorial's
 * practice-camp package are not mounted, so nothing a real attack sends to
 * the server exists on this screen (`baiterPlugin.test.ts`).
 *
 * Nothing of the test is sent. The one exception is the Goals record of a
 * finished test (issue #227, `baiterRecord.ts`): a token asked for at the
 * first drop and handed back when the test really finishes.
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
  // The test starts with the player's first drop, and so does its Goals
  // record: a test stopped before anything was dropped asks for nothing.
  let started = false;
  const startRecord = (): void => {
    if (started || !session.flingLog().events.some((event) => event.kind === "fling")) return;
    started = true;
    record.start();
  };

  const dock = new BaiterDock(run).mount(mounts.dock);

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
    startRecord();
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

/**
 * What the Baiter scene mounts, and nothing else: no save, no checkpoint. In
 * a real attack's order, so the drop ring sits under the battle as it does there.
 */
export const BAITER_PLUGINS: readonly AttackPlugin[] = [testArmyPlugin, testDropPlugin, battlePlugin, baiterPlugin];
