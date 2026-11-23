import type { AttackMounts, AttackPlugin } from "@/game/attack/attackPlugins";
import { summariseAttack } from "@/game/attack/attackSave";
import { combatKind, type AttackSessionState } from "@/game/attack/AttackSession";
import { testArmyPlugin } from "@/game/attack/plugins/army";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { testDropPlugin } from "@/game/attack/plugins/drop";
import { maxHp, ticks } from "@/game/combat/rules";
import { championEntry } from "@/game/yard/championCatalogue";
import { BaiterDock, baiterNote } from "@/ui/attack/BaiterSummary";
import { TestReportPanel } from "@/ui/attack/TestReport";
import { baiterRecorder, type BaiterRecorder } from "./baiterRecord";
import { recordTest, replayOf } from "./testHistory";
import { buildTestReport } from "./testReport";
import { BAITER_REFUSAL_TEXT, baiterRefusalOf, baiterTestsApi, type BaiterTestsApi } from "@/api/baiterTests";
import { armyBody, testerReport } from "./friendTest";


/** The notice key and how long the test's note stays (it says what the test is, once). */
const BAITER_NOTE = "baiter-note";
const BAITER_NOTE_MS = 10_000;

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
export const createBaiterPlugin = (
  recorder: () => BaiterRecorder,
  api: BaiterTestsApi = baiterTestsApi,
): AttackPlugin => (mounts) => {
  const run = mounts.practice;
  if (!run) return;
  const { session } = mounts;
  const replay = run.replay ?? null;
  if (replay) session.playScript(replay.events, replay.endTick);
  // A replay is not a new test: it asks for no Goals token, and neither is a
  // test of a friend's yard (their Baiter, not the player's).
  const friend = run.friend ?? null;
  const record = replay || friend ? null : recorder();
  // The test starts with the player's first drop, and so does its Goals
  // record: a test stopped before anything was dropped asks for nothing.
  let started = false;
  const startRecord = (): void => {
    if (started || !session.flingLog().events.some((event) => event.kind === "fling")) return;
    started = true;
    record?.start();
  };

  const dock = new BaiterDock(run, replay !== null).mount(mounts.dock);
  // What the test is, once, over the yard: the dock keeps its room for the army.
  mounts.notices.show(BAITER_NOTE, baiterNote(run, replay !== null), { level: "info", timeoutMs: BAITER_NOTE_MS });

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
        ...(friend?.role === "owner"
          ? { title: `Test by ${friend.tester}`, backLabel: "Back to Results", savedNote: "A test: nothing was lost. Your yard is as it was." }
          : friend?.role === "tester"
            ? { title: `Test of ${friend.inviter.name}'s yard`, savedNote: `A test: nothing was lost or won.` }
            : {}),
      }).mount(mounts.modal);
      return;
    }
    record?.finish(state.endReason);
    const facts = summariseAttack(session);
    const builtOwn = buildTestReport({
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
    const built = friend?.role === "tester" ? testerReport(builtOwn) : builtOwn;
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
      ...(friend?.role === "tester"
        ? {
            title: `Test of ${friend.inviter.name}'s yard`,
            savedNote: `Nothing was lost or won: ${friend.inviter.name}'s yard and both your armies are as they were.`,
          }
        : {}),
    }).mount(mounts.modal);
    if (friend?.role === "tester") {
      // The drops go back to the server, which fights them again on the yard it
      // served and keeps the test for the inviter (beta 9 #4).
      if (!started) {
        report.setNote(`Nothing was dropped, so nothing was sent to ${friend.inviter.name}.`, "info");
        return;
      }
      const panel = report;
      panel.setNote(`Sending to ${friend.inviter.name}…`, "info");
      api
        .finish({
          token: friend.token,
          army: armyBody(run.army),
          flinglog: session.flingLog(),
          tick: battle.tick,
          report: built,
        })
        .then(
          () => panel.setNote(`Sent to ${friend.inviter.name}: they can watch it in their Baiter's Results.`, "good"),
          (error: unknown) => panel.setNote(`Not sent: ${BAITER_REFUSAL_TEXT[baiterRefusalOf(error)]}`, "bad"),
        );
    }
  };

  // The blow that ended the test plays out in slow motion before the report
  // covers it (feat/attack-juice-demo); with the effects off it opens at once.
  let waiting: number | null = null;
  const reportWhenFinished = (): void => {
    if (report || waiting !== null) return;
    const since = Date.now();
    const check = (): void => {
      waiting = null;
      if (mounts.presentation.finishing() && Date.now() - since < 3000) {
        waiting = window.setTimeout(check, 100);
        return;
      }
      showReport();
    };
    check();
  };

  const unsubscribe = session.subscribe((state) => {
    startRecord();
    watchChampions(state);
    dock.update(state);
    if (state.phase === "ended") reportWhenFinished();
  });
  if (session.state().phase === "ended") reportWhenFinished();

  return () => {
    unsubscribe();
    if (waiting !== null) window.clearTimeout(waiting);
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
