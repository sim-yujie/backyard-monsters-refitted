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

/**
 * Auto-attack's screens (issue #221): the camp panel's Repeat attack, the
 * confirm sheet, the result, and Watch's handoff.
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

/** The words a player sees: text, not tooltips or screen-reader labels. */
const NAMES = ["Pokey", "Octo-ooze", "Bolt", "Eye-ra", "Fang", "Crabatron", "D.A.V.E.", "Teratorn", "Ichi", "Gorgo", "Fomor", "Krallen"];
const namesShown = (root: ParentNode | null): string[] => NAMES.filter((name) => text(root).includes(name));

/** The lines look A took out (owner, 20 Nov 2026). */
const GONE = ["Repeats your attack", "Siege weapons", "are spent", "Already in range", "Moving is free", "power", "Includes"];
const goneShown = (root: ParentNode | null): string[] => GONE.filter((words) => text(root).includes(words));

const BIG_PLAN: PlanSummary = {
  ...PLAN,
  monsters: { C3: 1_240, C5: 180, C14: 120, C10: 60, C12: 40, C1: 300, C8: 90, C6: 24 },
  champions: [
    { t: 3, l: 6, pl: 1 },
    { t: 5, l: 3 },
  ],
  bombs: ["tw1", "tw1", "pb1", "pu0"],
};

describe("the confirm sheet, look A (owner, 20 Nov 2026)", () => {
  it("the camp, then the army as tiles: no source line, no siege line, no names as words", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, cell: CELL, modal, onWatch: vi.fn(), calls: calls(), now: () => 1_007_300 });
    await flow.start(answer());
    expect(text(modal.querySelector(".repeat-prompt__camp-name"))).toBe("Kozu camp");
    expect(text(modal.querySelector(".repeat-prompt__level"))).toBe("Lv 35");
    expect(text(modal.querySelector(".repeat-prompt__damage"))).toBe("41%");
    expect(modal.querySelector(".repeat-prompt__damage img")).not.toBeNull();
    // The champion first, "Lv 5", then the monsters with their counts.
    const tiles = [...modal.querySelectorAll(".repeat-prompt__monsters .attack-window__tile")];
    expect(tiles.map((one) => text(one))).toEqual(["Lv 5", "×300"]);
    expect(tiles[0]!.getAttribute("aria-label")).toBe("Gorgo, level 5");
    expect(tiles[1]!.getAttribute("aria-label")).toBe("Pokey ×300");
    expect(tiles.every((one) => one.querySelector("img") !== null)).toBe(true);
    // The Catapult's shots: a resource pile and a size word each, no count.
    expect(text(modal.querySelector(".repeat-prompt__bombs .repeat-prompt__heading"))).toBe("Catapult");
    const bombs = [...modal.querySelectorAll(".repeat-prompt__bombs .attack-window__tile")];
    expect(bombs.map((one) => text(one))).toEqual(["Big", "Big", "Small"]);
    expect(bombs.map((one) => one.getAttribute("aria-label"))).toEqual(["Catapult, big twigs", "Catapult, big pebbles", "Catapult, small putty"]);
    // Nothing in the window says "bomb", not even to a screen reader (owner, 20 Nov 2026).
    const words = [modal.textContent ?? "", ...[...modal.querySelectorAll("[aria-label], [title], [alt]")].flatMap((one) => ["aria-label", "title", "alt"].map((name) => one.getAttribute(name) ?? ""))];
    expect(words.filter((one) => /bomb/i.test(one))).toEqual([]);
    expect(bombs.every((one) => one.querySelector(".res-icon") !== null)).toBe(true);
    expect(namesShown(modal)).toEqual([]);
    expect(goneShown(modal)).toEqual([]);
    expect(text(modal)).not.toContain("monsters are spent");
    expect(button(modal, "Attack now")?.disabled).toBe(false);
  });

  it("a big army: one tile per kind and per champion, one Catapult tile per resource (each flies once per attack)", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(answer({ plan: BIG_PLAN }));
    expect(modal.querySelectorAll(".repeat-prompt__monster")).toHaveLength(Object.keys(BIG_PLAN.monsters).length);
    expect([...modal.querySelectorAll(".repeat-prompt__champion")].map((one) => text(one))).toEqual(["Lv 6", "Lv 3"]);
    // Biggest first.
    expect(text(modal.querySelector(".repeat-prompt__monster"))).toBe("×1,240");
    expect(text(modal.querySelector(".repeat-prompt__total"))).toBe("×2,054");
    // The plan's second twig shot is not shown: a Catapult flings each resource once.
    expect([...modal.querySelectorAll(".repeat-prompt__bomb")].map((one) => text(one))).toEqual(["Big", "Big", "Small"]);
    expect(namesShown(modal)).toEqual([]);
    expect(goneShown(modal)).toEqual([]);
  });

  it("greys Attack now out and lists everything missing, each with its picture", async () => {
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
    // Look A's camp and tiles stay on top of the refusal.
    expect(modal.querySelector(".repeat-prompt__camp")).not.toBeNull();
    expect(modal.querySelectorAll(".repeat-prompt__monsters .attack-window__tile")).toHaveLength(2);
    const items = [...modal.querySelectorAll(".repeat-prompt__shorts li.repeat-prompt__short")];
    expect(items.map((item) => item.textContent)).toEqual(["180 short", "No health left"]);
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual(["Pokey: 180 short", "Gorgo: No health left"]);
    expect(items.every((item) => item.querySelector("img") !== null)).toBe(true);
    expect(namesShown(modal)).toEqual([]);
  });

  it("under attack and out of range: the camp and the army, then the one reason", async () => {
    for (const [overrides, reason] of [
      [{ underAttack: true }, "Someone else is attacking this camp right now."],
      [{ outOfRange: true }, "This camp is out of your Flingers' range."],
    ] as const) {
      const modal = document.createElement("div");
      const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
      await flow.start(answer(overrides));
      expect(modal.querySelector(".repeat-prompt__camp")).not.toBeNull();
      expect(text(modal.querySelector(".auto-attack__refusal"))).toBe(reason);
      expect(button(modal, "Attack now")?.disabled).toBe(true);
      expect(namesShown(modal)).toEqual([]);
      expect(goneShown(modal)).toEqual([]);
    }
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

  it("one card per move: the yard they leave, its monsters as tiles, an arrow, the yard in range", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(answer(MOVES));
    const cards = [...modal.querySelectorAll(".repeat-prompt__move")];
    expect(cards).toHaveLength(3);
    const first = cards[0]!;
    // Source first in the card, destination last, the painted arrow between.
    expect(first.firstElementChild?.classList.contains("repeat-prompt__yard--from")).toBe(true);
    expect(first.lastElementChild?.classList.contains("repeat-prompt__yard--to")).toBe(true);
    expect(first.querySelector(".repeat-prompt__arrow")?.tagName).toBe("IMG");
    expect(text(first.firstElementChild)).toBe("Outpost230, 215");
    expect(text(first.lastElementChild)).toBe("Outpost242, 208");
    // Biggest first, a portrait and a count each.
    expect([...first.querySelectorAll(".repeat-prompt__cargo .attack-window__tile")].map((one) => one.textContent)).toEqual(["×120", "×4"]);
    expect(first.querySelectorAll(".repeat-prompt__cargo img")).toHaveLength(2);
    expect(first.getAttribute("aria-label")).toBe("120 Pokey, 4 D.A.V.E.: from Outpost 230, 215 to Outpost 242, 208");
    expect(text(cards[1]!.firstElementChild)).toBe("Main yard250, 200");
    expect(text(modal.querySelector(".repeat-prompt__moves-part .repeat-prompt__heading"))).toBe("3 moves first");
    // The whole army as in #1, the moves beside or under it.
    expect(modal.querySelector(".repeat-prompt__columns > .repeat-prompt__army .repeat-prompt__camp")).not.toBeNull();
    expect(modal.querySelectorAll(".repeat-prompt__army .repeat-prompt__monster")).toHaveLength(1);
    expect(namesShown(modal)).toEqual([]);
    expect(goneShown(modal)).toEqual([]);
    expect(button(modal, "Attack now")).toBeUndefined();
    expect(button(modal, "Move and attack")?.disabled).toBe(false);
    expect(button(modal, "Cancel")).toBeDefined();
  });

  it("the moves list gets its 'more below' cue beside it, hidden until the page measures more below", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(answer(MOVES));
    const cue = modal.querySelector<HTMLElement>(".repeat-prompt__moves + .repeat-prompt__more");
    expect(cue).not.toBeNull();
    expect(cue!.hidden).toBe(true);
    expect(cue!.getAttribute("aria-hidden")).toBe("true");
    expect(cue!.querySelector(".repeat-prompt__more-arrow")).not.toBeNull();
    // The list itself holds only the cards.
    expect(modal.querySelectorAll(".repeat-prompt__moves > li")).toHaveLength(3);
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
    // The banner leads: first in the sheet (one column), atop the moves (two).
    expect(modal.querySelector(".repeat-prompt__columns--banner")?.firstElementChild?.className).toBe("auto-attack__changed");
    expect(modal.querySelectorAll(".repeat-prompt__move")).toHaveLength(1);
    expect(text(modal.querySelector(".repeat-prompt__move .attack-window__tile"))).toBe("×119");
    button(modal, "Move and attack")!.click();
    await settle();
    expect(api.run).toHaveBeenLastCalledWith(BASEID, "new-key");
  });

  it("not enough monsters even from every yard: refused, each short kind with its portrait, no name", async () => {
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
    const items = [...modal.querySelectorAll(".repeat-prompt__shorts li.repeat-prompt__short")].map((item) => item.textContent);
    expect(items).toEqual(["12 short", "6 short"]);
    expect(modal.querySelectorAll(".repeat-prompt__short img")).toHaveLength(2);
    expect(modal.querySelector(".repeat-prompt__moves")).toBeNull();
    expect(namesShown(modal)).toEqual([]);
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
    expect(text(modal.querySelector(".repeat-prompt__need"))).toBe("1,840 space needed");
    expect([...modal.querySelectorAll(".repeat-prompt__room li.repeat-prompt__room-yard")].map((row) => row.textContent)).toEqual([
      "Outpost242, 20840 free",
      "Main yard250, 200300 free",
    ]);
    expect(modal.querySelector(".repeat-prompt__camp")).not.toBeNull();
    expect(button(modal, "Attack now")?.disabled).toBe(true);
    expect(button(modal, "Move and attack")).toBeUndefined();
  });

  it("not enough housing and no yard in range has room: the space needed alone", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls() });
    await flow.start(answer({ noRoom: { need: 900, free: [] }, yards: MOVES.yards }));
    expect(text(modal.querySelector(".repeat-prompt__need"))).toBe("900 space needed");
    expect(modal.querySelector(".repeat-prompt__room")).toBeNull();
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
    expect(text(modal.querySelector(".repeat-prompt__need"))).toBe("900 space needed");
    expect(text(modal.querySelector(".auto-attack__changed"))).toBe("Your yards changed.");
    // The sheet's camp and army stay on top.
    expect(modal.querySelector(".repeat-prompt__camp")).not.toBeNull();
    expect(modal.querySelectorAll(".repeat-prompt__monsters .attack-window__tile")).toHaveLength(2);
    expect([...modal.querySelectorAll(".repeat-prompt__room li.repeat-prompt__room-yard")].map((row) => row.textContent)).toEqual(["Outpost242, 20840 free"]);
    expect(button(modal, "Close")).toBeDefined();
  });

  it("Move and attack refused for monsters: the camp, the army and each shortage with its portrait", async () => {
    const modal = document.createElement("div");
    const refused = new ApiError("You do not have everything that attack used.", {
      status: 409,
      details: { data: { reason: "missing", missing: [{ kind: "monster", id: "C1", need: 300, have: 100 }] } } as never,
    });
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls({ run: vi.fn(async () => Promise.reject(refused)) }) });
    await flow.start(answer(MOVES));
    button(modal, "Move and attack")!.click();
    await settle();
    expect(text(modal.querySelector(".auto-attack__changed"))).toBe("Your yards changed.");
    expect(text(modal)).toContain("Not enough monsters for that attack.");
    expect([...modal.querySelectorAll(".repeat-prompt__shorts li.repeat-prompt__short")].map((row) => row.textContent)).toEqual(["200 short"]);
    expect(modal.querySelector(".repeat-prompt__camp")).not.toBeNull();
    expect(namesShown(modal)).toEqual([]);
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
  it("shows Victory!, the camp, the loot and the take-over offer, once per press", async () => {
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
    expect(shown).toContain("Victory!");
    expect(modal.querySelector(".arv-head")?.textContent).not.toContain("%");
    expect(modal.querySelector(".arv-head__damage")).toBeNull();
    expect(shown).toContain("Takeover cost");
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
    const row = modal.querySelector(".repeat-prompt__shorts li.repeat-prompt__short");
    expect(row?.textContent).toBe("Big: Not enough resources");
    expect(row?.getAttribute("aria-label")).toBe("Catapult, big twigs: Not enough resources");
    expect(row?.querySelector(".res-icon")).not.toBeNull();
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
    expect(control.detail.textContent).toBe("Attack a full-health camp with monsters to save a Repeat plan.");

    control.setCell({ col: 1, row: 1 }, { uid: 9, b: 2, bid: "1", mine: 0 } as unknown as MapCell);
    expect(control.button.hidden).toBe(true);
    expect(control.detail.hidden).toBe(true);
    expect(plan).toHaveBeenCalledTimes(1);
  });
});

describe("the Attacking bar (owner, 20 Nov 2026: a five-kind army showed four counts)", () => {
  it("marches every kind with its count, and the champions", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({
      baseid: BASEID,
      modal,
      onWatch: vi.fn(),
      calls: calls({ run: vi.fn(() => new Promise<AutoAttackResponse>(() => {})) }),
      progressBar: true,
      barReducedMotion: true,
    });
    await flow.start(answer({ plan: BIG_PLAN }));
    button(modal, "Attack now")!.click();
    await settle();
    const kinds = Object.keys(BIG_PLAN.monsters).length;
    expect(modal.querySelectorAll(".repeat-bar__unit")).toHaveLength(kinds + BIG_PLAN.champions.length);
    const counts = [...modal.querySelectorAll(".repeat-bar__unit:not(.repeat-bar__unit--champion) .repeat-bar__count")].map((one) => one.textContent);
    expect(counts).toHaveLength(kinds);
    expect([...modal.querySelectorAll(".repeat-bar__unit--champion .repeat-bar__count")].map((one) => one.textContent)).toEqual(["Lv 6", "Lv 3"]);
    expect(counts).toContain("1.2K");
    flow.close();
  });
});

describe("Repeat attack's putty fee (owner, 20 Nov 2026)", () => {
  it("the sheet shows the fee as the putty pile and its amount, Attack now ready", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, cell: CELL, modal, onWatch: vi.fn(), calls: calls(), now: () => 1_007_300 });
    await flow.start(answer({ fee: 3_000_000 }));
    const fee = modal.querySelector(".repeat-prompt__fee")!;
    expect(fee).not.toBeNull();
    expect(text(fee.querySelector(".repeat-prompt__fee-word"))).toBe("Repeat fee");
    expect(fee.querySelector(".res-icon--r3")).not.toBeNull();
    expect(text(fee.querySelector(".repeat-prompt__fee-number"))).toBe("3M");
    // The owner dropped the "Spent on start, even on defeat." note (20 Nov 2026).
    expect(fee.querySelector(".repeat-prompt__fee-note")).toBeNull();
    expect(fee.textContent).not.toMatch(/defeat|spent/i);
    expect(fee.getAttribute("aria-label")).toBe("Repeat fee: 3,000,000 putty");
    expect(fee.classList.contains("repeat-prompt__fee--short")).toBe(false);
    expect(fee.querySelector(".repeat-prompt__fee-short")).toBeNull();
    // After the Catapult's shots, in the cost area.
    expect(modal.querySelector(".repeat-prompt__bombs + .repeat-prompt__fee")).not.toBeNull();
    expect(button(modal, "Attack now")?.disabled).toBe(false);
  });

  it("short of putty: Attack now greyed, the refusal and the fee say how much putty is short", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, cell: CELL, modal, onWatch: vi.fn(), calls: calls(), now: () => 1_007_300 });
    await flow.start(answer({ fee: 3_000_000, missing: [{ kind: "fee", need: 3_010_000, have: 1_800_000 }] }));
    expect(button(modal, "Attack now")?.disabled).toBe(true);
    expect(text(modal.querySelector(".auto-attack__refusal"))).toBe("Not enough putty.");
    expect(text(modal.querySelector(".repeat-prompt__short--fee"))).toBe("1.3M short");
    // astra, round 1: the fee also shows the shortage, rounded up, beside its unchanged amount.
    expect(text(modal.querySelector(".repeat-prompt__fee-short"))).toBe("1.3M short");
    expect(text(modal.querySelector(".repeat-prompt__fee-number"))).toBe("3M");
    expect(modal.querySelector(".repeat-prompt__fee--short")).not.toBeNull();
  });

  it("refused at the server for the fee: the same picture, nothing else", async () => {
    const modal = document.createElement("div");
    const refused = new ApiError("You do not have everything that attack used.", {
      status: 409,
      details: { data: { reason: "missing", missing: [{ kind: "fee", need: 3_000_000, have: 2_999_000 }] } } as never,
    });
    const flow = new AutoAttackFlow({
      baseid: BASEID,
      cell: CELL,
      modal,
      onWatch: vi.fn(),
      calls: calls({ run: vi.fn(async () => Promise.reject(refused)) }),
      now: () => 1_007_300,
    });
    await flow.start(answer({ fee: 3_000_000 }));
    button(modal, "Attack now")!.click();
    await settle();
    await settle();
    expect(text(modal.querySelector(".auto-attack__refusal"))).toBe("Not enough putty.");
    expect(text(modal.querySelector(".repeat-prompt__short--fee"))).toBe("1K short");
    expect(text(modal.querySelector(".repeat-prompt__fee-short"))).toBe("1K short");
  });

  it("the camp panel's short line names the putty", async () => {
    const { shortfallText } = await import("./autoAttackText");
    expect(shortfallText({ kind: "fee", need: 2_500_000, have: 1_300_000 })).toBe("Putty: 1.2M short");
    expect(shortfallText({ kind: "fee", need: 2_500_000, have: 2_499_999 })).toBe("Putty: 1 short");
  });
});
