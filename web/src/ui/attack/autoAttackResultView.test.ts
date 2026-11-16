// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutoAttackPlanResponse, AutoAttackResponse, PlanSummary } from "@/api/autoAttack";
import { AutoAttackFlow, type AutoAttackCalls } from "./AutoAttackFlow";
import { resultView } from "./autoAttackResultView";
import { resultLayout } from "./resultLayout";

/**
 * astra's three looks for the Repeat attack's result (owner, 16 Nov 2026),
 * behind `?arp=A|B|C` until the owner picks one.
 */

const BASEID = "22913802237211";

const PLAN: PlanSummary = {
  tribe: "Legionnaire",
  level: 33,
  recordedOn: { baseid: "22913802239209", x: 239, y: 209 },
  recordedAt: 1_000_000,
  monsters: { C6: 20 },
  champions: [{ t: 3, l: 6, pl: 1 }],
  bombs: ["tw1", "pb1"],
  siege: false,
};

const BUSY: AutoAttackResponse = {
  error: 0,
  baseid: BASEID,
  tribe: "Legionnaire",
  level: 33,
  damageBefore: 0,
  damageAfter: 94,
  damageAdded: 94,
  conquered: true,
  destroyed: 1,
  loot: { r1: 100_000, r2: 100_000, r3: 0, r4: 0 },
  lootLeft: { r1: 2_433_869, r2: 0, r3: 0, r4: 0 },
  flung: { C6: 20 },
  champions: [{ t: 3, hp: 35_570 }],
  bombs: ["tw1", "pb1"],
  report: "",
  plan: PLAN,
  moved: [{ from: "22913802230214", to: "22913802238209", monsters: { C6: 20 } }],
  yards: { "22913802230214": { main: false, x: 230, y: 214 }, "22913802238209": { main: false, x: 238, y: 209 } },
};

const PLAIN: AutoAttackResponse = {
  ...BUSY,
  damageAfter: 13,
  damageAdded: 13,
  conquered: false,
  destroyed: 0,
  loot: { r1: 373_219, r2: 373_068, r3: 373_162, r4: 119_257 },
  lootLeft: { r1: 0, r2: 0, r3: 0, r4: 0 },
  flung: { C6: 8, C12: 2 },
  champions: [],
  bombs: [],
  moved: [],
  yards: {},
  plan: { ...PLAN, champions: [], bombs: [] },
};

const STALLED: AutoAttackResponse = { ...PLAIN, damageAfter: 1, damageAdded: 1, loot: { r1: 0, r2: 0, r3: 0, r4: 0 } };

const LAYOUTS = ["A", "B", "C"] as const;
const all = (view: ReturnType<typeof resultView>): string =>
  [view.head, ...view.middle].map((node) => node.textContent ?? "").join(" | ");

afterEach(() => {
  window.localStorage.removeItem("bymr.arp");
  window.history.replaceState(null, "", "/");
});

describe("the switch", () => {
  it("is today's panel unless A, B or C is asked for, by address or by storage", () => {
    expect(resultLayout()).toBe("today");
    window.localStorage.setItem("bymr.arp", "b");
    expect(resultLayout()).toBe("B");
    window.history.replaceState(null, "", "/?arp=C");
    expect(resultLayout()).toBe("C");
    window.history.replaceState(null, "", "/?arp=Z");
    expect(resultLayout()).toBe("today");
  });
});

describe.each(LAYOUTS)("look %s", (layout) => {
  it("says the damage once, with Conquered!, and has a place for the offer", () => {
    const view = resultView(layout, BUSY);
    const words = all(view);
    expect(words).toContain("Legionnaire · Level 33");
    expect(words).toContain("Conquered!");
    expect(words).toContain("0% → 94%");
    expect(words).toContain("+94%");
    expect(words.match(/94%/g)?.length).toBe(2);
    expect(view.offerHost).not.toBeNull();
    expect(words).toContain("Storage full");
  });

  it("shows the loot, what was spent, the champion's health, the bombs and the move", () => {
    const view = resultView(layout, BUSY);
    const root = document.createElement("div");
    root.append(view.head, ...view.middle);
    expect(root.querySelectorAll(".arv-loot__item")).toHaveLength(4);
    expect(root.querySelectorAll(".arv-loot__item--none")).toHaveLength(2);
    expect(root.querySelector('[aria-label="20 Ichi"]')).not.toBeNull();
    expect(root.textContent).toContain("35,570");
    expect(root.textContent).toContain("×2");
    expect(root.textContent).toContain("230, 214 → 238, 209");
  });

  it("a plain result: no Conquered!, no offer, no champion or bomb rows", () => {
    const view = resultView(layout, PLAIN);
    const words = all(view);
    expect(words).not.toContain("Conquered!");
    expect(view.offerHost).toBeNull();
    expect(words).not.toContain("Storage full");
    const root = document.createElement("div");
    root.append(view.head, ...view.middle);
    expect(root.querySelector(".arv-champion")).toBeNull();
    expect(root.querySelector(".arv-bombs")).toBeNull();
    expect(root.querySelector(".arv-moved")).toBeNull();
  });

  it("a fallen champion says Fell; a stalled attack says to attack by hand", () => {
    expect(all(resultView(layout, { ...BUSY, champions: [{ t: 3, hp: 0 }] }))).toContain("Fell");
    expect(all(resultView(layout, STALLED))).toContain("Attack by hand");
  });
});

describe("astra round 1", () => {
  it("only what was spent: B has no tabs and C no second column", () => {
    const b = document.createElement("div");
    b.append(...resultView("B", PLAIN).middle);
    expect(b.querySelector(".arv-tabs")).toBeNull();
    expect(b.textContent).toContain("Spent");
    expect(resultView("C", PLAIN).wide).toBe(false);
    expect(resultView("C", BUSY).wide).toBe(true);
  });

  it("B's second tab is Army, with no count that reads as the army's size", () => {
    const b = document.createElement("div");
    b.append(...resultView("B", BUSY).middle);
    expect([...b.querySelectorAll(".arv-tab")].map((one) => one.textContent)).toEqual(["Loot", "Army"]);
  });

  it("the damage bar names its 90% mark", () => {
    expect(resultView("A", BUSY).head.querySelector(".arv-damage__ninety")?.textContent).toBe("90%");
  });
});

describe("the flow with a look chosen", () => {
  const calls = (result: AutoAttackResponse): AutoAttackCalls => ({
    plan: vi.fn(async () => ({}) as AutoAttackPlanResponse),
    run: vi.fn(async () => result),
    replay: vi.fn(async () => ({ error: 0, replay: null })),
    quote: vi.fn(
      async () => ({ error: 0, baseid: BASEID, eligible: true, resources: 450_000, shiny: 965, welcome: true, now: 0 }) as never,
    ),
    takeOver: vi.fn(async () => ({})),
  });
  const answer: AutoAttackPlanResponse = {
    error: 0,
    baseid: BASEID,
    plan: PLAN,
    missing: [],
    outOfRange: false,
    underAttack: false,
    damage: 0,
  };

  it.each(LAYOUTS)("%s: Watch and Close sit outside the scrolling middle; the compact offer is in it", async (layout) => {
    window.localStorage.setItem("bymr.arp", layout);
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls(BUSY) });
    await flow.start(answer);
    [...modal.querySelectorAll("button")].find((one) => one.textContent === "Attack now")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const panel = modal.querySelector(`.auto-attack--rv-${layout}`)!;
    expect(panel).not.toBeNull();
    const middle = panel.querySelector(".arv-middle")!;
    const actions = panel.querySelector(".attack-end__actions")!;
    expect(middle.contains(actions)).toBe(false);
    expect([...actions.querySelectorAll("button")].map((one) => one.textContent)).toEqual(["Watch", "Close"]);
    const offer = middle.querySelector(".end-takeover--compact");
    expect(offer).not.toBeNull();
    expect(offer!.textContent).toContain("Claim as outpost");
    expect(offer!.textContent).toContain("450,000 each");
    expect(offer!.textContent).toContain("Frontier Pass");
    flow.close();
  });

  it("no look chosen: today's panel, unchanged", async () => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls(BUSY) });
    await flow.start(answer);
    [...modal.querySelectorAll("button")].find((one) => one.textContent === "Attack now")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modal.querySelector(".auto-attack--rv")).toBeNull();
    expect(modal.textContent).toContain("Damage added");
    flow.close();
  });
});
