// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { ATTACK_TAP_CLAIMS } from "@/game/attack/AttackInput";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { ATTACK_PLUGINS, type AttackMounts } from "@/game/attack/attackPlugins";
import { AttackSession } from "@/game/attack/AttackSession";
import { LAST_ARMY_KEY_PREFIX, bucketFor } from "@/game/attack/bucket";
import { armyPlugin, testArmyPlugin } from "@/game/attack/plugins/army";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { dropPlugin, testDropPlugin } from "@/game/attack/plugins/drop";
import "@/game/attack/plugins";
import { readYard } from "@/game/yard/yardModel";
import { formatAmount } from "@/ui/format";
import { Notices } from "@/ui/maproom/Notices";
import { BAITER_PLUGINS, BAITER_REPLAY_PLUGINS, baiterPlugin, createBaiterPlugin } from "./baiterPlugin";
import type { BaiterRecorder } from "./baiterRecord";
import { baiterTarget, emptyArmy, withChampion, type BaiterRun, type TestArmy } from "./baiterSession";
import { clearTestHistory, recentTests, replayOf } from "./testHistory";

/**
 * A Baiter test plays like a real attack and sends nothing (issues #126, #22
 * WP3): the scene mounts the army and drop packages in their test flavour,
 * the battle layer and the Baiter's own package, so the player drops the
 * test army anywhere a real attack may, and a whole test, from the first
 * drop to the report, makes no request but the Goals record of a finished
 * run (#227), asked for only once something was dropped.
 */

/** A recorder that only remembers what it was told. */
const spyRecorder = (): BaiterRecorder & { start: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn> } => ({
  start: vi.fn(),
  finish: vi.fn(),
});

/** A level-1 Town Hall and a level-1 Cannon Tower: something to fire and something to fall. */
const ownYard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3510",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 14, l: 1, X: -100, Y: -100 },
      "2": { id: 2, t: 20, l: 1, X: 60, Y: 60 },
    },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    academy: {},
  }) as unknown as BaseLoadResponse;

/** A test army of 20 level-1 Pokeys and 5 level-2 Banditos. */
const armyOf = (): TestArmy => {
  const army = emptyArmy(ownYard());
  return {
    ...army,
    monsters: { ...army.monsters, C1: { count: 20, level: 1 }, C4: { count: 5, level: 2 } },
  };
};

const runOf = (army: TestArmy = armyOf()): BaiterRun => ({ save: ownYard(), army, baiterLevel: 3 });

/** Open ground well clear of both buildings. */
const OPEN = { x: -400, y: 200 };
const ELSEWHERE = { x: 300, y: -350 };

/** The scene's mounts for `run`, as the attack scene builds them, on a flat camera. */
const mountsOf = (
  run: BaiterRun,
  session: AttackSession,
  parts: { dock: HTMLElement; modal: HTMLElement; notices: Notices; canvas: HTMLCanvasElement },
  extra: Partial<AttackMounts> = {},
): AttackMounts =>
  ({
    session,
    target: session.target,
    yard: readYard(ownYard()),
    renderer: {
      yardToWorld: (x: number, y: number) => ({ x, y }),
      worldToYard: (x: number, y: number) => ({ x, y }),
      highlightBuilding: () => {},
      setSelected: vi.fn(),
    },
    camera: {
      screenToWorld: (point: { x: number; y: number }) => point,
      centreOn: vi.fn(),
      panByScreen: vi.fn(),
    },
    battleLayer: new Container(),
    setBottomInset: () => {},
    showResources: () => {},
    ...parts,
    presentation: new AttackPresentation(),
    goToMap: vi.fn(),
    practice: run,
    ...extra,
  }) as unknown as AttackMounts;

/** A mouse press and release at a yard point, then the scene asking the tap claims, as a click does. */
const tapAt = (canvas: HTMLCanvasElement, at: { x: number; y: number }): void => {
  for (const type of ["pointerdown", "pointerup"]) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 0 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    canvas.dispatchEvent(event);
  }
  ATTACK_TAP_CLAIMS.some((claim) => claim());
};

const flings = (session: AttackSession) => session.flingLog().events.filter((event) => event.kind === "fling");

describe("the Baiter scene's packages", () => {
  it("are the army and drop packages in their test flavour, the battle layer and the Baiter's own", () => {
    expect(BAITER_PLUGINS).toEqual([testArmyPlugin, testDropPlugin, battlePlugin, baiterPlugin]);
    // Every other package a real attack mounts stays off this screen: the
    // save, the checkpoint, the practice camp, and the real army and drop.
    const others = ATTACK_PLUGINS.filter((plugin) => plugin !== battlePlugin);
    expect(others).toEqual(expect.arrayContaining([armyPlugin, dropPlugin]));
    expect(others.length).toBeGreaterThanOrEqual(5);
    for (const plugin of others) expect(BAITER_PLUGINS).not.toContain(plugin);
  });

  it("on a replay are the battle layer and the Baiter's own, with no army or drop controls (WP5)", () => {
    expect(BAITER_REPLAY_PLUGINS).toEqual([battlePlugin, baiterPlugin]);
  });
});

describe("a Baiter test", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let modal: HTMLElement;
  let dock: HTMLElement;
  let canvas: HTMLCanvasElement;
  let notices: Notices;
  let teardowns: Array<(() => void) | void>;

  /** Mounts the test screen's own packages (the battle layer draws, so it stays out of jsdom). */
  const mount = (
    run: BaiterRun,
    session: AttackSession,
    baiter = createBaiterPlugin(() => spyRecorder()),
    extra: Partial<AttackMounts> = {},
  ): void => {
    const mounts = mountsOf(run, session, { dock, modal, notices, canvas }, extra);
    teardowns = [testArmyPlugin(mounts), testDropPlugin(mounts), baiter(mounts)];
  };

  const playOut = (session: AttackSession): void => {
    for (let frame = 0; frame < 4 * 60 * 8 && session.state().phase !== "ended"; frame += 1) {
      session.advance(0.25);
    }
  };

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("a Baiter test must not call the server")));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { ...globalThis.navigator, sendBeacon: vi.fn(() => true) });
    localStorage.clear();
    modal = document.body.appendChild(document.createElement("div"));
    dock = document.body.appendChild(document.createElement("div"));
    canvas = document.body.appendChild(document.createElement("canvas"));
    notices = new Notices().mount(document.body);
    teardowns = [];
  });

  afterEach(() => {
    for (const teardown of teardowns) teardown?.();
    clearTestHistory();
    notices.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("puts the battle to rest as the report opens, and not before (#308)", () => {
    const presentation = new AttackPresentation();
    const settle = vi.fn();
    presentation.settleWith(settle);
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    mount(run, session, createBaiterPlugin(() => spyRecorder()), { presentation });
    bucketFor(session).setCount("C1", 4);
    tapAt(canvas, OPEN);
    session.advance(2);
    expect(settle).not.toHaveBeenCalled();
    session.retreat();
    expect(modal.querySelector(".test-report")).not.toBeNull();
    expect(settle).toHaveBeenCalledTimes(1);
    // The report on a dimming scrim, not a clear backdrop.
    expect(modal.querySelector(".test-report__backdrop")!.classList.contains("popup-backdrop")).toBe(true);
  });

  it("offers exactly the test army, each row at its level, and nothing to bomb or besiege", () => {
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    mount(run, session);
    const bucket = bucketFor(session);
    expect(bucket.ids()).toEqual(["C1", "C4"]);
    expect(bucket.level("C1")).toBe(1);
    expect(bucket.level("C4")).toBe(2);
    expect(bucket.remaining("C1")).toBe(20);
    expect(bucket.remaining("C4")).toBe(5);
    expect(dock.querySelectorAll(".attack-army__row")).toHaveLength(2);
    expect(dock.textContent).toContain("L2");
    // Monsters and champions only (owner answer Q7), and no last army to load.
    expect(dock.querySelector(".attack-tools")).toBeNull();
    expect(dock.querySelector<HTMLButtonElement>(".attack-army__load-last")!.hidden).toBe(true);
    // The dock names the test first, above the army.
    expect(dock.firstElementChild?.classList.contains("baiter-dock")).toBe(true);
    expect(dock.textContent).toContain("Test attack: nothing is saved");
    // Nothing comes in by itself: the clock waits for the first drop.
    expect(flings(session)).toHaveLength(0);
    expect(session.state().phase).toBe("loaded");
  });

  it("drops where the player taps, as many drops as the army allows (#22, WP3)", () => {
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    mount(run, session);
    const bucket = bucketFor(session);

    bucket.setCount("C1", 8);
    tapAt(canvas, OPEN);
    expect(session.state().phase).toBe("running");
    bucket.setCount("C1", 12);
    bucket.setCount("C4", 5);
    tapAt(canvas, ELSEWHERE);

    const [first, second] = flings(session);
    expect(first).toMatchObject({ x: OPEN.x, y: OPEN.y, monsters: { C1: 8 } });
    expect(second).toMatchObject({ x: ELSEWHERE.x, y: ELSEWHERE.y, monsters: { C1: 12, C4: 5 } });
    expect(bucket.remaining("C1")).toBe(0);
    expect(bucket.remaining("C4")).toBe(0);
    // Nothing left to send: one more tap drops nothing.
    tapAt(canvas, OPEN);
    expect(flings(session)).toHaveLength(2);
  });

  it("sends a made-up champion from its row, fresh and at its own level, and saves no Mode (#22, Q6)", () => {
    const army = withChampion(withChampion(armyOf(), { t: 1, l: 4, pl: 2 }), { t: 5, l: 3, pl: 1 });
    const save = { ...ownYard(), attackerbrains: { 1: { tower: 1 } } } as unknown as BaseLoadResponse;
    const run: BaiterRun = { ...runOf(army), save };
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    mount(run, session);
    const bucket = bucketFor(session);
    expect(bucket.champions().map((champion) => champion.t)).toEqual([1, 5]);

    // Gorgo's Mode is picked in the panel: the fling carries it, nothing saves it.
    const mode = dock.querySelector<HTMLSelectElement>('.attack-army__mode-select[aria-label^="Gorgo"]')!;
    mode.value = "defensive";
    mode.dispatchEvent(new Event("change"));
    bucket.pickChampion(1);
    tapAt(canvas, OPEN);
    bucket.pickChampion(5);
    tapAt(canvas, ELSEWHERE);

    const [gorgo, krallen] = flings(session);
    expect(gorgo).toMatchObject({ x: OPEN.x, y: OPEN.y, monsters: {}, champion: { t: 1, l: 4, pl: 2, s: "defensive" } });
    expect(krallen).toMatchObject({ x: ELSEWHERE.x, monsters: {}, champion: { t: 5, l: 3, pl: 1 } });
    // No learned brain rides along: the own yard's load is never a frozen attack.
    for (const fling of flings(session)) expect(fling.kind === "fling" && fling.champion?.b).toBeFalsy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps no last army, so a real attack's stays as it was", () => {
    const realKey = `${LAST_ARMY_KEY_PREFIX}anon`;
    localStorage.setItem(realKey, JSON.stringify({ v: 1, monsters: { C2: 7 }, champion: null }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    mount(run, session);
    bucketFor(session).fillAll();
    tapAt(canvas, OPEN);
    expect(flings(session)).toHaveLength(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(realKey)!)).toMatchObject({ monsters: { C2: 7 } });
    setItem.mockRestore();
  });

  it("plays out and reports; the only requests are the Goals record's, and only after the first drop", async () => {
    fetchSpy.mockImplementation((url: string) =>
      /goals\/baiter-(start|run)/.test(url)
        ? Promise.resolve(new Response(JSON.stringify({ error: 0, report: { token: "t1" } })))
        : Promise.reject(new Error("a Baiter test must not call the server")),
    );
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    const runAgain = vi.fn();
    const goToYard = vi.fn();
    const changeArmy = vi.fn();
    mount(run, session, baiterPlugin, { runAgain, goToYard, changeArmy });

    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    const bucket = bucketFor(session);
    bucket.fillAll();
    tapAt(canvas, OPEN);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    if (bucket.remaining("C1") + bucket.remaining("C4") > 0) {
      bucket.fillAll();
      tapAt(canvas, ELSEWHERE);
    }
    // A second drop asks for no second token.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    playOut(session);
    expect(session.state().phase).toBe("ended");
    expect(session.state().endReason).not.toBe("retreat");
    const report = modal.querySelector(".test-report")!;
    expect(report.textContent).toContain("Nothing was saved");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toMatch(/goals\/baiter-start$/);
    expect(urls[1]).toMatch(/goals\/baiter-run$/);

    modal.querySelector<HTMLButtonElement>(".test-report__again")!.click();
    expect(runAgain).toHaveBeenCalledWith(run);
    modal.querySelector<HTMLButtonElement>(".test-report__change")!.click();
    expect(changeArmy).toHaveBeenCalledTimes(1);
    modal.querySelector<HTMLButtonElement>(".test-report__back")!.click();
    expect(goToYard).toHaveBeenCalledTimes(1);
    for (const teardown of teardowns) teardown?.();
    teardowns = [];
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  it("starts from the yard as it stands: a damaged building at its own health (owner, 2026-09-29)", () => {
    const save = { ...ownYard(), buildinghealthdata: { "2": 1234 } } as unknown as BaseLoadResponse;
    const session = new AttackSession({ target: baiterTarget({ ...runOf(), save }), seed: 3 });
    expect(session.battle()?.state().health["2"]).toBe(1234);
  });

  it("Stop ends the test with reason retreat and sends nothing", () => {
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    const recorder = spyRecorder();
    mount(run, session, createBaiterPlugin(() => recorder));
    bucketFor(session).setCount("C1", 4);
    tapAt(canvas, OPEN);
    expect(recorder.start).toHaveBeenCalledTimes(1);
    session.advance(1);
    session.retreat();
    expect(session.state().endReason).toBe("retreat");
    expect(recorder.finish).toHaveBeenCalledWith("retreat");
    expect(modal.querySelector(".test-report__result")!.textContent).toBe("Stopped");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("times a test that ran out of time to the countdown, not the retreat after it (#308)", () => {
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    mount(run, session);
    bucketFor(session).setCount("C1", 4);
    tapAt(canvas, OPEN);
    session.advance(3);
    // A one-second countdown: the three seconds after it were the retreat.
    const real = session.state.bind(session);
    vi.spyOn(session, "state").mockImplementation(() => ({ ...real(), countdownSeconds: 1 }));
    session.retreat();
    expect(recentTests()[0]!.report.time).toBe("0:01");
  });

  it("reports a champion called back off the field as retreated, with its health (#308)", () => {
    const run = runOf(withChampion(armyOf(), { t: 1, l: 4, pl: 0 }));
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    mount(run, session);
    const bucket = bucketFor(session);
    bucket.pickChampion(1);
    tapAt(canvas, OPEN);
    session.advance(1);
    session.retreatChampion(1);
    for (let step = 0; step < 240 && session.battle()!.creeps().some((creep) => creep.champion); step += 1) {
      session.advance(0.25);
    }
    expect(session.battle()!.creeps().some((creep) => creep.champion)).toBe(false);
    const health = session.state().championsHp[1]!;
    expect(health).toBeGreaterThan(0);
    session.retreat();
    expect(modal.querySelector(".test-report")!.textContent).toContain(`GorgoRetreated with ${formatAmount(health)} health`);
  });

  it("no longer calls a champion on the field once the test is over (#308)", () => {
    const run = runOf(withChampion(armyOf(), { t: 1, l: 4, pl: 0 }));
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    mount(run, session);
    bucketFor(session).pickChampion(1);
    tapAt(canvas, OPEN);
    session.advance(1);
    const note = (): string => dock.querySelector(".attack-army__champion .attack-army__note")?.textContent ?? "";
    expect(note()).toBe("On the field");
    session.retreat();
    expect(note()).not.toBe("On the field");
    // Still out when it was stopped: it survived, and did not retreat.
    expect(modal.querySelector(".test-report")!.textContent).toContain("GorgoSurvived with");
  });

  it("shows a tower tapped in the report: the camera centres on it and rings it (#22, WP4)", () => {
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    const camera = {
      zoom: 0.3,
      screenToWorld: (point: { x: number; y: number }) => point,
      zoomAt: vi.fn(),
      centreOn: vi.fn(),
      panByScreen: vi.fn(),
    };
    const setSelected = vi.fn();
    const renderer = {
      yardToWorld: (x: number, y: number) => ({ x, y }),
      worldToYard: (x: number, y: number) => ({ x, y }),
      highlightBuilding: () => {},
      setSelected,
    };
    mount(run, session, createBaiterPlugin(() => spyRecorder()), {
      camera: camera as unknown as AttackMounts["camera"],
      renderer: renderer as unknown as AttackMounts["renderer"],
    });
    bucketFor(session).setCount("C1", 4);
    tapAt(canvas, OPEN);
    session.advance(2);
    session.retreat();

    modal.querySelector<HTMLButtonElement>("#test-report-tab-towers")!.click();
    const rows = [...modal.querySelectorAll<HTMLTableRowElement>("#test-report-towers tbody tr")];
    expect(rows.map((row) => row.querySelector("th")!.textContent)).toEqual(["Cannon Tower L1"]);
    rows[0]!.querySelector<HTMLButtonElement>(".test-report__show")!.click();
    const cannon = readYard(ownYard()).buildings.find((building) => building.id === 2)!;
    // From the fitted view it zooms in first, close enough to make out one tower.
    expect(camera.zoomAt).toHaveBeenCalledWith(0.9, expect.anything());
    expect(camera.centreOn).toHaveBeenCalledWith({ x: cannon.centreX, y: cannon.centreY });
    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    // Back to the report lets the tower go.
    modal.querySelector<HTMLButtonElement>(".test-report__peek-back")!.click();
    expect(setSelected).toHaveBeenLastCalledWith(null);
  });

  it("stopped before any drop, it asks for no Goals token at all", () => {
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    const recorder = spyRecorder();
    mount(run, session, createBaiterPlugin(() => recorder));
    session.retreat();
    expect(recorder.start).not.toHaveBeenCalled();
    expect(session.state().phase).toBe("ended");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("replay (#22, WP5)", () => {
    /** A finished test: two drops, played out to its own end. */
    const finishedTest = (run: BaiterRun = runOf()): AttackSession => {
      const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
      mount(run, session);
      const bucket = bucketFor(session);
      bucket.setCount("C1", 12);
      tapAt(canvas, OPEN);
      session.advance(1.5);
      bucket.fillAll();
      tapAt(canvas, ELSEWHERE);
      playOut(session);
      return session;
    };

    /** Plays `run` back as the replay scene does: its seed, the Baiter package alone, then start. */
    const playBack = (run: BaiterRun, recorder = spyRecorder(), extra: Partial<AttackMounts> = {}): AttackSession => {
      const session = new AttackSession({ target: baiterTarget(run), seed: run.replay!.seed });
      teardowns.push(createBaiterPlugin(() => recorder)(mountsOf(run, session, { dock, modal, notices, canvas }, extra)));
      session.start();
      playOut(session);
      return session;
    };

    /** What the report reads off the battle: damage, what fell, every tower's counters, the attackers'. */
    const outcome = (session: AttackSession) => {
      const state = session.battle()!.state();
      return {
        damage: session.state().damagePercent,
        destroyed: [...state.destroyedIds].sort(),
        health: state.health,
        towers: state.towers,
        attackers: state.attackers,
      };
    };

    it("keeps a finished test and plays it back to the same battle, asking nothing", () => {
      const original = finishedTest();
      expect(original.state().phase).toBe("ended");
      const [recorded] = recentTests();
      expect(recorded).toBeDefined();
      expect(recorded!.seed).toBe(3);
      expect(recorded!.events).toEqual(original.flingLog().events);

      for (const teardown of teardowns) teardown?.();
      teardowns = [];
      modal.replaceChildren();
      dock.replaceChildren();

      const recorder = spyRecorder();
      const replay = playBack(replayOf(recorded!), recorder);
      expect(replay.state().phase).toBe("ended");
      expect(outcome(replay)).toEqual(outcome(original));
      expect(replay.battle()!.state().tick).toBe(recorded!.endTick);
      // No new test: no Goals token, no request, nothing new kept.
      expect(recorder.start).not.toHaveBeenCalled();
      expect(recorder.finish).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(recentTests()).toHaveLength(1);
      // No controls: the dock names the replay and holds no army.
      expect(dock.textContent).toContain("Test replay");
      expect(dock.querySelector(".attack-army__row")).toBeNull();
    });

    it("puts the battle to rest as the replay's report opens (#308)", () => {
      finishedTest();
      const recorded = recentTests()[0]!;
      for (const teardown of teardowns) teardown?.();
      teardowns = [];
      modal.replaceChildren();

      const presentation = new AttackPresentation();
      const settle = vi.fn();
      presentation.settleWith(settle);
      playBack(replayOf(recorded), spyRecorder(), { presentation });
      expect(modal.querySelector(".test-report")).not.toBeNull();
      expect(settle).toHaveBeenCalledTimes(1);
    });

    it("Watch replay on the report opens the recorded test on the replay scene", () => {
      const watchTest = vi.fn();
      const run = runOf();
      const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
      mount(run, session, createBaiterPlugin(() => spyRecorder()), { watchTest });
      bucketFor(session).setCount("C1", 4);
      tapAt(canvas, OPEN);
      session.advance(2);
      session.retreat();
      modal.querySelector<HTMLButtonElement>(".test-report__replay")!.click();
      expect(watchTest).toHaveBeenCalledWith(replayOf(recentTests()[0]!));
      const replay = watchTest.mock.calls[0]![0] as BaiterRun;
      expect(replay.replay?.events.map((event) => event.kind)).toEqual(["fling", "retreat"]);
    });

    it("ends a replay on the recorded report, with Watch again and Back to yard only", () => {
      finishedTest();
      const recorded = recentTests()[0]!;
      for (const teardown of teardowns) teardown?.();
      teardowns = [];
      modal.replaceChildren();

      const watchTest = vi.fn();
      const goToYard = vi.fn();
      const run = replayOf(recorded);
      playBack(run, spyRecorder(), { watchTest, goToYard });
      const report = modal.querySelector(".test-report")!;
      expect(report.querySelector(".test-report__result")!.textContent).toBe(recorded.report.resultLine);
      expect(report.querySelector(".test-report__again")).toBeNull();
      expect(report.querySelector(".test-report__change")).toBeNull();
      const again = report.querySelector<HTMLButtonElement>(".test-report__replay")!;
      expect(again.textContent).toBe("Watch again");
      again.click();
      expect(watchTest).toHaveBeenCalledWith(run);
      report.querySelector<HTMLButtonElement>(".test-report__back")!.click();
      expect(goToYard).toHaveBeenCalledTimes(1);
    });

    it("plays the yard as it was: changing the yard after a test does not change its replay", () => {
      const save = ownYard();
      const original = finishedTest({ ...runOf(), save });
      const recorded = recentTests()[0]!;
      for (const teardown of teardowns) teardown?.();
      teardowns = [];

      // The tower is repaired and upgraded in the yard since.
      save.buildinghealthdata = { "2": 1 };
      (save.buildingdata as Record<string, { l: number }>)["2"]!.l = 9;
      const replay = playBack(replayOf(recorded));
      expect(outcome(replay)).toEqual(outcome(original));
    });

    it("keeps nothing of a test stopped before any drop, and offers no replay of it", () => {
      const run = runOf();
      const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
      mount(run, session);
      session.retreat();
      expect(recentTests()).toHaveLength(0);
      expect(modal.querySelector(".test-report__replay")).toBeNull();
    });
  });
});
