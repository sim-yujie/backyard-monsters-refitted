// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AutoAttackPlanResponse, AutoAttackResponse, PlanSummary } from "@/api/autoAttack";
import { AutoAttackFlow, type AutoAttackCalls } from "./AutoAttackFlow";
import { resultView } from "./autoAttackResultView";

/**
 * The Repeat attack's result (owner, 16 Nov 2026: "I just want to know the
 * loot, and resource needed to take over"): the camp and whether it was won,
 * the loot, the take-over price with Take over, Watch and Close. Nothing
 * about the army, the champion, the moves, the deal or the rules.
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

const all = (view: ReturnType<typeof resultView>): string =>
  [view.head, view.loot].map((node) => node.textContent ?? "").join(" | ");

describe("the parts", () => {
  it("a conquered camp: its name and level, Victory!, the damage, the loot, a place for the offer", () => {
    const view = resultView(BUSY);
    expect(view.head.textContent).toContain("Legionnaire · Level 33");
    expect(view.head.textContent).toContain("Victory!");
    expect(view.head.querySelector('[aria-label="Camp damage: 94%"]')).not.toBeNull();
    expect(view.loot.querySelectorAll(".arv-loot__item")).toHaveLength(4);
    expect(view.loot.querySelectorAll(".arv-loot__item--none")).toHaveLength(2);
    expect(view.loot.textContent).toContain("+100,000");
    expect(view.loot.textContent).toContain("Storage full");
    expect(view.offerHost).not.toBeNull();
  });

  it("a camp still standing: Not won and its damage, no offer", () => {
    const view = resultView(PLAIN);
    expect(view.head.textContent).toContain("Not won");
    expect(view.head.textContent).toContain("13%");
    expect(view.head.textContent).not.toContain("Victory!");
    expect(view.offerHost).toBeNull();
    expect(view.loot.textContent).not.toContain("Storage full");
    expect(view.loot.textContent).not.toContain("Low damage");
  });

  it("an attack that stopped working says so under the loot", () => {
    expect(resultView(STALLED).loot.textContent).toContain("Low damage. Attack by hand to try new drop points.");
  });

  it("shows nothing about the army, the champion, the moves or the bombs (owner, 16 Nov 2026)", () => {
    const shown = all(resultView(BUSY));
    for (const gone of ["Used", "Ichi", "Fomor", "health", "Moved", "bomb", "Battle details", "Army", "Terms"]) {
      expect(shown).not.toContain(gone);
    }
    const view = resultView(BUSY);
    expect(view.head.querySelector("details")).toBeNull();
    expect(view.loot.querySelector("details, img.arv-portrait, .arv-unit")).toBeNull();
  });
});

describe("the flow's result", () => {
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

  const attack = async (result: AutoAttackResponse): Promise<{ modal: HTMLElement; flow: AutoAttackFlow }> => {
    const modal = document.createElement("div");
    const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: vi.fn(), calls: calls(result) });
    await flow.start(answer);
    [...modal.querySelectorAll("button")].find((one) => one.textContent === "Attack now")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { modal, flow };
  };

  it("conquered: the price as icons and Take over, outside the loot; Watch and Close under them", async () => {
    const { modal, flow } = await attack(BUSY);
    const panel = modal.querySelector(".auto-attack--result")!;
    expect(panel.querySelector(".panel__title")?.textContent).toBe("Attack result");
    const middle = panel.querySelector(".arv-middle")!;
    const actions = panel.querySelector(".attack-end__actions")!;
    const offer = panel.querySelector(".end-takeover--compact")!;
    expect(offer).not.toBeNull();
    expect(middle.contains(offer)).toBe(false);
    expect(middle.contains(actions)).toBe(false);
    expect(offer.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(offer.textContent).toContain("Take-over cost");
    expect(offer.textContent).toContain("450,000 each");
    expect(offer.textContent).toContain("965");
    // The owner does not need to know a Frontier Pass applied, nor any rules.
    expect(offer.textContent).not.toContain("Frontier");
    expect(offer.textContent).not.toContain("Terms");
    expect(offer.querySelector("details")).toBeNull();
    const take = offer.querySelector<HTMLButtonElement>(".end-takeover__take")!;
    expect(take.textContent).toBe("Take over");
    expect(take.disabled).toBe(false);
    expect([...actions.querySelectorAll("button")].map((one) => one.textContent)).toEqual(["Watch", "Close"]);
    // Take over is the main action; Close is named for the layout check.
    expect(actions.querySelector(".btn--primary")).toBeNull();
    expect(actions.querySelector('button[aria-label="Close"]')).not.toBeNull();
    for (const gone of ["Used", "Fomor", "health left", "Moved", "Bombs", "Damage added", "Battle details"]) {
      expect(panel.textContent).not.toContain(gone);
    }
    flow.close();
  });

  it("not won: no offer, Close is the main action", async () => {
    const { modal, flow } = await attack(PLAIN);
    const panel = modal.querySelector(".auto-attack--result")!;
    expect(panel.querySelector(".end-takeover")).toBeNull();
    expect(panel.textContent).toContain("Not won");
    expect(panel.querySelector(".attack-end__actions .btn--primary")?.textContent).toBe("Close");
    flow.close();
  });
});
