// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutoAttackPlanResponse, AutoAttackResponse, PlanSummary } from "@/api/autoAttack";
import { setClassicLook } from "@/game/classicLook";
import { AutoAttackFlow, type AutoAttackCalls } from "./AutoAttackFlow";
import { MAX_MARCHERS, RepeatBar, marchersOf, tribeGoalPicture } from "./RepeatBar";
import { REPEAT_BAR_FULL_HOLD_MS, type BarTimers } from "./repeatBarTiming";

/**
 * Repeat attack's working bar (owner, 15 Nov 2026): at least 5 s, full only
 * once the answer is in, stopped by an error; on the map's Repeat attack and
 * the end panel's Attack again (both ask for it), and a flow that does not
 * ask keeps the plain line.
 */

const BASEID = "1000241208";

const PLAN: PlanSummary = {
  tribe: "Abunakki",
  level: 31,
  recordedOn: { baseid: "1000240208", x: 240, y: 208 },
  recordedAt: 1_000_000,
  monsters: { C12: 9, C1: 40, C5: 3, C2: 12, C9: 1 },
  champions: [{ t: 3, l: 6 }],
  bombs: ["pu3"],
  siege: false,
};

const ANSWER: AutoAttackPlanResponse = {
  error: 0,
  baseid: BASEID,
  plan: PLAN,
  missing: [],
  outOfRange: false,
  underAttack: false,
  damage: 0,
};

const RESULT: AutoAttackResponse = {
  error: 0,
  baseid: BASEID,
  tribe: "Abunakki",
  level: 31,
  damageBefore: 0,
  damageAfter: 40,
  damageAdded: 40,
  conquered: false,
  destroyed: 0,
  loot: { r1: 10, r2: 0, r3: 0, r4: 0 },
  lootLeft: { r1: 0, r2: 0, r3: 0, r4: 0 },
  flung: { C12: 9 },
  champions: [],
  bombs: [],
  report: "",
  plan: PLAN,
};

/** Animation frames, run by the fake clock as it moves. */
let frames: FrameRequestCallback[] = [];
vi.stubGlobal("requestAnimationFrame", (step: FrameRequestCallback) => frames.push(step));
vi.stubGlobal("cancelAnimationFrame", () => undefined);

/** A clock that only moves when told to, and timers and frames that fire as it passes them. */
const fakeTimers = (): BarTimers & { advance: (ms: number) => Promise<void>; at: () => number } => {
  let now = 0;
  const waits: { at: number; resolve: () => void }[] = [];
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };
  return {
    now: () => now,
    at: () => now,
    wait: (ms) => new Promise<void>((resolve) => waits.push({ at: now + ms, resolve })),
    advance: async (ms) => {
      const end = now + ms;
      do {
        now = Math.min(end, now + 50);
        for (const wait of waits.filter((one) => one.at <= now)) {
          waits.splice(waits.indexOf(wait), 1);
          wait.resolve();
        }
        const due = frames;
        frames = [];
        for (const step of due) step(now);
        await flush();
      } while (now < end);
    },
  };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const calls = (run: AutoAttackCalls["run"]): AutoAttackCalls => ({
  plan: vi.fn(async () => ANSWER),
  run: vi.fn(run),
  replay: vi.fn(async () => ({ error: 0, replay: null })),
  quote: vi.fn(async () => ({ error: 0, baseid: BASEID, eligible: false, reason: "notFound", now: 0 }) as never),
  takeOver: vi.fn(async () => ({})),
});

const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll("button")].find((one) => one.textContent === label) as HTMLButtonElement | undefined;

/** The flow on the map's Repeat attack, its confirm sheet open, Attack now pressed. */
const pressAttack = async (run: AutoAttackCalls["run"]) => {
  const modal = document.createElement("div");
  const timers = fakeTimers();
  const onAttacked = vi.fn();
  const flow = new AutoAttackFlow({
    baseid: BASEID,
    modal,
    onWatch: vi.fn(),
    onAttacked,
    calls: calls(run),
    progressBar: true,
    barTimers: timers,
    barReducedMotion: false,
  });
  await flow.start(ANSWER);
  button(modal, "Attack now")!.click();
  await timers.advance(0);
  const bar = () => modal.querySelector<HTMLElement>(".repeat-bar");
  const value = () => Number(bar()?.getAttribute("aria-valuenow"));
  return { modal, timers, flow, onAttacked, bar, value };
};

afterEach(() => setClassicLook(false));

describe("the bar's timing on Repeat attack", () => {
  it("an answer before 5 s: the bar runs the full 5 s, then jumps to full, then the result", async () => {
    const { modal, timers, onAttacked, bar, value } = await pressAttack(async () => RESULT);
    // The map hears of the landed attack only when the bar lands.
    expect(onAttacked).not.toHaveBeenCalled();
    expect(bar()).not.toBeNull();
    expect(modal.textContent).toContain("Attacking…");
    // A compact sheet: the bar and one line, no empty button row; small on a phone too.
    expect(modal.querySelector(".attack-end__actions")).toBeNull();
    expect(modal.querySelector(".auto-attack__backdrop--bar")).not.toBeNull();
    expect(modal.querySelectorAll(".panel__body > *")).toHaveLength(2);

    await timers.advance(2500);
    const midway = value();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(100);
    await timers.advance(2300);
    expect(value()).toBeGreaterThan(midway);
    expect(value()).toBeLessThan(100);
    expect(bar()!.classList.contains("repeat-bar--full")).toBe(false);

    await timers.advance(250);
    expect(timers.at()).toBeGreaterThanOrEqual(5000);
    expect(value()).toBe(100);
    expect(bar()!.classList.contains("repeat-bar--full")).toBe(true);
    expect(onAttacked).toHaveBeenCalledWith(RESULT);
    expect(modal.textContent).not.toContain("Attack result");

    await timers.advance(REPEAT_BAR_FULL_HOLD_MS);
    expect(modal.querySelector(".repeat-bar")).toBeNull();
    expect(modal.textContent).toContain("Attack result");
    // The result is the full sheet again, with only Watch and Close.
    expect(modal.querySelector(".auto-attack__backdrop--bar")).toBeNull();
    expect([...modal.querySelectorAll(".attack-end__actions button")].map((one) => one.textContent)).toEqual([
      "Watch",
      "Close",
    ]);
  });

  it("an answer after 5 s: the bar keeps creeping, never full, until the answer lands", async () => {
    const answer = deferred<AutoAttackResponse>();
    const { modal, timers, bar, value } = await pressAttack(() => answer.promise);
    await timers.advance(5000);
    const atFive = value();
    await timers.advance(3000);
    expect(value()).toBeGreaterThan(atFive);
    expect(value()).toBeLessThan(100);
    expect(bar()!.classList.contains("repeat-bar--full")).toBe(false);
    await timers.advance(30_000);
    expect(value()).toBeLessThan(100);

    answer.resolve(RESULT);
    await timers.advance(50);
    expect(value()).toBe(100);
    expect(bar()!.classList.contains("repeat-bar--full")).toBe(true);
    await timers.advance(REPEAT_BAR_FULL_HOLD_MS);
    expect(modal.textContent).toContain("Attack result");
  });

  it("an error: the bar stops at once and the error shows as before", async () => {
    const answer = deferred<AutoAttackResponse>();
    const { modal, timers, onAttacked } = await pressAttack(() => answer.promise);
    await timers.advance(1000);
    answer.reject(new Error("The camp is under attack."));
    await timers.advance(50);
    expect(timers.at()).toBeLessThan(1200);
    expect(modal.querySelector(".repeat-bar")).toBeNull();
    expect(modal.textContent).toContain("The camp is under attack.");
    expect(button(modal, "Close")).toBeDefined();
    expect(onAttacked).not.toHaveBeenCalled();
  });

  it("closing while it runs shows no result later, but the landed attack is still reported", async () => {
    const { modal, timers, flow, onAttacked } = await pressAttack(async () => RESULT);
    await timers.advance(1000);
    flow.close();
    await timers.advance(10_000);
    expect(modal.children).toHaveLength(0);
    expect(onAttacked).toHaveBeenCalledTimes(1);
  });

  it("a flow that asks for no bar keeps the plain line", async () => {
    const modal = document.createElement("div");
    const run = deferred<AutoAttackResponse>();
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls(() => run.promise) });
    await flow.start(ANSWER);
    button(modal, "Attack now")!.click();
    await Promise.resolve();
    expect(modal.querySelector(".repeat-bar")).toBeNull();
    expect(modal.textContent).toContain("Your monsters are attacking…");
    run.resolve(RESULT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modal.textContent).toContain("Attack result");
  });
});

describe("the marching army", () => {
  it("the plan's biggest kinds march (at most 4), champions lead, the tribe waits at the end", () => {
    const marchers = marchersOf(PLAN);
    expect(marchers.map((one) => one.name)).toEqual(["C1", "C2", "C12", "C5", "G3"]);
    expect(marchers.filter((one) => one.count !== null)).toHaveLength(MAX_MARCHERS);

    const bar = new RepeatBar({ plan: PLAN, reducedMotion: false });
    const units = [...bar.element.querySelectorAll(".repeat-bar__marcher")];
    expect(units).toHaveLength(5);
    // Left to right: smallest kind at the back, the champion in front.
    expect(units.map((one) => one.querySelector(".repeat-bar__count")?.textContent ?? "champion")).toEqual([
      "3",
      "9",
      "12",
      "40",
      "champion",
    ]);
    expect(units[0]!.querySelector("img")!.getAttribute("src")).toContain("C5");
    // Modern's square monster paintings march as round tokens; the champion's cut-out as it is.
    expect(units[0]!.classList.contains("repeat-bar__marcher--token")).toBe(true);
    expect(units[4]!.classList.contains("repeat-bar__marcher--token")).toBe(false);
    expect(bar.element.querySelector<HTMLImageElement>(".repeat-bar__goal-pic")!.getAttribute("src")).toBe(
      "/tribes/abunakki-256.png",
    );
    expect(bar.element.getAttribute("role")).toBe("progressbar");
  });

  it("in Classic: Flash's monster icons and the tribe's Flash splash", () => {
    setClassicLook(true);
    const bar = new RepeatBar({ plan: PLAN, reducedMotion: false });
    expect(bar.element.querySelector(".repeat-bar__marcher img")!.getAttribute("src")).toBe(
      "/assets/monsters/C5-small.png",
    );
    expect(bar.element.querySelector(".repeat-bar__marcher--token")).toBeNull();
    expect(tribeGoalPicture("Abunakki")).toBe("/assets/popups/tribe_abunakki.v2.png");
    expect(tribeGoalPicture("Nobody")).toBeNull();
  });

  it("reduced motion marks the bar still; no plan, no marchers and an empty goal", () => {
    const still = new RepeatBar({ plan: PLAN, reducedMotion: true });
    expect(still.element.classList.contains("repeat-bar--still")).toBe(true);
    const moving = new RepeatBar({ plan: null, reducedMotion: false });
    expect(moving.element.classList.contains("repeat-bar--still")).toBe(false);
    expect(moving.element.querySelectorAll(".repeat-bar__marcher")).toHaveLength(0);
    expect(moving.element.querySelector(".repeat-bar__goal--none")).not.toBeNull();
    // One look only: no other look's parts, no art pulled in by custom property.
    expect(moving.element.className).toBe("repeat-bar");
    expect(moving.element.getAttribute("style")).not.toContain("--repeat-art");
  });

  it("never goes backwards, and stays put once stopped", () => {
    const timers = fakeTimers();
    const bar = new RepeatBar({ plan: null, timers, reducedMotion: false });
    bar.start();
    bar.complete();
    bar.update();
    expect(bar.value).toBe(1);

    const stopped = new RepeatBar({ plan: null, timers, reducedMotion: false });
    stopped.start();
    stopped.stop();
    const at = stopped.value;
    stopped.update();
    expect(stopped.value).toBe(at);
    expect(stopped.element.classList.contains("repeat-bar--stopped")).toBe(true);
  });
});
