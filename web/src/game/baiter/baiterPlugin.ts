import type { AttackMounts, AttackPlugin } from "@/game/attack/attackPlugins";
import { summariseAttack } from "@/game/attack/attackSave";
import { combatKind, type AttackSessionState } from "@/game/attack/AttackSession";
import { testArmyPlugin } from "@/game/attack/plugins/army";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { testDropPlugin } from "@/game/attack/plugins/drop";
import { maxHp } from "@/game/combat/rules";
import { championEntry } from "@/game/yard/championCatalogue";
import { BaiterDock } from "@/ui/attack/BaiterSummary";
import { TestReportPanel } from "@/ui/attack/TestReport";
import { baiterRecorder, type BaiterRecorder } from "./baiterRecord";
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
 */

/** Close enough to make out one tower: the attack screen's opening zoom. */
const TOWER_ZOOM = 0.9;

/**
 * Moves the camera so `world` sits in the middle of what the report leaves
 * uncovered: left of it when it stands at the right, above it when it is a
 * bottom sheet on a phone. From further out it zooms in first.
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
  const showReport = (): void => {
    const battle = session.battle();
    if (report || !battle) return;
    const state = session.state();
    record.finish(state.endReason);
    const facts = summariseAttack(session);
    report = new TestReportPanel({
      report: buildTestReport({
        state: battle.state(),
        endReason: state.endReason,
        buildings,
        damagePercent: facts.damagePercent,
        buildingsDestroyed: facts.buildingsDestroyed,
        buildingsTotal: facts.buildingsTotal,
        championFell,
        startTick: session.flingLog().events.find((event) => event.kind === "fling")?.t ?? 0,
      }),
      onBuilding: (id) => {
        const building = mounts.yard.buildings.find((one) => one.id === id);
        if (!building) return;
        const cover = report?.element.querySelector(".test-report")?.getBoundingClientRect() ?? null;
        showBeside(mounts, { x: building.centreX, y: building.centreY }, cover);
        mounts.renderer.setSelected(building);
      },
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
