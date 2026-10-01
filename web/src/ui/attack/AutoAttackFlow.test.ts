// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type {
  AutoAttackPlanResponse,
  AutoAttackReplay,
  AutoAttackResponse,
  PlanSummary,
} from "@/api/autoAttack";
import { ApiError } from "@/api/http";
import type { MapCell, WildMonsterCell } from "@/api/types";
import { watchEvents, watchTarget } from "@/game/autoAttack/watchRun";
import { AutoAttackControl } from "@/ui/maproom/AutoAttackControl";
import { AutoAttackFlow, type AutoAttackCalls } from "./AutoAttackFlow";
import { EndAttackPanel } from "./EndAttackPanel";

/**
 * Auto-attack's screens (issue #221): the camp panel's Repeat attack, the
 * confirm sheet, the result, Attack again on the end panel, and Watch's
 * handoff.
 */

const BASEID = "1000241208";
const CELL = { col: 241, row: 208 };

const PLAN: PlanSummary = {
  tribe: "Kozu",
  level: 35,
  recordedOn: { baseid: "1000240208", x: 240, y: 208 },
  recordedAt: 1_000_000,
  monsters: { C1: 300 },
  champions: [{ t: 1, l: 5 }],
  bombs: ["tw1", "pb1", "pu0"],
  siege: true,
};

const answer = (overrides: Partial<AutoAttackPlanResponse> = {}): AutoAttackPlanResponse => ({
  error: 0,
  baseid: BASEID,
  plan: PLAN,
  missing: [],
  outOfRange: false,
  underAttack: false,
  damage: 41,
  ...overrides,
});

const RESULT: AutoAttackResponse = {
  error: 0,
  baseid: BASEID,
  tribe: "Kozu",
  level: 35,
  damageBefore: 41,
  damageAfter: 92,
  damageAdded: 51,
  conquered: true,
  destroyed: 1,
  loot: { r1: 1200, r2: 0, r3: 300, r4: 0 },
  lootLeft: { r1: 0, r2: 0, r3: 50, r4: 0 },
  flung: { C1: 300 },
  champions: [{ t: 1, hp: 1450 }],
  bombs: ["tw1", "pb1", "pu0"],
  report: "",
  plan: PLAN,
};

const REPLAY: AutoAttackReplay = {
  baseid: BASEID,
  name: "Kozu",
  load: { buildingdata: {} } as never,
  seed: 7,
  events: [
    { kind: "fling", t: 80, x: 1, y: 2, r: 100, monsters: { C1: 200 } },
    { kind: "fling", t: 160, x: 1, y: 2, r: 100, monsters: { C1: 100, C2: 3 } },
    { kind: "retreat", t: 900 },
    "nonsense",
  ],
  tick: 900,
  levels: { C1: 3 },
  declareWar: false,
};

const calls = (overrides: Partial<AutoAttackCalls> = {}): AutoAttackCalls => ({
  plan: vi.fn(async () => answer()),
  run: vi.fn(async () => RESULT),
  replay: vi.fn(async () => ({ error: 0, replay: REPLAY })),
  quote: vi.fn(async () => ({ error: 0, baseid: BASEID, eligible: false, reason: "notFound", now: 0 }) as never),
  takeOver: vi.fn(async () => ({})),
  ...overrides,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (root: ParentNode | null) => root?.textContent ?? "";
const button = (root: ParentNode | null, label: string) =>
  [...(root?.querySelectorAll("button") ?? [])].find((one) => one.textContent === label) as HTMLButtonElement | undefined;

describe("the confirm sheet", () => {
  it("says what it repeats, what it brings and that siege weapons are left out", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, cell: CELL, modal, onWatch: vi.fn(), calls: calls(), now: () => 1_007_300 });
    await flow.start(answer());
    const shown = text(modal);
    expect(shown).toContain("Kozu camp, level 35 · camp damage now 41%");
    expect(shown).toContain("Repeats your attack on the Kozu camp at 240, 208, 2 h ago");
    expect(shown).toContain("300 Pokey");
    expect(shown).toContain("Includes Gorgo L5 and 3 bombs");
    expect(shown).toContain("Siege weapons are not repeated.");
    expect(button(modal, "Attack now")?.disabled).toBe(false);
  });

  it("greys Attack now out and lists everything missing", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(
      answer({
        missing: [
          { kind: "monster", id: "C1", need: 300, have: 120 },
          { kind: "champion", t: 1, reason: "hurt" },
        ],
      }),
    );
    expect(button(modal, "Attack now")?.disabled).toBe(true);
    const items = [...modal.querySelectorAll(".auto-attack__missing li")].map((item) => item.textContent);
    expect(items).toEqual(["Pokey: 180 short (you have 120 of 300 in range)", "Gorgo has no health left"]);
  });
});

describe("the result", () => {
  it("shows the damage added, the total, Conquered!, the loot and the losses, once per press", async () => {
    const modal = document.createElement("div");
    const api = calls();
    const onAttacked = vi.fn();
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), onAttacked, calls: api });
    await flow.start(answer());
    button(modal, "Attack now")!.click();
    button(modal, "Attack now")?.click();
    await settle();

    expect(api.run).toHaveBeenCalledTimes(1);
    expect(onAttacked).toHaveBeenCalledWith(RESULT);
    const shown = text(modal);
    expect(shown).toContain("Conquered!");
    expect(shown).toContain("+51% (41% → 92%)");
    expect(shown).toContain("Camp damage92%");
    expect(shown).toContain("Gorgo1,450 health left");
    expect(shown).toContain("Bombs fired3");
    expect(shown).toContain("some loot was left behind");
    // The takeover offer an attack by hand gets.
    expect(modal.querySelector(".end-takeover")).not.toBeNull();
    expect(button(modal, "Repeat again")).toBeDefined();
  });

  it("Repeat again asks the server again and opens the sheet afresh", async () => {
    const modal = document.createElement("div");
    const api = calls();
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: api });
    await flow.start(answer());
    button(modal, "Attack now")!.click();
    await settle();
    button(modal, "Repeat again")!.click();
    await settle();
    expect(api.plan).toHaveBeenCalledWith(BASEID);
    expect(button(modal, "Attack now")).toBeDefined();
  });

  it("a refusal says why, with the missing list", async () => {
    const modal = document.createElement("div");
    const refused = new ApiError("You do not have everything that attack used.", {
      status: 409,
      details: { data: { reason: "missing", missing: [{ kind: "bomb", id: "tw1", reason: "cost" }] } } as never,
    });
    const flow = new AutoAttackFlow({
      baseid: BASEID,
      modal,
      onWatch: vi.fn(),
      calls: calls({ run: vi.fn(async () => Promise.reject(refused)) }),
    });
    await flow.start(answer());
    button(modal, "Attack now")!.click();
    await settle();
    expect(text(modal)).toContain("You do not have everything that attack used.");
    expect(text(modal)).toContain("Big twig bomb: not enough resources to fire it");
  });

  it("Watch fetches the battle and hands it to the watch scene", async () => {
    const modal = document.createElement("div");
    const onWatch = vi.fn();
    const flow = new AutoAttackFlow({ baseid: BASEID, cell: CELL, modal, onWatch, calls: calls() });
    await flow.start(answer());
    button(modal, "Attack now")!.click();
    await settle();
    button(modal, "Watch")!.click();
    await settle();
    expect(onWatch).toHaveBeenCalledWith({ replay: REPLAY, cell: CELL });
    expect(modal.children).toHaveLength(0);
  });
});

describe("Watch's target", () => {
  it("plays exactly the battle's events, with a roster of what it flings", () => {
    const run = { replay: REPLAY, cell: CELL };
    expect(watchEvents(run).map((event) => event.kind)).toEqual(["fling", "fling", "retreat"]);
    const target = watchTarget(run);
    expect(target.roster.monsters).toEqual({ C1: 300, C2: 3 });
    expect(target.roster.levels).toEqual({ C1: 3 });
    expect(target.load).toBe(REPLAY.load);
    expect(target.cell).toEqual(CELL);
  });
});

describe("the camp panel's Repeat attack", () => {
  const campCell = (overrides: Partial<WildMonsterCell> = {}): MapCell =>
    ({ uid: 0, b: 1, i: 150, bid: BASEID, n: "Kozu", l: 35, dm: 41, d: 0, ...overrides }) as MapCell;

  it("offers the plan on a camp and opens the sheet with the answer", async () => {
    const onRepeat = vi.fn();
    const control = new AutoAttackControl({ plan: async () => answer(), onRepeat, now: () => 1_000_060 });
    control.setCell(CELL, campCell());
    await settle();
    expect(control.button.hidden).toBe(false);
    expect(control.button.disabled).toBe(false);
    expect(control.detail.textContent).toContain("Repeats your attack on the Kozu camp at 240, 208, 1 min ago");
    control.button.click();
    expect(onRepeat).toHaveBeenCalledWith(CELL, BASEID, answer());
  });

  it("greys out with exactly what is missing", async () => {
    const control = new AutoAttackControl({
      plan: async () => answer({ missing: [{ kind: "champion", t: 1, reason: "away" }] }),
      onRepeat: vi.fn(),
    });
    control.setCell(CELL, campCell());
    await settle();
    expect(control.button.disabled).toBe(true);
    expect(control.detail.textContent).toContain("Gorgo is not ready (frozen or away)");
  });

  it("without a plan, says how to get one; on anything but a camp, shows nothing", async () => {
    const plan = vi.fn(async () => answer({ plan: null }));
    const control = new AutoAttackControl({ plan, onRepeat: vi.fn() });
    control.setCell(CELL, campCell());
    await settle();
    expect(control.button.hidden).toBe(true);
    expect(control.detail.textContent).toContain("Attack a Kozu camp of level 35 by hand once");

    control.setCell({ col: 1, row: 1 }, { uid: 9, b: 2, bid: "1", mine: 0 } as unknown as MapCell);
    expect(control.button.hidden).toBe(true);
    expect(control.detail.hidden).toBe(true);
    expect(plan).toHaveBeenCalledTimes(1);
  });
});

describe("Attack again on the end-of-attack panel", () => {
  const summary = {
    targetName: "Kozu",
    kind: "wild",
    endReason: "exhausted",
    outcome: "",
    tone: "lose",
    damagePercent: 40,
    buildingsDestroyed: 1,
    buildingsTotal: 9,
    loot: { r1: 0, r2: 0, r3: 0, r4: 0 },
    lootTaken: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monstersSent: 10,
    monstersLost: 10,
    champions: [],
    elapsedSeconds: 60,
  } as never;

  it("appears once the result is saved, and runs the repeat", () => {
    const again = vi.fn();
    const panel = new EndAttackPanel({ summary, onReturn: vi.fn(), onRetry: vi.fn(), onLeave: vi.fn() });
    panel.setAttackAgain(again);
    expect(button(panel.element, "Attack again")?.hidden).toBe(true);
    panel.setSaved({});
    const shown = button(panel.element, "Attack again")!;
    expect(shown.hidden).toBe(false);
    shown.click();
    expect(again).toHaveBeenCalledTimes(1);
  });
});
