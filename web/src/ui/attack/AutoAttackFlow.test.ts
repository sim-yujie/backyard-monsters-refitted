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
import { CellPanel } from "@/ui/maproom/CellPanel";
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
    expect(items).toEqual(["Pokey: 180 short", "Gorgo has no health left"]);
  });
});

describe("Smart Repeat attack's prompt (owner, 16 Nov 2026)", () => {
  const FAR = "1000230215";
  const MID = "1000236210";
  const NEAR = "1000242208";
  const HOME = "1000250200";
  const MOVES = {
    moves: [
      { from: FAR, to: NEAR, monsters: { C1: 120, C12: 4 } },
      { from: HOME, to: NEAR, monsters: { C5: 30 } },
      { from: MID, to: "1000243209", monsters: { C1: 60 } },
    ],
    movesKey: "the-key",
    yards: {
      [FAR]: { main: false, x: 230, y: 215 },
      [MID]: { main: false, x: 236, y: 210 },
      [NEAR]: { main: false, x: 242, y: 208 },
      "1000243209": { main: false, x: 243, y: 209 },
      [HOME]: { main: true, x: 250, y: 200 },
    },
  };

  it("lists each move: the yard they leave on the left, the yard in range on the right", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(answer(MOVES));
    const rows = [...modal.querySelectorAll(".auto-attack__move")];
    expect(rows).toHaveLength(3);
    const first = rows[0]!;
    // Source first in the row, destination last.
    expect(first.firstElementChild?.classList.contains("auto-attack__yard--from")).toBe(true);
    expect(first.lastElementChild?.classList.contains("auto-attack__yard--to")).toBe(true);
    expect(text(first.firstElementChild)).toBe("Outpost230, 215");
    expect(text(first.lastElementChild)).toBe("Outpost242, 208");
    // Biggest first, a portrait and a count each.
    expect([...first.querySelectorAll(".auto-attack__unit")].map((unit) => unit.textContent)).toEqual(["×120", "×4"]);
    expect(first.querySelectorAll(".auto-attack__unit img")).toHaveLength(2);
    expect(first.getAttribute("aria-label")).toBe("120 Pokey, 4 D.A.V.E.: from Outpost 230, 215 to Outpost 242, 208");
    expect(text(rows[1]!.firstElementChild)).toBe("Main yard250, 200");
    expect(text(modal)).toContain("Kozu camp · Level 35 · 41% damaged");
    expect(text(modal)).toContain("From3 moves before attackingTo · in range");
    expect(text(modal.querySelector(".auto-attack__in-range"))).toBe("Already in range:×120");
    expect(modal.querySelector(".auto-attack__in-range [aria-label='120 Pokey'] img")).not.toBeNull();
    expect(modal.querySelector(".auto-attack__army-strip [aria-label='300 Pokey']")).not.toBeNull();
    expect(text(modal.querySelector(".auto-attack__footer"))).toContain("Moving is free. The attack uses up these monsters.");
    expect(modal.querySelector(".auto-attack__scroll .auto-attack__footer")).toBeNull();
    expect(button(modal, "Attack now")).toBeUndefined();
    expect(button(modal, "Move and attack")?.disabled).toBe(false);
    expect(button(modal, "Cancel")).toBeDefined();
  });

  it("omits the already-in-range line when the whole army moves", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(answer({ ...MOVES, plan: { ...PLAN, monsters: { C1: 180, C5: 30, C12: 4 } } }));
    expect(modal.querySelector(".auto-attack__in-range")).toBeNull();
    expect(modal.querySelectorAll(".auto-attack__move")).toHaveLength(3);
  });

  it("the champion and bombs get their own line with the champion's portrait (lead's vetting)", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(answer(MOVES));
    const strip = modal.querySelector(".auto-attack__champion-strip");
    expect(text(strip)).toContain("Gorgo L5");
    expect(text(strip)).toContain("3 bombs");
    expect(strip?.querySelectorAll("img")).toHaveLength(1);
    expect(strip?.closest(".auto-attack__in-range")).toBeNull();
  });

  it("Move and attack sends the key of the moves shown, and nothing else", async () => {
    const modal = document.createElement("div");
    const api = calls();
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: api });
    await flow.start(answer(MOVES));
    button(modal, "Move and attack")!.click();
    await settle();
    expect(api.run).toHaveBeenCalledWith(BASEID, "the-key");
  });

  it("no moves: Attack now sends no key, as before", async () => {
    const modal = document.createElement("div");
    const api = calls();
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: api });
    await flow.start(answer({ moves: [], movesKey: null }));
    button(modal, "Attack now")!.click();
    await settle();
    expect(api.run).toHaveBeenCalledWith(BASEID, null);
  });

  it("the moves changed since the prompt: the new plan is shown, with a note, and nothing runs", async () => {
    const modal = document.createElement("div");
    const changed = new ApiError("Your yards changed since you looked. Check the moves again.", {
      status: 409,
      details: { data: { reason: "movesChanged" } } as never,
    });
    const fresh = answer({ ...MOVES, moves: [{ from: FAR, to: NEAR, monsters: { C1: 119 } }], movesKey: "new-key" });
    const api = calls({ run: vi.fn(async () => Promise.reject(changed)), plan: vi.fn(async () => fresh) });
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: api });
    await flow.start(answer(MOVES));
    button(modal, "Move and attack")!.click();
    await settle();
    await settle();
    expect(api.plan).toHaveBeenCalledTimes(1);
    expect(text(modal)).toContain("Your yards changed. Here is the new plan.");
    expect(modal.querySelector(".auto-attack__scroll")?.firstElementChild?.className).toBe("auto-attack__changed");
    expect(modal.querySelectorAll(".auto-attack__move")).toHaveLength(1);
    expect(text(modal.querySelector(".auto-attack__move .auto-attack__unit"))).toBe("×119");
    button(modal, "Move and attack")!.click();
    await settle();
    expect(api.run).toHaveBeenLastCalledWith(BASEID, "new-key");
  });

  it("not enough monsters even from every yard: refused, each short type with its portrait", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(
      answer({
        missing: [
          { kind: "monster", id: "C1", need: 300, have: 288 },
          { kind: "monster", id: "C12", need: 8, have: 2 },
        ],
      }),
    );
    expect(text(modal)).toContain("Not enough monsters for that attack.");
    const items = [...modal.querySelectorAll(".auto-attack__missing li")].map((item) => item.textContent);
    expect(items).toEqual(["Pokey: 12 short", "D.A.V.E.: 6 short"]);
    expect(modal.querySelectorAll(".auto-attack__missing img")).toHaveLength(2);
    expect(modal.querySelector(".auto-attack__moves")).toBeNull();
    expect(button(modal, "Attack now")?.disabled).toBe(true);
  });

  it("not enough housing in range: its own words, the space needed and each yard's room", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(
      answer({
        noRoom: { need: 1_840, free: [{ baseid: NEAR, free: 40 }, { baseid: HOME, free: 300 }] },
        yards: MOVES.yards,
      }),
    );
    const shown = text(modal);
    expect(shown).toContain("Not enough Monster Housing in range.");
    expect(shown).not.toContain("short");
    expect(shown).toContain("Incoming monsters need 1,840 space");
    expect(modal.querySelector(".auto-attack__room")?.previousElementSibling?.textContent).toBe("Receiving yards in range");
    expect([...modal.querySelectorAll(".auto-attack__room li")].map((row) => row.textContent)).toEqual([
      "Outpost242, 20840 space free",
      "Main yard250, 200300 space free",
    ]);
    expect(button(modal, "Attack now")?.disabled).toBe(true);
    expect(button(modal, "Move and attack")).toBeUndefined();
  });

  it("Move and attack refused for room: the refusal shows the space needed and each yard's room", async () => {
    const modal = document.createElement("div");
    const refused = new ApiError("Not enough Monster Housing in range.", {
      status: 409,
      details: { data: { reason: "noRoom", noRoom: { need: 900, free: [{ baseid: NEAR, free: 40 }] }, yards: MOVES.yards } } as never,
    });
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls({ run: vi.fn(async () => Promise.reject(refused)) }) });
    await flow.start(answer(MOVES));
    button(modal, "Move and attack")!.click();
    await settle();
    expect(text(modal)).toContain("Not enough Monster Housing in range.");
    expect(text(modal)).toContain("Incoming monsters need 900 space");
    expect(text(modal)).toContain("Your yards changed.");
    expect([...modal.querySelectorAll(".auto-attack__room li")].map((row) => row.textContent)).toEqual(["Outpost242, 20840 space free"]);
  });

  it("the result leaves out what moved in first (owner, 16 Nov 2026: only the loot and the take-over cost)", async () => {
    const modal = document.createElement("div");
    const moved = { ...RESULT, conquered: false, moved: MOVES.moves, yards: MOVES.yards };
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls({ run: vi.fn(async () => moved) }) });
    await flow.start(answer(MOVES));
    button(modal, "Move and attack")!.click();
    await settle();
    expect(modal.querySelector(".auto-attack--result")).not.toBeNull();
    expect(text(modal)).not.toContain("Moved");
    expect(text(modal)).not.toContain("Pokey");
  });
});

describe("the result", () => {
  it("shows Victory!, the camp's damage, the loot and the take-over offer, once per press", async () => {
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
    expect(shown).toContain("Attack result");
    expect(shown).toContain("Kozu camp · Level 35");
    expect(shown).toContain("Victory!92% damaged");
    expect(shown).toContain("+1,200");
    expect(shown).toContain("Storage full: some loot left behind");
    // The owner wants none of the army, champion or bombs (16 Nov 2026).
    expect(shown).not.toContain("Gorgo");
    expect(shown).not.toContain("Bombs");
    expect(shown).not.toContain("Monsters spent");
    // The short take-over offer.
    expect(modal.querySelector(".end-takeover--compact")).not.toBeNull();
    // Only Watch and Close (owner, 15 Nov 2026): no Repeat again.
    expect(button(modal, "Repeat again")).toBeUndefined();
    expect([...modal.querySelectorAll(".attack-end__actions button")].map((one) => one.textContent)).toEqual([
      "Watch",
      "Close",
    ]);
    expect(api.plan).not.toHaveBeenCalled();
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
    expect(text(modal)).toContain("Missing from the attack:");
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

  it("keeps each camp action's explanation with its button inside the scrolling body", async () => {
    const control = new AutoAttackControl({ plan: async () => answer(), onRepeat: vi.fn() });
    const takeover = {
      button: document.createElement("button"),
      detail: document.createElement("p"),
      setCell: vi.fn(),
      tick: vi.fn(),
    };
    const panel = new CellPanel({
      onClose: vi.fn(), onBookmark: vi.fn(), canBookmark: () => true, onViewYard: vi.fn(),
      attackRefusal: () => null, onAttack: vi.fn(), reach: () => null,
      ownFlinger: () => ({ level: 4, reach: 10 }), onRangeToggle: vi.fn(),
      extraAction: [control, takeover],
    });
    panel.show(CELL, campCell());
    await settle();
    expect(panel.element.classList.contains("mr2-cell--repeat")).toBe(true);
    expect(control.button.nextElementSibling).toBe(control.detail);
    expect(takeover.button.nextElementSibling).toBe(takeover.detail);
    expect(control.detail.nextElementSibling).toBe(takeover.button);
    expect(control.button.closest(".mr2-cell__repeat-body")).not.toBeNull();
    expect(panel.element.querySelector(".mr2-cell__head")?.parentElement).toBe(panel.element);
    panel.show(CELL, undefined);
    expect(panel.element.classList.contains("mr2-cell--repeat")).toBe(false);
    expect(control.detail.hidden).toBe(true);
  });

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

  it("Smart Repeat attack: monsters to move in keep the button live and say so", async () => {
    const moves = [
      { from: "a", to: "b", monsters: { C1: 4 } },
      { from: "c", to: "b", monsters: { C1: 2 } },
    ];
    const control = new AutoAttackControl({ plan: async () => answer({ moves, movesKey: "k" }), onRepeat: vi.fn(), now: () => 1_000_060 });
    control.setCell(CELL, campCell());
    await settle();
    expect(control.button.disabled).toBe(false);
    expect(control.detail.textContent).toContain("1 min ago. 2 moves needed.");
  });

  it("Smart Repeat attack: no room in range greys the button out in its own words", async () => {
    const control = new AutoAttackControl({
      plan: async () => answer({ noRoom: { need: 500, free: [{ baseid: "near", free: 40 }] }, yards: { near: { main: false, x: 242, y: 208 } } }),
      onRepeat: vi.fn(),
    });
    control.setCell(CELL, campCell());
    await settle();
    expect(control.button.disabled).toBe(true);
    expect(control.detail.textContent).toContain("Not enough Monster Housing in range.");
    expect(control.detail.textContent).toContain("Incoming monsters need 500 space.");
    expect(control.detail.firstElementChild?.className).toBe("auto-attack-action__history");
    expect(control.detail.querySelector(".auto-attack__room")?.previousElementSibling?.textContent).toBe("Receiving yards in range");
    expect(text(control.detail.querySelector(".auto-attack__room"))).toBe("Outpost242, 20840 space free");
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

  it("puts the saved attack context before the refusal and portrait shortages", async () => {
    const control = new AutoAttackControl({
      plan: async () => answer({ missing: [{ kind: "monster", id: "C1", need: 300, have: 288 }] }),
      onRepeat: vi.fn(),
    });
    control.setCell(CELL, campCell());
    await settle();
    expect(control.detail.firstElementChild?.className).toBe("auto-attack-action__history");
    expect(control.detail.children[1]?.textContent).toBe("Missing monsters for that attack:");
    expect(control.detail.querySelector(".auto-attack__missing li")?.textContent).toBe("Pokey: 12 short");
    expect(control.detail.querySelector(".auto-attack__missing img")).not.toBeNull();
    expect(control.detail.lastElementChild?.className).toBe("auto-attack-action__missing");
  });

  it("greys out on a camp no Flinger reaches, saying so, and a press runs nothing", async () => {
    const onRepeat = vi.fn();
    const control = new AutoAttackControl({ plan: async () => answer({ outOfRange: true }), onRepeat });
    control.setCell(CELL, campCell());
    await settle();
    expect(control.button.hidden).toBe(false);
    expect(control.button.disabled).toBe(true);
    expect(control.button.title).toBe("This camp is out of your Flingers' range.");
    expect(control.detail.textContent).toContain("This camp is out of your Flingers' range.");
    control.button.click();
    expect(onRepeat).not.toHaveBeenCalled();
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
    inferno: false,
    monstersSent: 10,
    monstersBorn: 0,
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
