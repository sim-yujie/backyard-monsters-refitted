// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { ATTACK_PLUGINS, type AttackMounts } from "@/game/attack/attackPlugins";
import { AttackSession } from "@/game/attack/AttackSession";
import { battlePlugin } from "@/game/attack/plugins/battle";
import "@/game/attack/plugins";
import { readYard } from "@/game/yard/yardModel";
import { Notices } from "@/ui/maproom/Notices";
import { BAITER_PLUGINS, TEST_LANDING, baiterPlugin, createBaiterPlugin } from "./baiterPlugin";
import type { BaiterRecorder } from "./baiterRecord";
import { baiterTarget, emptyArmy, withChampion, type BaiterRun, type TestArmy } from "./baiterSession";

/**
 * The Baiter's practice attack sends nothing (issue #126): the scene mounts
 * only the battle layer and the Baiter's own package, and a whole practice
 * attack run through that package, from the first fling to the summary,
 * makes no request at all — no attack load, no checkpoint, no save. The
 * Goals record of a finished run (#227) goes through its recorder, stood in
 * for here and tested in `baiterRecord.test.ts`.
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

/** The scene's mounts for `run`, as the attack scene builds them. */
const mountsOf = (
  run: BaiterRun,
  session: AttackSession,
  parts: { dock: HTMLElement; modal: HTMLElement; notices: Notices },
  extra: Partial<AttackMounts> = {},
): AttackMounts =>
  ({
    session,
    target: baiterTarget(run),
    yard: readYard(ownYard()),
    ...parts,
    presentation: new AttackPresentation(),
    goToMap: vi.fn(),
    practice: run,
    ...extra,
  }) as unknown as AttackMounts;

describe("the Baiter scene's packages", () => {
  it("are the battle layer and the Baiter's own, and none of the attack's save, checkpoint or drop packages", () => {
    expect(BAITER_PLUGINS).toEqual([battlePlugin, baiterPlugin]);
    // Every other package a real attack mounts stays off this screen.
    const others = ATTACK_PLUGINS.filter((plugin) => plugin !== battlePlugin);
    expect(others.length).toBeGreaterThanOrEqual(4);
    for (const plugin of others) expect(BAITER_PLUGINS).not.toContain(plugin);
  });
});

describe("a practice attack", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let modal: HTMLElement;
  let dock: HTMLElement;
  let notices: Notices;

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("a practice attack must not call the server")));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { ...globalThis.navigator, sendBeacon: vi.fn(() => true) });
    modal = document.body.appendChild(document.createElement("div"));
    dock = document.body.appendChild(document.createElement("div"));
    notices = new Notices().mount(document.body);
  });

  afterEach(() => {
    notices.destroy();
    modal.remove();
    dock.remove();
    vi.unstubAllGlobals();
  });

  it("flings the test army at the landing point, plays out and summarises, and sends nothing (#126, #22)", () => {
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    const runAgain = vi.fn();
    const goToYard = vi.fn();
    const mounts = mountsOf(run, session, { dock, modal, notices }, { runAgain, goToYard });

    const recorder = spyRecorder();
    const teardown = createBaiterPlugin(() => recorder)(mounts);
    expect(recorder.start).toHaveBeenCalledTimes(1);
    session.start();
    // The whole army went in at once, at the landing point, each row at its own level.
    const fling = session.flingLog().events.find((event) => event.kind === "fling");
    expect(fling).toMatchObject({ x: TEST_LANDING.x, y: TEST_LANDING.y, monsters: { C1: 20, C4: 5 } });
    expect(session.flingLog().events.filter((event) => event.kind === "fling")).toHaveLength(1);
    expect(baiterTarget(run).roster.levels).toMatchObject({ C1: 1, C4: 2 });
    expect(dock.textContent).toContain("Practice attack");
    expect(dock.textContent).toContain("L2");

    for (let frame = 0; frame < 4 * 60 * 8 && session.state().phase !== "ended"; frame += 1) {
      session.advance(0.25);
    }
    expect(session.state().phase).toBe("ended");

    const summary = modal.querySelector(".baiter-summary")!;
    expect(summary.textContent).toContain("Practice over");
    expect(summary.textContent).toContain("Nothing was saved");
    // The run reached its end: the Goals record hears how (#227).
    expect(recorder.finish).toHaveBeenCalledTimes(1);
    expect(recorder.finish.mock.calls[0]![0]).not.toBe("retreat");
    modal.querySelector<HTMLButtonElement>(".baiter-summary__again")!.click();
    expect(runAgain).toHaveBeenCalledWith(run);
    modal.querySelector<HTMLButtonElement>(".baiter-summary__back")!.click();
    expect(goToYard).toHaveBeenCalledTimes(1);

    teardown?.();
    // Not one request, from the first fling to the way out.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  it("starts from the yard as it stands: a damaged building at its own health (owner, 2026-09-29)", () => {
    const save = { ...ownYard(), buildinghealthdata: { "2": 1234 } } as unknown as BaseLoadResponse;
    const session = new AttackSession({ target: baiterTarget({ ...runOf(), save }), seed: 3 });
    expect(session.battle()?.state().health["2"]).toBe(1234);
  });

  it("flings each made-up champion on its own, fresh and at its own level (#22, owner answer Q6)", () => {
    const army = withChampion(withChampion(armyOf(), { t: 1, l: 4, pl: 2 }), { t: 5, l: 3, pl: 1 });
    const save = { ...ownYard(), attackerbrains: { 1: { tower: 1 } } } as unknown as BaseLoadResponse;
    const run: BaiterRun = { ...runOf(army), save };
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    const teardown = createBaiterPlugin(() => spyRecorder())(mountsOf(run, session, { dock, modal, notices }));
    const flings = session.flingLog().events.filter((event) => event.kind === "fling");
    expect(flings).toHaveLength(3);
    expect(flings[1]).toMatchObject({ x: TEST_LANDING.x, y: TEST_LANDING.y, monsters: {}, champion: { t: 1, l: 4, pl: 2 } });
    expect(flings[2]).toMatchObject({ monsters: {}, champion: { t: 5, l: 3, pl: 1 } });
    // No learned brain rides along: the own yard's load is never a frozen attack.
    for (const fling of flings) expect(fling.kind === "fling" && fling.champion?.b).toBeFalsy();
    expect(dock.textContent).toContain("champion");
    teardown?.();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stopping early sends nothing either", () => {
    const run = runOf();
    const session = new AttackSession({ target: baiterTarget(run), seed: 3 });
    const mounts = mountsOf(run, session, { dock, modal, notices });
    const recorder = spyRecorder();
    const teardown = createBaiterPlugin(() => recorder)(mounts);
    session.start();
    session.advance(1);
    session.retreat();
    expect(recorder.finish).toHaveBeenCalledWith("retreat");
    expect(modal.querySelector(".baiter-summary")!.textContent).toContain("You stopped the practice");
    teardown?.();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
