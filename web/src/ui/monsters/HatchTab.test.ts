// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { HatcheryActions } from "@/api/yardHatchery";
import { monsterStat } from "@/game/combat/rules";
import type { HatcheryMarks } from "@/game/yard/YardHatchMarks";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { HOLD_DELAY_MS } from "@/ui/QuantityStepper";
import { spokenText } from "@/ui/resourceIcon";
import { HatchTab, plural } from "./HatchTab";

/**
 * The Hatch tab as a player meets it (issue #156): each hatchery's line (the
 * monster hatching now, a slot per waiting stack, the locked slot), the HCC's
 * hatcheries and shared queue, the message and housing bar, the grid where a
 * tap chooses a monster, the info panel with the batch add and its dashed
 * preview, and Finish now and the Overdrive behind the small link. Since
 * #268: the numbered lines with the chosen one standing out, the numbers and
 * outline handed to the yard, "Add 5 Pokeys to Hatchery 2", `+5` / `+10`,
 * and what the batch does shown before Add. The rules are
 * `hatchPlan.test.ts`'s; this checks the drawing and the wiring.
 *
 * Pokey (C1) at academy level 1: 250 goo, 15 s, 10 space; Bolt (C3) 350 goo,
 * 23 s, 15 space. Two Housing L6: 1,080.
 */

const T0 = 2_000_000;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

const loadOf = (extra: Partial<BaseLoadResponse> = {}, buildings: BuildingData[] = []): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 0, r4: 1_000_000 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: Object.fromEntries(
      [building(1, 15, 6), building(2, 15, 6), ...buildings].map((one) => [String(one.id), one]),
    ),
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C1: { t: 2 }, C3: { t: 2 }, C4: { t: 1 } },
    academy: {},
    ...extra,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);

/** Hatchery 10 (L3) hatching a Bolt, 12 s left, with Pokeys ×20 and ×5 waiting; hatchery 11 (L2) idle. */
const twoHatcheries = (extra: Partial<BaseLoadResponse> = {}) =>
  loadOf(
    {
      monsters: {
        saved: T0,
        housed: {},
        hid: [10, 11],
        h: [
          ["C3", 12, [["C1", 20, 1], ["C1", 5, 1]], 1],
          ["", 0, []],
        ],
        hstage: [1, 0],
      },
      ...extra,
    },
    [building(10, 13, 3), building(11, 13, 2)],
  );

const setup = (
  save: BaseLoadResponse = twoHatcheries(),
  focus: { buildingId?: number; monster?: string } = {},
  clock: () => number = () => T0,
) => {
  const api = { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi & {
    state: ReturnType<typeof vi.fn>;
  };
  const store = new YardStore({
    save,
    api,
    clock,
    timers: { set: () => 0, clear: () => undefined },
  });
  const ok = <R>(report: R): Promise<YardActionResult<R>> =>
    Promise.resolve({ ok: true, report, completed: [] });
  const actions = {
    add: vi.fn((hatchery: number | "hcc", monster: string, count: number) =>
      ok({ hatchery, monster, added: Math.min(count, 60), requested: count, stoppedBy: count > 60 ? ("goo" as const) : null, cost: { r4: Math.min(count, 60) * 250 } }),
    ),
    remove: vi.fn((hatchery: number | "hcc", slot: number, count: number | "all") =>
      ok({ hatchery, slot, monster: slot === 0 ? "C3" : "C1", removed: count === "all" ? 20 : 1, refund: { r4: slot === 0 ? 350 : 250 } }),
    ),
    finish: vi.fn((hatchery: number | "hcc") => ok({ hatchery, housed: { C3: 1, C1: 25 }, credits: 12, finishedAll: true })),
    overdrive: vi.fn((item: string) => ok({ item, credits: 30, q: 1, endsAt: T0 + 3600 })),
  } satisfies HatcheryActions;
  const showTab = vi.fn();
  const selectBuilding = vi.fn();
  const markHatcheries = vi.fn<(marks: HatcheryMarks | null) => void>();
  const tab = new HatchTab(
    { binding: { store, scene: { selectBuilding, markHatcheries }, notices: {} as Notices }, showTab },
    actions,
  );
  document.body.replaceChildren(tab.element);
  tab.show(focus);
  return { tab, store, api, actions, showTab, selectBuilding, markHatcheries, element: tab.element };
};

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const line = (root: HTMLElement, id: number) =>
  root.querySelector<HTMLElement>(`.hatch-line[data-hatchery="${id}"]`)!;
const nowCard = (root: HTMLElement, id: number) =>
  root.querySelector<HTMLElement>(`.hatch-now[data-hatchery="${id}"]`)!;
const slots = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".hatch-slot")];
const slotKinds = (root: HTMLElement) =>
  slots(root).map((slot) =>
    slot.classList.contains("hatch-slot--empty")
      ? "empty"
      : slot.classList.contains("hatch-slot--locked")
        ? "locked"
        : slot.classList.contains("hatch-slot--preview")
          ? `new ${slot.querySelector(".hatch-slot__count")!.textContent}`
          : `${slot.querySelector(".hatch-slot__name")!.textContent} ${slot.querySelector(".hatch-slot__count")!.textContent}${slot.querySelector(".hatch-slot__adding")?.textContent ?? ""}`,
  );
const monster = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLButtonElement>(`.hatch-monster[data-monster="${id}"]`)!;
const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>(".hatch-add__count")!;
const maxButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".hatch-add__fill")!;
const addButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".hatch-add__add")!;
const type = (input: HTMLInputElement, value: string) => {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.startsWith(text));
const text = (root: HTMLElement, selector: string) => spokenText(root.querySelector(selector)!);

describe("HatchTab: each hatchery's line", () => {
  it("draws hatching now, a slot per stack, empty slots up to the level's limit and the next locked one", () => {
    const { element } = setup(twoHatcheries(), { monster: "C3" });
    // Level 3 takes four stacks; the tab opens on hatchery 10, and one Bolt would open a new stack.
    const first = line(element, 10);
    expect(text(first, ".hatch-line__pick")).toBe("Hatchery 1 · Level 3");
    expect(first.querySelector(".hatch-line__pick")!.getAttribute("aria-pressed")).toBe("true");
    // The chosen line, before → after for the one Bolt chosen.
    expect(text(first, ".hatch-line__waiting")).toBe("25 → 26 waiting of 80");
    expect(spokenText(nowCard(element, 10))).toBe("Hatching now Bolt 12s left");
    expect(slotKinds(first)).toEqual(["Pokey ×20", "Pokey ×5", "new +1", "empty"]);
    expect(text(first, ".hatch-line__done")).toBe("6m 27s");
    // Level 2: three stacks, then "upgrade for a 4th".
    const second = line(element, 11);
    expect(text(second, ".hatch-line__waiting")).toBe("0 waiting of 60");
    expect(spokenText(nowCard(element, 11))).toBe("Hatching now Nothing hatching");
    expect(slotKinds(second)).toEqual(["empty", "empty", "empty", "locked"]);
    expect(text(second, ".hatch-slot__why")).toBe("Upgrade the Hatchery for a 4th slot");
    expect(text(second, ".hatch-line__done")).toBe("—");
  });

  it("switches the target with a line's name, and the upgrade button opens that hatchery", () => {
    const { element, selectBuilding } = setup(twoHatcheries(), { monster: "C1" });
    // One Pokey would top up the ×5 stack.
    expect(slotKinds(line(element, 10))).toEqual(["Pokey ×20", "Pokey ×5+1", "empty", "empty"]);
    buttonNamed(line(element, 11), "Hatchery 2")!.click();
    expect(line(element, 11).classList.contains("hatch-line--target")).toBe(true);
    // Idle: it would start at once.
    expect(spokenText(nowCard(element, 11))).toBe("Hatching now Starts now");
    expect(slotKinds(line(element, 10))).toEqual(["Pokey ×20", "Pokey ×5", "empty", "empty"]);
    buttonNamed(line(element, 11), "Upgrade")!.click();
    expect(selectBuilding).toHaveBeenCalledWith(11);
  });

  it("numbers the lines, makes the chosen one stand out and dims the rest (#268, A)", () => {
    const { element } = setup(twoHatcheries(), { monster: "C1" });
    const lines = [...element.querySelectorAll<HTMLElement>(".hatch-line")];
    expect(lines.map((one) => one.querySelector(".hatch-line__number")!.textContent)).toEqual(["1", "2"]);
    expect(lines.map((one) => one.className)).toEqual([
      "hatch-line hatch-line--target",
      "hatch-line hatch-line--dim",
    ]);
    expect(text(line(element, 10), ".hatch-line__here")).toBe("Adding here");
    expect(line(element, 11).querySelector(".hatch-line__here")).toBeNull();
  });

  it("chooses a dimmed line on a tap anywhere on it, and does nothing else with that tap", async () => {
    const save = twoHatcheries({
      monsters: {
        saved: T0,
        housed: {},
        hid: [10, 11],
        h: [
          ["C3", 12, [["C1", 20, 1]], 1],
          ["C1", 6, [["C3", 2, 1]], 1],
        ],
        hstage: [1, 1],
      },
    });
    const { element, actions } = setup(save, { buildingId: 10, monster: "C1" });
    line(element, 11).querySelector<HTMLButtonElement>('.hatch-slot[data-slot="1"]')!.click();
    await flush();
    expect(actions.remove).not.toHaveBeenCalled();
    expect(line(element, 11).classList.contains("hatch-line--target")).toBe(true);
    expect(line(element, 10).classList.contains("hatch-line--dim")).toBe(true);
    // Chosen now, the same slot takes one out.
    line(element, 11).querySelector<HTMLButtonElement>('.hatch-slot[data-slot="1"]')!.click();
    await flush();
    expect(actions.remove).toHaveBeenCalledWith(11, 1, 1);
  });

  it("numbers the hatcheries oldest first and lists them so, whatever the service order", () => {
    const save = loadOf(
      {
        monsters: { saved: T0, housed: {}, hid: [11, 10], h: [["", 0, []], ["", 0, []]], hstage: [0, 0] },
      },
      [building(11, 13, 2), building(10, 13, 3)],
    );
    const { element } = setup(save, { buildingId: 11 });
    expect([...element.querySelectorAll<HTMLElement>(".hatch-line")].map((one) => one.dataset["hatchery"])).toEqual([
      "10",
      "11",
    ]);
    expect(text(line(element, 11), ".hatch-line__pick")).toBe("Hatchery 2 · Level 2");
    expect(text(element, ".hatch-add__to")).toBe("Adding to Hatchery 2 (Level 2)");
  });

  it("numbers a lone hatchery too, without dimming or 'Adding here'", () => {
    const save = loadOf({}, [building(10, 13, 3)]);
    const { element } = setup(save, { monster: "C1" });
    expect(line(element, 10).className).toBe("hatch-line");
    expect(text(line(element, 10), ".hatch-line__title")).toBe("Hatchery 1 · Level 3");
    expect(text(element, ".hatch-add__words")).toBe("Add 1 Pokey to Hatchery 1");
  });

  it("opens on the clicked hatchery", () => {
    const { element } = setup(twoHatcheries(), { buildingId: 11 });
    expect(line(element, 11).querySelector(".hatch-line__pick")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("asks before cancelling the monster hatching now, and cancels it for its goo", async () => {
    const { element, actions } = setup();
    nowCard(element, 10).click();
    expect(text(element, ".hatch-now--confirm")).toBe("Cancel this Bolt? Goo 350 back Cancel it Keep");
    buttonNamed(element, "Keep")!.click();
    expect(element.querySelector(".hatch-now--confirm")).toBeNull();
    expect(actions.remove).not.toHaveBeenCalled();
    nowCard(element, 10).click();
    buttonNamed(element, "Cancel it")!.click();
    await flush();
    expect(actions.remove).toHaveBeenCalledWith(10, 0, 1);
    expect(text(element, ".monsters-status")).toBe("Cancelled 1 Bolt: Goo 350 back.");
  });

  it("takes one out of a stack per tap, one request each", async () => {
    const { element, actions } = setup();
    const stack = line(element, 10).querySelector<HTMLButtonElement>('.hatch-slot[data-slot="2"]')!;
    expect(stack.getAttribute("aria-label")).toBe("Pokey, 5 waiting. Take one out and get its goo back");
    stack.click();
    await flush();
    expect(actions.remove).toHaveBeenCalledOnce();
    expect(actions.remove).toHaveBeenCalledWith(10, 2, 1);
    expect(text(element, ".monsters-status")).toBe("Took out 1 Pokey: Goo 250 back.");
  });

  it("names a stalled, damaged or unbuilt hatchery's state", () => {
    const save = loadOf(
      {
        buildinghealthdata: { "11": 100 },
        monsters: { saved: T0, housed: {}, hid: [10], h: [["C1", 0, []]], hstage: [2] },
      },
      [building(10, 13, 3), building(11, 13, 3), building(12, 13, 1, { cB: 50 })],
    );
    const { element } = setup(save);
    expect(spokenText(nowCard(element, 10))).toBe("Hatching now Pokey Waiting for housing");
    expect(spokenText(nowCard(element, 11))).toBe("Hatching now Damaged: repair it");
    expect(spokenText(nowCard(element, 12))).toBe("Hatching now Being built");
    expect(text(element, ".hatch-message__title")).toBe(
      "Housing is full: the hatched Pokey waits in this Hatchery for room.",
    );
  });
});

describe("HatchTab: the message and the housing bar", () => {
  it("says what is hatching and what the line and the batch do to housing", () => {
    const { element } = setup(twoHatcheries(), { monster: "C1" });
    expect(text(element, ".hatch-message__title")).toBe(
      "Hatching Bolts. Choose a monster and how many, then press Add.",
    );
    // 15 (the Bolt) + 250 (25 Pokeys) on the way, 10 more for the one Pokey chosen.
    expect(text(element, ".hatch-housing__label")).toBe("Housing after this add");
    expect(text(element, ".hatch-housing__value")).toBe("275 / 1,080");
    expect(element.querySelectorAll(".hatch-housing__part")).toHaveLength(2);
    expect(element.querySelector(".hatch-housing__bar")!.getAttribute("aria-valuetext")).toBe(
      "0 housed, 265 on the way, 10 adding, of 1,080",
    );
    // What each colour is, the batch in its own (#268, G).
    expect(
      [...element.querySelectorAll(".hatch-housing__item")].map((item) => item.textContent),
    ).toEqual(["Housed 0", "On the way 265", "This add 10"]);
  });

  it("says 'after this line' with nothing to add", () => {
    const { element } = setup(twoHatcheries({ resources: { r1: 0, r2: 0, r3: 0, r4: 0 } }), { monster: "C1" });
    expect(text(element, ".hatch-housing__label")).toBe("Housing after this line");
    expect(element.querySelector(".hatch-housing__item--adding")).toBeNull();
  });
});

describe("HatchTab: the grid", () => {
  it("only chooses a monster on a tap, and adds nothing (#268, E)", async () => {
    const { element, actions } = setup(twoHatcheries(), { buildingId: 11 });
    expect(text(element, ".hatch-pick__hint")).toBe("Tap a monster to choose it");
    monster(element, "C3").click();
    monster(element, "C3").click();
    await flush();
    expect(actions.add).not.toHaveBeenCalled();
    expect(monster(element, "C3").getAttribute("aria-pressed")).toBe("true");
    expect(text(element, ".hatch-add__words")).toBe("Add 1 Bolt to Hatchery 2");
    addButton(element).click();
    await flush();
    expect(actions.add).toHaveBeenCalledOnce();
    expect(actions.add).toHaveBeenCalledWith(11, "C3", 1);
  });

  it("dims a locked monster and, chosen, says why and offers the Monster Locker", () => {
    const { element, actions, showTab } = setup();
    expect(monster(element, "C5").classList.contains("hatch-monster--locked")).toBe(true);
    expect(monster(element, "C4").textContent).toContain("Unlocking");
    monster(element, "C5").click();
    expect(actions.add).not.toHaveBeenCalled();
    const gate = element.querySelector<HTMLElement>(".hatch-add__gate")!;
    expect(gate.textContent).toContain("Unlock Eye-ra in the Monster Locker first.");
    expect(addButton(element).disabled).toBe(true);
    buttonNamed(gate, "Go to Monster Locker")!.click();
    expect(showTab).toHaveBeenCalledWith("unlock", { monster: "C5" });
    expect(text(element, ".hatch-pick__locked-text")).toBe(
      "Grey monsters are locked. Unlock them at the Monster Locker, then hatch them here.",
    );
  });

});

describe("HatchTab: the info panel and the batch add", () => {
  it("shows the chosen monster's portrait, level, blurb and six numbers", () => {
    const { element } = setup(twoHatcheries(), { monster: "C3" });
    expect(text(element, ".hatch-info__name")).toBe("Bolt");
    expect(text(element, ".hatch-info__level")).toBe("Level 1");
    expect(text(element, ".hatch-info__blurb")).toContain("Bolt is fast as lightning");
    const stats = [...element.querySelectorAll<HTMLElement>(".hatch-info__stat")].map(
      (stat) => `${stat.querySelector("dt")!.textContent} ${spokenText(stat.querySelector("dd")!)}`,
    );
    expect(stats).toEqual([
      `Speed ${monsterStat("C3", "speed", 1)}`,
      `Health ${monsterStat("C3", "health", 1).toLocaleString("en-US")}`,
      `Damage ${monsterStat("C3", "damage", 1).toLocaleString("en-US")}`,
      "Goo each Goo 350",
      "Housing each 15",
      "Time each 23s",
    ]);
    expect(text(element, ".hatch-info__each")).toBe("Each: Goo 350 · 23s · 15 housing");
  });

  it("offers Max, explains it, previews the batch dashed and adds it in one request", async () => {
    // Four Housing L6 = 2,160; 1,500 housed, 65 on the way: room for 59 Pokeys,
    // but Max is the queue's 61: housing is no limit (#169), only a warning.
    const { element, actions } = setup(
      loadOf(
        {
          monsters: {
            saved: T0,
            housed: { C1: 150 },
            hid: [10, 11],
            h: [
              ["C3", 12, [["C1", 5, 1]], 1],
              ["", 0, []],
            ],
            hstage: [1, 0],
          },
        },
        [building(3, 15, 6), building(4, 15, 6), building(10, 13, 3), building(11, 13, 2)],
      ),
      { buildingId: 11, monster: "C1" },
    );
    expect(maxButton(element).textContent).toBe("Max (61)");
    maxButton(element).click();
    expect(box(element).value).toBe("61");
    expect(maxButton(element).getAttribute("aria-pressed")).toBe("true");
    expect(text(element, ".hatch-add__note")).toBe("Max is 61: the queue has room for 61 more Pokeys.");
    expect(text(element, ".hatch-add__to")).toBe("Adding to Hatchery 2 (Level 2)");
    expect(text(element, ".hatch-add__add")).toBe("Add 61 Pokeys to Hatchery 2");
    // What the batch costs and takes: 61 × 15 s, 61 × 10 housing.
    expect(text(element, ".hatch-add__sum")).toBe("This batch: Goo 15,250 · 15m 15s · 610 housing");
    // One starts at once in the idle hatchery, 60 fill three new stacks: 60 wait.
    expect(spokenText(nowCard(element, 11))).toBe("Hatching now Starts now");
    expect(slotKinds(line(element, 11))).toEqual(["new +20", "new +20", "new +20", "locked"]);
    expect(text(line(element, 11), ".hatch-line__waiting")).toBe("0 → 60 waiting of 60");
    expect(text(element, ".hatch-add__warning")).toBe(
      "Housing fits 59 of these; the rest will hatch and wait in the Hatchery until there is room.",
    );
    expect(text(element, ".hatch-housing__over")).toBe(
      "Over by 15: the rest hatch and wait in the Hatchery for room.",
    );

    type(box(element), "59");
    expect(element.querySelector<HTMLElement>(".hatch-add__warning")!.hidden).toBe(true);
    expect(element.querySelector(".hatch-housing__over")).toBeNull();
    // More than the queue takes is clamped to it.
    type(box(element), "500");
    expect(box(element).value).toBe("61");

    addButton(element).click();
    await flush();
    expect(actions.add).toHaveBeenCalledOnce();
    expect(actions.add).toHaveBeenCalledWith(11, "C1", 61);
    expect(text(element, ".monsters-status")).toBe("Added 60 of 61 Pokeys — out of goo: Goo 15,000 spent.");
  });

  it("fills the queue even when housing is full, and says the monsters will wait (#169)", () => {
    const full = twoHatcheries({
      monsters: { saved: T0, housed: { C1: 108 }, hid: [10, 11], h: [["", 0, []], ["", 0, []]], hstage: [0, 0] },
    });
    const { element } = setup(full, { monster: "C1" });
    expect(maxButton(element).textContent).toBe("Max (81)");
    maxButton(element).click();
    expect(box(element).value).toBe("81");
    expect(addButton(element).disabled).toBe(false);
    expect(text(element, ".hatch-add__warning")).toBe(
      "Housing is full: these will hatch and wait in the Hatchery until there is room.",
    );
    type(box(element), "4");
    expect(text(element, ".hatch-add__warning")).toBe(
      "Housing is full: these will hatch and wait in the Hatchery until there is room.",
    );
    expect(addButton(element).disabled).toBe(false);
  });

  it("climbs faster while + is held", () => {
    vi.useFakeTimers();
    const { element } = setup(twoHatcheries(), { buildingId: 11, monster: "C1" });
    const plus = element.querySelector<HTMLButtonElement>(".hatch-add__step--plus")!;
    plus.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    expect(box(element).value).toBe("2");
    vi.advanceTimersByTime(HOLD_DELAY_MS + 3000);
    const held = Number(box(element).value);
    expect(held).toBeGreaterThan(20);
    plus.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    expect(text(element, ".hatch-add__words")).toBe(`Add ${held} Pokeys to Hatchery 2`);
  });

  it("steps by 5 and 10 beside +, up to Max (#268, E)", () => {
    const { element } = setup(twoHatcheries(), { buildingId: 11, monster: "C1" });
    const jumps = [...element.querySelectorAll<HTMLButtonElement>(".hatch-add__jump")];
    expect(jumps.map((jump) => jump.textContent)).toEqual(["+5", "+10"]);
    jumps[0]!.click();
    expect(box(element).value).toBe("6");
    jumps[1]!.click();
    expect(box(element).value).toBe("16");
    expect(text(element, ".hatch-add__words")).toBe("Add 16 Pokeys to Hatchery 2");
    maxButton(element).click();
    expect(jumps.every((jump) => jump.disabled)).toBe(true);
  });

  it("adds what was typed on the first press of Add", async () => {
    const { element, actions } = setup(twoHatcheries(), { buildingId: 11, monster: "C1" });
    const input = box(element);
    input.focus();
    input.value = "5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(text(element, ".hatch-add__words")).toBe("Add 5 Pokeys to Hatchery 2");
    expect(text(line(element, 11), ".hatch-line__waiting")).toBe("0 → 4 waiting of 60");
    // The press lands on the button's words and takes the focus out of the
    // box, whose redraw runs before the release: the words must be the same
    // node after it, or the browser drops the click (#268).
    const add = addButton(element);
    const pressed = add.querySelector(".hatch-add__words");
    add.focus();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(add.querySelector(".hatch-add__words")).toBe(pressed);
    expect(pressed!.isConnected && !add.disabled).toBe(true);
    add.click();
    await flush();
    expect(actions.add).toHaveBeenCalledOnce();
    expect(actions.add).toHaveBeenCalledWith(11, "C1", 5);
  });

  it("says how much goo is missing, or more silos when the price is over the goo cap", () => {
    const poor = { resources: { r1: 0, r2: 0, r3: 0, r4: 100 } } as Partial<BaseLoadResponse>;
    const short = setup(twoHatcheries(poor), { buildingId: 11, monster: "C1" });
    expect(text(short.element, ".hatch-add__gate")).toBe("Need Goo 150 more");

    const capped = setup(
      twoHatcheries({ ...poor, caps: { r1: 200, r2: 200, r3: 200, r4: 200 } }),
      { buildingId: 11, monster: "C1" },
    );
    expect(text(capped.element, ".hatch-add__gate")).toBe(
      "Need more silos: this costs more than your storage holds.",
    );
  });
});

describe("HatchTab: countdowns", () => {
  it("ticks hatching now, and asks the server once when monsters finish", () => {
    let now = T0;
    const save = loadOf(
      {
        monsters: {
          saved: T0,
          housed: {},
          hid: [10, 11],
          h: [
            ["C1", 5, []],
            ["C1", 5, []],
          ],
          hstage: [1, 1],
        },
      },
      [building(10, 13, 3), building(11, 13, 3)],
    );
    const { tab, api, element } = setup(save, {}, () => now);
    now = T0 + 3;
    tab.tick();
    expect(nowCard(element, 10).querySelector(".hatch-clock")!.textContent).toBe("2s left");
    // Pokeys take 15 s: 13 of them done.
    expect(nowCard(element, 10).querySelector<HTMLElement>(".hatch-now__fill")!.style.width).toBe("86.7%");
    expect(api.state).not.toHaveBeenCalled();
    now = T0 + 5;
    tab.tick();
    tab.tick();
    expect(api.state).toHaveBeenCalledOnce();
  });
});

describe("HatchTab: with a Hatchery Control Centre", () => {
  const hccYard = () =>
    loadOf(
      {
        monsters: {
          saved: T0,
          housed: {},
          hid: [10, 11],
          h: [
            ["C1", 9, []],
            ["", 0, []],
          ],
          hstage: [1, 0],
          hcc: [["C3", 4, 1]],
        },
      },
      [building(10, 13, 3), building(11, 13, 3), building(20, 16, 1)],
    );

  it("shows each hatchery's monster and the shared queue's seven slots, and adds to the shared queue", async () => {
    const { element, actions } = setup(hccYard(), { buildingId: 10, monster: "C3" });
    const hcc = element.querySelector<HTMLElement>(".hatch-line--hcc")!;
    expect(text(hcc, ".hatch-line__title")).toBe("Hatchery Control Centre");
    expect(text(hcc, ".hatch-line__waiting")).toBe("4 waiting of 140");
    expect(spokenText(nowCard(element, 10))).toBe("Hatchery 1 Pokey 9s");
    // The idle hatchery would take the Bolt chosen at once.
    expect(spokenText(nowCard(element, 11))).toBe("Hatchery 2 Starts now");
    // The HCC merges into its last stack (Bolt ×4 → 5), and hatchery 2 takes a Bolt off it at once.
    expect(slotKinds(hcc)).toEqual(["Bolt ×4", "empty", "empty", "empty", "empty", "empty", "empty"]);
    expect(text(hcc, ".hatch-line__done")).toBe("55s");

    hcc.querySelector<HTMLButtonElement>('.hatch-slot[data-slot="1"]')!.click();
    await flush();
    expect(actions.remove).toHaveBeenLastCalledWith("hcc", 1, 1);

    nowCard(element, 10).click();
    buttonNamed(element, "Cancel it")!.click();
    await flush();
    expect(actions.remove).toHaveBeenLastCalledWith(10, 0, 1);

    type(box(element), "3");
    expect(text(element, ".hatch-add__to")).toBe("Adding to the shared queue");
    expect(text(element, ".hatch-add__words")).toBe("Add 3 Bolts");
    addButton(element).click();
    await flush();
    expect(actions.add).toHaveBeenLastCalledWith("hcc", "C3", 3);
  });

  it("numbers no hatchery in the yard: the shared queue has none to choose", () => {
    const { markHatcheries } = setup(hccYard(), { buildingId: 10 });
    expect(markHatcheries).toHaveBeenCalled();
    expect(markHatcheries.mock.calls.every(([marks]) => marks === null)).toBe(true);
  });

  it("says hatched monsters are waiting for housing even while another hatchery works (#169)", () => {
    // Hatchery 10's Pokey is done and stalled; hatchery 11 is still hatching a Bolt.
    const stalled = loadOf(
      {
        monsters: {
          saved: T0,
          housed: { C1: 108 },
          hid: [10, 11],
          h: [
            ["C1", 0, []],
            ["C3", 9, []],
          ],
          hstage: [2, 1],
          hcc: [["C1", 6, 1]],
        },
      },
      [building(10, 13, 3), building(11, 13, 3), building(20, 16, 1)],
    );
    const { element } = setup(stalled, { buildingId: 10, monster: "C1" });
    expect(spokenText(nowCard(element, 10))).toBe("Hatchery 1 Pokey Waiting for housing");
    expect(text(element, ".hatch-message__title")).toBe(
      "Housing is full: a hatched monster waits in the Hatcheries for room.",
    );
  });
});

describe("HatchTab: Finish now and Overdrive, behind one small link", () => {
  const link = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".hatch-line__boost-link")!;
  const finishButton = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>(".hatch-boosts__finish .shiny-button")!;

  it("opens and closes with the link", () => {
    const { element } = setup();
    const boosts = element.querySelector<HTMLElement>(".hatch-boosts")!;
    expect(boosts.hidden).toBe(true);
    expect(link(element).getAttribute("aria-expanded")).toBe("false");
    link(element).click();
    expect(boosts.hidden).toBe(false);
    expect(link(element).getAttribute("aria-expanded")).toBe("true");
    link(element).click();
    expect(boosts.hidden).toBe(true);
  });

  it("disables Finish now with the reason when housing is full", () => {
    const full = twoHatcheries({
      monsters: { saved: T0, housed: { C1: 108 }, hid: [10], h: [["C1", 4, []]], hstage: [1] },
    });
    const { element } = setup(full);
    link(element).click();
    expect(finishButton(element).disabled).toBe(true);
    expect(element.querySelector(".hatch-boosts__reason")!.textContent).toBe("Housing full");
  });

  it("spends on the second tap only", async () => {
    const { element, actions } = setup();
    link(element).click();
    const finish = finishButton(element);
    expect(finish.disabled).toBe(false);
    finish.click();
    expect(actions.finish).not.toHaveBeenCalled();
    finish.click();
    await flush();
    expect(actions.finish).toHaveBeenCalledWith(10);
    expect(text(element, ".monsters-status")).toBe("Hatched 1 Bolt, 25 Pokeys for Shiny 12.");
  });

  it("offers the three Overdrives, or shows the one running beside the line", () => {
    const { element } = setup();
    const offers = [...element.querySelectorAll<HTMLButtonElement>(".hatch-boosts__overdrive .shiny-button")];
    expect(offers.map((button) => button.getAttribute("aria-label"))).toEqual([
      "4x, 30 Shiny",
      "6x, 50 Shiny",
      "10x, 100 Shiny",
    ]);
    const running = setup(twoHatcheries({ storedata: { HOD3: { q: 1, s: T0 - 600, e: T0 + 3000 } } }));
    expect(running.element.querySelector(".hatch-boosts__overdrive .shiny-button")).toBeNull();
    expect(running.element.querySelector(".hatch-boosts__running")!.textContent).toBe(
      "Overdrive 10x: every hatchery works 10 times as fast for 50m 0s.",
    );
    expect(text(line(running.element, 10), ".hatch-line__overdrive")).toBe("Overdrive 10x");
  });
});

describe("plural", () => {
  it("adds an s except to one, or to a name that ends in s, x or a full stop", () => {
    expect(plural("Bolt", 4)).toBe("Bolts");
    expect(plural("Bolt", 1)).toBe("Bolt");
    expect(plural("Slimeattikus", 3)).toBe("Slimeattikus");
    expect(plural("Project X", 3)).toBe("Project X");
    expect(plural("D.A.V.E.", 3)).toBe("D.A.V.E.");
  });
});

describe("HatchTab: the numbers in the yard (#268, B)", () => {
  it("hands the yard every hatchery's number and the chosen one, follows a switch, and clears on hide", () => {
    const { tab, element, markHatcheries } = setup(twoHatcheries(), { buildingId: 11 });
    const last = () => markHatcheries.mock.calls.at(-1)![0];
    expect(last()?.chosen).toBe(11);
    expect([...last()!.numbers]).toEqual([
      [10, 1],
      [11, 2],
    ]);
    buttonNamed(line(element, 10), "Hatchery 1")!.click();
    expect(last()?.chosen).toBe(10);
    tab.hide();
    expect(last()).toBeNull();
    tab.show({});
    expect(last()?.chosen).toBe(10);
    tab.destroy();
    expect(last()).toBeNull();
  });
});
