// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import { AttackSession } from "@/game/attack/AttackSession";
import { fixtureRun, type DefenceReplayFixture } from "@/game/defences/defenceFixture";
import { CLIENT_RULES_VERSION, type DefenceWatch } from "@/game/defences/defenceWatch";
import { defenceResultText } from "@/ui/attack/DefencePanels";
import { watchPlugin } from "./watchPlugin";
import { watchTarget } from "./watchRun";
import fixtureJson from "../../../test/fixtures/defence-replay-mixed-waves.json";

/**
 * The watch scene on a defence replay (issue #362,
 * `docs/design/defence-replays.md` §7): the dock with Skip to end, the
 * STORED result once the battle is over and the screen has caught up, drift
 * logged but never shown, no result when the player leaves, and nothing on
 * the screen ever reaching the server.
 */

// jsdom's `import.meta.url` is not a file URL, so the fixture comes in as a module.
const fixture = fixtureJson as unknown as DefenceReplayFixture;

/** A whole battle played through takes a second or so alone, several with the full suite running alongside. */
const BATTLE_TIMEOUT_MS = 30_000;

describe("the watch scene on a defence replay", { timeout: BATTLE_TIMEOUT_MS }, () => {
  let dock: HTMLElement;
  let modal: HTMLElement;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let openWatch: ReturnType<typeof vi.fn>;
  let goToYard: ReturnType<typeof vi.fn>;
  let goToMap: ReturnType<typeof vi.fn>;
  let session: AttackSession;
  let presentation: AttackPresentation;
  let teardown: (() => void) | void;

  beforeEach(() => {
    dock = document.createElement("div");
    modal = document.createElement("div");
    document.body.append(dock, modal);
    fetchSpy = vi.fn(() => Promise.reject(new Error("the watch scene called the server")));
    vi.stubGlobal("fetch", fetchSpy);
    openWatch = vi.fn();
    goToYard = vi.fn();
    goToMap = vi.fn();
    presentation = new AttackPresentation();
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    dock.remove();
    modal.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Mounts the plugin as the scene does: the plugins, then `start()`. */
  const mount = (run: DefenceWatch): void => {
    session = new AttackSession({ target: watchTarget(run), seed: run.replay.seed, declareWar: run.replay.declareWar });
    const mounts = { session, presentation, dock, modal, watch: run, openWatch, goToYard, goToMap } as unknown as AttackMounts;
    teardown = watchPlugin(mounts);
    session.start();
  };

  const runOf = (options: { left?: boolean } = {}): DefenceWatch =>
    fixtureRun(fixture, { left: options.left ?? false, rulesVersion: CLIENT_RULES_VERSION });

  /** Skips to the end, a frame at a time. */
  const skipThrough = (): void => {
    session.skipToEnd();
    for (let frames = 0; !session.ended && frames < 10_000; frames += 1) session.advance(1 / 60);
    expect(session.ended).toBe(true);
  };

  const skipButton = (): HTMLButtonElement => dock.querySelector<HTMLButtonElement>(".defence-dock__skip")!;
  const resultText = (): string | null => modal.querySelector(".defence-result__text")?.textContent ?? null;

  it("docks the attacker's name and Skip to end, and no other control", () => {
    const run = runOf();
    mount(run);
    expect(dock.textContent).toContain(`Defence replay: ${run.defence.attacker.name}`);
    expect(skipButton().textContent).toBe("Skip to end");
    expect(skipButton().disabled).toBe(false);
    expect([...dock.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Skip to end"]);
    expect(modal.children).toHaveLength(0);
  });

  it("Skip to end runs the battle out and shows the stored result at once", () => {
    const run = runOf();
    mount(run);
    skipButton().click();
    expect(session.skipping).toBe(true);
    expect(skipButton().disabled).toBe(true);
    expect(dock.textContent).toContain("Skipping to the end");
    skipThrough();
    expect(session.skipped).toBe(true);
    expect(resultText()).toBe(defenceResultText(run.defence));
    expect(resultText()).toContain(`did ${run.defence.damageDone}% damage`);
  });

  it("matches the stored figures, so it logs no drift", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(runOf());
    skipThrough();
    expect(warn).not.toHaveBeenCalledWith("defence-replay-drift", expect.anything());
  });

  it("logs a drift when the engine's end is not the stored one, and still shows the stored figures", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const played = runOf();
    const run: DefenceWatch = { ...played, defence: { ...played.defence, damageAfter: 10, damageDone: 10 } };
    mount(run);
    skipThrough();
    expect(warn).toHaveBeenCalledWith(
      "defence-replay-drift",
      expect.objectContaining({ id: run.defence.id, stored: 10, replayed: fixture.defence.damageAfter }),
    );
    expect(resultText()).toBe(defenceResultText(run.defence));
    expect(resultText()).toContain("did 10% damage");
  });

  it("shows a left attack's stored result, saying they left", () => {
    const run = runOf({ left: true });
    mount(run);
    skipThrough();
    expect(session.state().tick).toBe(fixture.left.tick);
    expect(resultText()).toBe(defenceResultText(run.defence));
    expect(resultText()).toContain("They left the attack.");
  });

  it("holds the result while the screen is still playing out, then shows it", () => {
    vi.useFakeTimers();
    let walking = true;
    presentation.hold(() => walking);
    mount(runOf());
    skipThrough();
    expect(resultText()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(resultText()).toBeNull();
    walking = false;
    vi.advanceTimersByTime(100);
    expect(resultText()).not.toBeNull();
  });

  it("shows the result after at most 6 s, whatever is still playing", () => {
    vi.useFakeTimers();
    presentation.hold(() => true);
    mount(runOf());
    skipThrough();
    vi.advanceTimersByTime(5900);
    expect(resultText()).toBeNull();
    vi.advanceTimersByTime(200);
    expect(resultText()).not.toBeNull();
  });

  it("shows no result when the player leaves the screen", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(runOf());
    session.advance(1);
    session.leave();
    expect(session.endedBy).toBe("left");
    expect(modal.querySelector(".defence-result")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("Watch again reopens the same replay; Back goes to the yard", () => {
    const run = runOf();
    mount(run);
    skipThrough();
    modal.querySelector<HTMLButtonElement>(".watch-summary__again")!.click();
    expect(openWatch).toHaveBeenCalledWith(run);
    modal.querySelector<HTMLButtonElement>(".watch-summary__back")!.click();
    expect(goToYard).toHaveBeenCalledTimes(1);
    expect(goToMap).not.toHaveBeenCalled();
  });

  it("never calls the server, from the first frame to the result", () => {
    mount(runOf());
    for (let frames = 0; frames < 120; frames += 1) session.advance(1 / 60);
    skipThrough();
    modal.querySelector<HTMLButtonElement>(".watch-summary__again")!.click();
    modal.querySelector<HTMLButtonElement>(".watch-summary__back")!.click();
    teardown?.();
    teardown = undefined;
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("takes its panels down on teardown", () => {
    mount(runOf());
    skipThrough();
    teardown?.();
    teardown = undefined;
    expect(dock.querySelector(".defence-dock")).toBeNull();
    expect(modal.querySelector(".defence-result")).toBeNull();
  });
});

describe("defenceResultText", () => {
  const defence = {
    attacker: { name: "Bramble", pic: null },
    damageDone: 35,
    loot: {},
    housedLost: 0,
    left: false,
  } as const;

  it("names the loot taken", () => {
    expect(defenceResultText({ ...defence, loot: { r1: 1234, r4: 500 } })).toBe(
      "Bramble attacked your yard and did 35% damage. 1,234 Twigs and 500 Goo were looted.",
    );
  });

  it("says when nothing was taken", () => {
    expect(defenceResultText(defence)).toBe("Bramble attacked your yard and did 35% damage. Nothing was looted.");
  });

  it("counts the housed monsters lost", () => {
    expect(defenceResultText({ ...defence, housedLost: 1 })).toBe(
      "Bramble attacked your yard and did 35% damage. Nothing was looted, and 1 housed monster was lost.",
    );
    expect(defenceResultText({ ...defence, loot: { r2: 10 }, housedLost: 4 })).toBe(
      "Bramble attacked your yard and did 35% damage. 10 Pebbles were looted, and 4 housed monsters were lost.",
    );
  });

  it("says when the attacker left", () => {
    expect(defenceResultText({ ...defence, left: true })).toBe(
      "Bramble attacked your yard and did 35% damage. Nothing was looted. They left the attack.",
    );
  });
});
