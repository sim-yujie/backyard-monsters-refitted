// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutoAttackPlanResponse, AutoAttackResponse, PlanSummary } from "@/api/autoAttack";
import { setClassicLook } from "@/game/classicLook";
import { AutoAttackFlow, type AutoAttackCalls } from "./AutoAttackFlow";
import { MAX_MARCHERS, RepeatBar, marchersOf, tribeGoalPicture } from "./RepeatBar";
import { REPEAT_BAR_FULL_HOLD_MS, type BarTimers } from "./repeatBarTiming";

/**
 * Repeat attack's working bar (owner, 15 Nov 2026): at least 5 s, full only
 * once the answer is in, stopped by an error; on the map's Repeat attack
 * (which asks for it), and a flow that does not ask keeps the plain line.
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

const calls = (run: AutoAttackCalls["run"], queue?: AutoAttackCalls["queue"]): AutoAttackCalls => ({
  plan: vi.fn(async () => ANSWER),
  run: vi.fn(run),
  ...(queue && { queue: vi.fn(queue) }),
  replay: vi.fn(async () => ({ error: 0, replay: null })),
  quote: vi.fn(async () => ({ error: 0, baseid: BASEID, eligible: false, reason: "notFound", now: 0 }) as never),
  takeOver: vi.fn(async () => ({})),
});

const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll("button")].find((one) => one.textContent === label) as HTMLButtonElement | undefined;

/** The flow on the map's Repeat attack, its confirm sheet open, Attack now pressed. */
const pressAttack = async (run: AutoAttackCalls["run"], queue?: AutoAttackCalls["queue"]) => {
  const modal = document.createElement("div");
  const timers = fakeTimers();
  const onAttacked = vi.fn();
  const flow = new AutoAttackFlow({
    baseid: BASEID,
    modal,
    onWatch: vi.fn(),
    onAttacked,
    calls: calls(run, queue),
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

  it("in the server's battle line: the army halts, the hourglass and the place show, then it marches on (patch 9.1)", async () => {
    const answer = deferred<AutoAttackResponse>();
    let place: number | null = 3;
    const queue = vi.fn(async () => ({ error: 0, place }));
    const { modal, timers, bar, value } = await pressAttack(() => answer.promise, queue);
    const line = () => modal.querySelector<HTMLElement>(".auto-attack__line-words")!;
    const note = () => modal.querySelector<HTMLElement>(".auto-attack__line-note")!;
    const badge = () => modal.querySelector<HTMLElement>(".repeat-bar__wait-place")!;
    // Nothing asked at first: almost every Repeat is answered before then.
    await timers.advance(1000);
    expect(queue).not.toHaveBeenCalled();
    expect(badge().textContent).toBe("");
    await timers.advance(300);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(line().textContent).toBe("Waiting in line · #3");
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe("Nothing spent yet · starts by itself");
    // The scene's badge shows the same words (the line is for a screen reader).
    expect(badge().textContent).toBe("Waiting in line · #3");
    expect(bar()!.classList.contains("repeat-bar--waiting")).toBe(true);
    // The army halts where it was.
    const halted = value();
    await timers.advance(3000);
    expect(value()).toBe(halted);
    place = 1;
    await timers.advance(1000);
    expect(line().textContent).toBe("Waiting in line · #1");
    // The turn comes: the army marches on, from where it halted.
    place = null;
    await timers.advance(1000);
    expect(line().textContent).toBe("Attacking…");
    expect(badge().textContent).toBe("");
    expect(note().hidden).toBe(true);
    expect(bar()!.classList.contains("repeat-bar--waiting")).toBe(false);
    await timers.advance(200);
    expect(value()).toBeGreaterThan(halted);
    const asked = queue.mock.calls.length;
    // After a wait, the march from the turn is short (2 s at most), never a jump.
    answer.resolve(RESULT);
    const resolvedAt = timers.at();
    await timers.advance(50);
    expect(bar()!.classList.contains("repeat-bar--full")).toBe(false);
    await timers.advance(2000);
    expect(bar()!.classList.contains("repeat-bar--full")).toBe(true);
    expect(timers.at() - resolvedAt).toBeLessThanOrEqual(2100);
    // No more asking once the answer is in.
    await timers.advance(3000);
    expect(queue.mock.calls.length).toBe(asked);
    expect(modal.textContent).toContain("Attack result");
  });

  it("the answer arrives while the bar still shows a place: it marches on and lands", async () => {
    const answer = deferred<AutoAttackResponse>();
    const { modal, timers, bar } = await pressAttack(() => answer.promise, async () => ({ error: 0, place: 2 }));
    await timers.advance(1300);
    expect(bar()!.classList.contains("repeat-bar--waiting")).toBe(true);
    answer.resolve(RESULT);
    await timers.advance(50);
    expect(modal.querySelector(".auto-attack__line-words")!.textContent).toBe("Attacking…");
    await timers.advance(5000);
    expect(bar()?.classList.contains("repeat-bar--full") ?? true).toBe(true);
    await timers.advance(REPEAT_BAR_FULL_HOLD_MS);
    expect(modal.textContent).toContain("Attack result");
  });

  it("turned away after waiting in line: the bar stops and the busy refusal shows", async () => {
    const answer = deferred<AutoAttackResponse>();
    const { modal, timers } = await pressAttack(() => answer.promise, async () => ({ error: 0, place: 4 }));
    await timers.advance(1300);
    expect(modal.querySelector(".auto-attack__line-words")!.textContent).toBe("Waiting in line · #4");
    answer.reject(new Error("The server is busy working out other attacks. Try again in a moment."));
    await timers.advance(50);
    expect(modal.querySelector(".repeat-bar")).toBeNull();
    expect(modal.textContent).toContain("The server is busy");
  });

  it("a failed ask for the place changes nothing", async () => {
    const { modal, timers } = await pressAttack(
      () => new Promise(() => undefined),
      async () => {
        throw new Error("offline");
      },
    );
    await timers.advance(4000);
    expect(modal.querySelector(".auto-attack__line-words")!.textContent).toBe("Attacking…");
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
  const units = (bar: RepeatBar) => [...bar.element.querySelectorAll<HTMLElement>(".repeat-bar__unit")];
  const counts = (bar: RepeatBar) => units(bar).map((one) => one.querySelector(".repeat-bar__count, .repeat-bar__more")?.textContent);

  it("big counts are short on the scene: 1.2K, not 1,240", () => {
    const bar = new RepeatBar({ plan: { ...PLAN, monsters: { C3: 1_240 }, champions: [] }, reducedMotion: false });
    expect(bar.element.querySelector(".repeat-bar__count")?.textContent).toBe("1.2K");
    expect(bar.element.querySelector(".repeat-bar__total")?.textContent).toBe("×1.2K");
  });

  it("every kind marches with its count (owner, 20 Nov 2026), the champion leads, the tribe waits at the road's end", () => {
    const marchers = marchersOf(PLAN);
    expect(marchers.map((one) => one.name)).toEqual(["Pokey", "Octo-ooze", "D.A.V.E.", "Eye-ra", "Brain", "Fomor"]);
    expect(marchers.filter((one) => one.count !== null)).toHaveLength(Object.keys(PLAN.monsters).length);

    const bar = new RepeatBar({ plan: PLAN, reducedMotion: false });
    const all = units(bar);
    expect(all).toHaveLength(6);
    // Leaders first: the champion, then the kinds by size; two ranks of three, the leaders at the front (right).
    expect(counts(bar)).toEqual(["Lv 6", "40", "12", "9", "3", "1"]);
    expect(bar.element.querySelector(".repeat-bar__block--two")).not.toBeNull();
    expect(all.map((one) => [one.style.gridColumn, one.style.gridRow])).toEqual([
      ["3", "1"],
      ["3", "2"],
      ["2", "1"],
      ["2", "2"],
      ["1", "1"],
      ["1", "2"],
    ]);
    expect(all[5]!.getAttribute("title")).toBe("Brain ×1");
    expect(all[5]!.querySelector("img")!.getAttribute("src")).toContain("C9");
    // Modern's square monster paintings march as round tokens; the champion's cut-out as it is.
    expect(all[5]!.classList.contains("repeat-bar__unit--token")).toBe(true);
    expect(all[0]!.classList.contains("repeat-bar__unit--champion")).toBe(true);
    expect(all[0]!.classList.contains("repeat-bar__unit--token")).toBe(false);
    expect(bar.element.querySelector<HTMLImageElement>(".repeat-bar__goal-pic")!.getAttribute("src")).toBe("/tribes/abunakki-256.png");
    // Your army's size over its side, the camp over the camp's (neon round 1).
    expect(bar.element.querySelector(".repeat-bar__total")?.textContent).toBe("×65");
    expect(bar.element.querySelector(".repeat-bar__camp")?.textContent).toBe("Abunakki campLv 31");
    expect(bar.element.getAttribute("role")).toBe("progressbar");
  });

  it("one rank up to five marchers, one big marcher alone", () => {
    const five = new RepeatBar({ plan: { ...PLAN, monsters: { C12: 9, C1: 40, C5: 3, C2: 12 } }, reducedMotion: false });
    expect(units(five)).toHaveLength(5);
    expect(five.element.querySelector(".repeat-bar__block--two")).toBeNull();
    expect(units(five).map((one) => one.style.gridColumn)).toEqual(["5", "4", "3", "2", "1"]);

    const one = new RepeatBar({ plan: { ...PLAN, monsters: { C12: 6 }, champions: [] }, reducedMotion: false });
    expect(units(one)).toHaveLength(1);
    expect(one.element.querySelector(".repeat-bar__block--solo")).not.toBeNull();
  });

  it("more kinds than the block holds: nine march and the rest are one \"+N\"", () => {
    const monsters = { C1: 90, C2: 80, C3: 70, C4: 60, C5: 50, C6: 40, C7: 30, C8: 20, C9: 10, C10: 5, C11: 4, C12: 3 };
    const bar = new RepeatBar({ plan: { ...PLAN, monsters }, reducedMotion: false });
    expect(units(bar)).toHaveLength(MAX_MARCHERS);
    expect(counts(bar).at(-1)).toBe("+4");
    expect(units(bar).at(-1)!.getAttribute("title")).toBe("Brain ×10, Crabatron ×5, Project X ×4, D.A.V.E. ×3");
  });

  it("the march, then the fight at the camp's gate", () => {
    const timers = fakeTimers();
    const bar = new RepeatBar({ plan: PLAN, timers, reducedMotion: false, freeze: 0.34 });
    bar.start();
    bar.update();
    expect(bar.element.style.getPropertyValue("--march")).toBe("0.5000");
    expect(bar.element.classList.contains("repeat-bar--fighting")).toBe(false);
    const fight = new RepeatBar({ plan: PLAN, timers, reducedMotion: false, freeze: 0.8 });
    fight.start();
    fight.update();
    expect(fight.element.style.getPropertyValue("--march")).toBe("1.0000");
    expect(fight.element.classList.contains("repeat-bar--fighting")).toBe(true);
  });

  it("the place in the battle line on the scene's badge", () => {
    const bar = new RepeatBar({ plan: PLAN, reducedMotion: false });
    bar.showPlace(3);
    expect(bar.element.querySelector(".repeat-bar__wait-place")?.textContent).toBe("Waiting in line · #3");
    expect(bar.element.querySelector(".repeat-bar__wait-note")?.textContent).toBe("Nothing spent yet · starts by itself");
    expect(bar.element.querySelector(".repeat-bar__wait-icon")?.getAttribute("src")).toContain("hourglass.png");
    bar.showPlace(null);
    expect(bar.element.querySelector(".repeat-bar__wait-place")?.textContent).toBe("");
  });

  it("in Classic: Flash's monster icons and the tribe's Flash splash", () => {
    setClassicLook(true);
    const bar = new RepeatBar({ plan: PLAN, reducedMotion: false });
    expect(units(bar)[5]!.querySelector("img")!.getAttribute("src")).toBe("/assets/monsters/C9-small.png");
    expect(bar.element.querySelector(".repeat-bar__unit--token")).toBeNull();
    expect(tribeGoalPicture("Abunakki")).toBe("/assets/popups/tribe_abunakki.v2.png");
    expect(tribeGoalPicture("Nobody")).toBeNull();
  });

  it("reduced motion marks the bar still; no plan, no marchers and an empty goal", () => {
    const still = new RepeatBar({ plan: PLAN, reducedMotion: true });
    expect(still.element.classList.contains("repeat-bar--still")).toBe(true);
    const moving = new RepeatBar({ plan: null, reducedMotion: false });
    expect(moving.element.classList.contains("repeat-bar--still")).toBe(false);
    expect(units(moving)).toHaveLength(0);
    expect(moving.element.querySelector(".repeat-bar__goal--none")).not.toBeNull();
    // One look only: no switch left behind.
    expect(moving.element.className).toBe("repeat-bar");
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
