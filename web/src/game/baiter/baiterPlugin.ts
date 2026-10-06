import type { AttackMounts, AttackPlugin } from "@/game/attack/attackPlugins";
import { summariseAttack } from "@/game/attack/attackSave";
import { combatKind, type AttackSessionState } from "@/game/attack/AttackSession";
import { testArmyPlugin } from "@/game/attack/plugins/army";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { testDropPlugin } from "@/game/attack/plugins/drop";
import { maxHp, ticks } from "@/game/combat/rules";
import { championEntry } from "@/game/yard/championCatalogue";
import { BaiterDock } from "@/ui/attack/BaiterSummary";
import { TestReportPanel } from "@/ui/attack/TestReport";
import { baiterRecorder, type BaiterRecorder } from "./baiterRecord";
import { recordTest, replayOf } from "./testHistory";
import { buildTestReport } from "./testReport";

/**
 * The Baiter scene's own package (issue #126): a test plays like a real
 * attack (#22, WP3, `docs/design/baiter-simulator.md` §5.2): the test army
 * sits in the real attack's army panel, the player taps anywhere a real
 * attack may drop, as many drops as the army allows, the champion from its
 * row, and the clock starts at the first drop. When the battle ends the
 * report (WP4, `testReport.ts`) says how the yard held, tower by tower, with
 * Test again, Change army and Back to yard.
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
 *
 * As the report opens, the battle is put to rest (#308,
 * `AttackPresentation.settle`): the attackers go, the towers stand down and
 * the report's scrim dims the yard, so a finished test looks finished rather
 * than frozen mid-step. A replay's end does the same.
 *
 * Every finished test with a drop in it is kept for a replay (WP5,
 * `testHistory.ts`), and its report offers Watch replay. A replay is the
 * scene with {@link BAITER_REPLAY_PLUGINS}: no army or drop controls, the
 * recorded seed and drops played back as an auto-attack's Watch plays its
 * battle, no Goals token, and the recorded report at the end.
 */

/** Close enough to make out one tower: the attack screen's opening zoom. */
const TOWER_ZOOM = 0.9;

/**
 * Moves the camera so `world` sits in the middle of what the report leaves
 * uncovered: with the window stepped aside (#308), above the small bar that
 * stands in for it. From further out it zooms in first.
 */
const showBeside = (mounts: AttackMounts, world: { x: number; y: number }, cover: DOMRect | null): void => {
  const { camera } = mounts;
  if (camera.zoom < TOWER_ZOOM) camera.zoomAt(TOWER_ZOOM, { x: 0, y: 0 });
  camera.centreOn(world);
  const view = mounts.canvas.getBoundingClientRect();
  if (cover && view.width > 0 && view.height > 0) {
    if (cover.left > view.left + view.width / 3) camera.panByScreen((cover.left - view.left) / 2 - view.width / 2, 0);
    else if (cover.top > view.top + view.height / 4) camera.panByScreen(0, (cover.top - view.top) / 2 - view.height / 2);
  }
  camera.dirty = true;
};

/** The Baiter package, with the Goals run record as a parameter so tests can watch it. */
export const createBaiterPlugin = (recorder: () => BaiterRecorder): AttackPlugin => (mounts) => {
  const run = mounts.practice;
  if (!run) return;
  const { session } = mounts;
  const replay = run.replay ?? null;
  if (replay) session.playScript(replay.events, replay.endTick);
  // A replay is not a new test: it asks for no Goals token.
  const record = replay ? null : recorder();
  // The test starts with the player's first drop, and so does its Goals
  // record: a test stopped before anything was dropped asks for nothing.
  let started = false;
  const startRecord = (): void => {
    if (started || !session.flingLog().events.some((event) => event.kind === "fling")) return;
    started = true;
    record?.start();
  };

  const dock = new BaiterDock(run, replay !== null).mount(mounts.dock);

  // When each champion fell, read off the notifications (a quarter of a
  // second apart), which the battle's own counters do not keep.
  const championFell: Record<string, number> = {};
  const watchChampions = (state: AttackSessionState): void => {
    for (const [t, hp] of Object.entries(state.championsHp)) {
      const id = championEntry(Number(t))?.id;
      if (id && hp <= 0 && championFell[id] === undefined) championFell[id] = state.tick;
    }
  };

  const kind = combatKind(mounts.target);
  const buildings = mounts.yard.buildings.map((building) => ({
    id: building.id,
    type: building.type,
    level: building.level,
    maxHp: maxHp(building.type, building.level, kind),
  }));

  let report: TestReportPanel | null = null;
  const onBuilding = (id: number): void => {
    const building = mounts.yard.buildings.find((one) => one.id === id);
    if (!building) return;
    const cover = report?.element.querySelector(".test-report__peek")?.getBoundingClientRect() ?? null;
    showBeside(mounts, { x: building.centreX, y: building.centreY }, cover);
    mounts.renderer.setSelected(building);
  };
  const onLeaveBuilding = (): void => mounts.renderer.setSelected(null);
  const showReport = (): void => {
    const battle = session.battle();
    if (report || !battle) return;
    // The battle stopped mid-step: put it to rest so a finished test does
    // not stand frozen behind its report (#308).
    mounts.presentation.settle();
    const state = session.state();
    if (replay) {
      // The same battle again, so the same report, with Watch again and the way back.
      report = new TestReportPanel({
        report: replay.report,
        onBuilding,
        onLeaveBuilding,
        onReplay: () => mounts.watchTest?.(run),
        replayLabel: "Watch again",
        onBack: () => mounts.goToYard?.(),
      }).mount(mounts.modal);
      return;
    }
    record?.finish(state.endReason);
    const facts = summariseAttack(session);
    const built = buildTestReport({
      state: battle.state(),
      endReason: state.endReason,
      buildings,
      damagePercent: facts.damagePercent,
      buildingsDestroyed: facts.buildingsDestroyed,
      buildingsTotal: facts.buildingsTotal,
      championFell,
      startTick: session.flingLog().events.find((event) => event.kind === "fling")?.t ?? 0,
      countdownTick: ticks(state.countdownSeconds),
      championsOnField: battle
        .creeps()
        .filter((creep) => creep.champion && !creep.friendly && creep.hp > 0)
        .map((creep) => creep.monsterId),
    });
    // A test stopped before anything was dropped has nothing to watch.
    const recorded = started
      ? recordTest({ run, seed: session.seed, events: session.flingLog().events, endTick: battle.tick, report: built })
      : null;
    report = new TestReportPanel({
      report: built,
      onBuilding,
      onLeaveBuilding,
      ...(recorded ? { onReplay: () => mounts.watchTest?.(replayOf(recorded)) } : {}),
      onAgain: () => mounts.runAgain?.(run),
      onChangeArmy: () => mounts.changeArmy?.(),
      onBack: () => mounts.goToYard?.(),
    }).mount(mounts.modal);
  };

  const unsubscribe = session.subscribe((state) => {
    startRecord();
    watchChampions(state);
    dock.update(state);
    if (state.phase === "ended") showReport();
  });
  if (session.state().phase === "ended") showReport();

  return () => {
    unsubscribe();
    dock.destroy();
    report?.close();
  };
};

export const baiterPlugin: AttackPlugin = createBaiterPlugin(() => baiterRecorder());

/**
 * What the Baiter scene mounts, and nothing else: no save, no checkpoint. In
 * a real attack's order, so the drop ring sits under the battle as it does there.
 */
export const BAITER_PLUGINS: readonly AttackPlugin[] = [testArmyPlugin, testDropPlugin, battlePlugin, baiterPlugin];

/** What the Baiter's replay scene mounts (WP5): the battle layer and this, no controls. */
export const BAITER_REPLAY_PLUGINS: readonly AttackPlugin[] = [battlePlugin, baiterPlugin];
