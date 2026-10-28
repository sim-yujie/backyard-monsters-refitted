// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, ShopBuyReport, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { RepairActions, RepairInstantReport } from "@/api/yardRepair";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { durationText, protectionText, ShopScreen } from "./ShopScreen";

/**
 * The Shop screen as a player meets it (§8.2): the headed cards, the next
 * price, a running item's time left, a gate under a blocked button, the
 * tap-again purchase and its answer, the outpost list and Repair everything
 * now. The rows are `shop.test.ts`'s; this checks the drawing and the wiring.
 */

const T0 = 2_000_000;

const never = <R>() => new Promise<R>(() => undefined);

const setup = (
  extra: Partial<BaseLoadResponse> = {},
  kind: "main" | "outpost" | "inferno" = "main",
  api: Partial<YardApi> = {},
) => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      credits: 1_000,
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
      buildinghealthdata: {},
      storedata: {},
      lockerdata: {},
      ...extra,
    } as unknown as BaseLoadResponse,
    ...(kind === "main" ? {} : { target: { baseid: "9", kind } as const }),
    api: { state: vi.fn(() => never<YardResponse<null>>()), ...api } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const repair: RepairActions = {
    one: vi.fn(),
    all: vi.fn(),
    finish: vi.fn(),
    now: vi.fn(
      (): Promise<YardActionResult<RepairInstantReport>> =>
        Promise.resolve({ ok: true, report: { repaired: [1], credits: 12 }, completed: [] }),
    ),
  };
  const onClose = vi.fn();
  const screen = new ShopScreen({
    binding: { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices },
    repair,
    onClose,
  }).mount(document.body);
  screen.open();
  const card = (item: string) => screen.element.querySelector<HTMLElement>(`.shop-card[data-item="${item}"]`);
  const button = (item: string) => card(item)!.querySelector<HTMLButtonElement>(".shop-card__buy")!;
  return { screen, store, repair, onClose, card, button, element: screen.element };
};

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("ShopScreen", () => {
  it("lists every item under its heading with its next price", () => {
    const { element, card, button } = setup({ storedata: { BEW: { q: 1 } } });

    expect([...element.querySelectorAll(".shop-section__title")].map((one) => one.textContent)).toEqual([
      "Building",
      "Walls",
      "Storage and production",
      "Monsters",
      "Battle boosts",
      "Protection",
      "Coming later",
    ]);
    expect(
      [...element.querySelectorAll<HTMLElement>(".shop-card:not(.shop-card--later)")].map(
        (one) => one.dataset["item"],
      ),
    ).toEqual(["BEW", "BST", "BLK2", "BLK3", "BLK4", "BLK5", "BIP", "ENL", "POD", "CLOD", "HOD", "HOD2", "HOD3", "EXH", "TOD", "MOD", "MDOD", "MSOD", "PRO1", "PRO2", "PRO3"]);
    expect(card("BEW")!.querySelector(".shop-card__meta")!.textContent).toBe("1 of 4 bought");
    expect(button("BEW").getAttribute("aria-label")).toBe("Buy Extra Worker, 500 Shiny");
    expect(card("BST")!.querySelector(".shop-card__meta")!.textContent).toBe("Lasts 7 days");
    expect(spokenText(element.querySelector(".shop-screen__balance")!)).toContain("1,000");
  });

  it("shows a running item's time left and no button", () => {
    const { card, button } = setup({ storedata: { POD: { q: 1, s: T0, e: T0 + 2 * 3_600 + 5 * 60 } } });

    expect(card("POD")!.dataset["state"]).toBe("running");
    expect(card("POD")!.querySelector(".shop-card__meta")!.textContent).toBe("Running: 2h 5m left");
    expect(button("POD").hidden).toBe(true);
  });

  it("says sold out once every step is bought", () => {
    const { card, button } = setup({ storedata: { ENL: { q: 6 } } });

    expect(card("ENL")!.querySelector(".shop-card__meta")!.textContent).toBe("All 6 bought");
    expect(button("ENL").hidden).toBe(true);
  });

  it("says why a button is disabled", () => {
    const { card, button } = setup({ credits: 40 });

    expect(button("BST").disabled).toBe(true);
    expect(card("BST")!.querySelector(".shop-card__gate")!.textContent).toBe("Not enough Shiny.");
    expect(card("CLOD")!.querySelector(".shop-card__gate")!.textContent).toBe(
      "Only while a monster is unlocking.",
    );
    expect(button("HOD").disabled).toBe(false);
    expect(card("HOD")!.querySelector<HTMLElement>(".shop-card__gate")!.hidden).toBe(true);
  });

  it("buys on the second tap only and says what it cost", async () => {
    const { store, element, button } = setup();
    const buy = vi.spyOn(store, "buy").mockImplementation(
      (): Promise<YardActionResult<ShopBuyReport>> =>
        Promise.resolve({ ok: true, report: { item: "BIP", credits: 50, q: 1, endsAt: null }, completed: [] }),
    );

    button("BIP").click();
    expect(buy).not.toHaveBeenCalled();
    button("BIP").click();
    expect(buy).toHaveBeenCalledWith("BIP");
    await settle();
    expect(spokenText(element.querySelector(".shop-status")!)).toBe("Improved Packing bought: Shiny 50 spent.");
  });

  it("moves focus to the close button when the last step's button goes", async () => {
    const { store, element, button } = setup({ storedata: { ENL: { q: 5 } } });
    vi.spyOn(store, "buy").mockImplementation(async () => {
      store.mergeWrite({ storedata: { ENL: { q: 6 } } });
      return { ok: true, report: { item: "ENL", credits: 300, q: 6, endsAt: null }, completed: [] };
    });

    button("ENL").focus();
    button("ENL").click();
    button("ENL").click();
    // As a browser does when the button is disabled for the request.
    button("ENL").blur();
    await settle();
    expect(button("ENL").hidden).toBe(true);
    expect(document.activeElement).toBe(element.querySelector(".shop-screen__close"));
  });

  it("puts focus back on the button after a step that leaves more to buy", async () => {
    const { store, button } = setup();
    vi.spyOn(store, "buy").mockResolvedValue({
      ok: true,
      report: { item: "BIP", credits: 50, q: 1, endsAt: null },
      completed: [],
    });

    button("BIP").focus();
    button("BIP").click();
    button("BIP").click();
    button("BIP").blur();
    expect(document.activeElement).toBe(document.body);
    await settle();
    expect(document.activeElement).toBe(button("BIP"));
  });

  it("shows the server's refusal", async () => {
    const { store, element, button } = setup();
    vi.spyOn(store, "buy").mockResolvedValue({
      ok: false,
      refusal: { reason: "credits", message: "You do not have enough Shiny.", detail: {} },
    });

    button("POD").click();
    button("POD").click();
    await settle();
    const status = element.querySelector<HTMLElement>(".shop-status")!;
    expect(status.classList.contains("shop-status--bad")).toBe(true);
    expect(status.textContent).toBe("You do not have enough Shiny.");
  });

  it("an outpost shows only its own list", () => {
    const { element } = setup({}, "outpost");

    expect(
      [...element.querySelectorAll<HTMLElement>(".shop-card:not(.shop-card--later)")].map(
        (one) => one.dataset["item"],
      ),
    ).toEqual(["BST", "BLK2", "BLK3", "BLK4", "BLK5", "POD", "HOD", "HOD2", "HOD3", "EXH", "TOD"]);
    expect(element.querySelector('[data-section="protection"]')).toBeNull();
    expect(element.querySelector('[data-section="boosts"] .shop-section__note')!.textContent).toBe(
      "Tower Overdrive works when this outpost is attacked. Buying it again restarts it; time left is not added.",
    );
  });

  it("the Inferno yard shows the Inferno's store (WP 1.17) and buys through shop/buy with its baseid", async () => {
    const shopBuy = vi.fn(() => never<YardResponse<ShopBuyReport>>());
    const { element, card, button } = setup(
      {
        buildingdata: {
          "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
          "1": { id: 1, t: 17, X: 50, Y: 50, l: 1 },
        },
      },
      "inferno",
      { shopBuy },
    );

    expect(
      [...element.querySelectorAll(".shop-section__title")].map((one) => one.textContent),
    ).toEqual([
      "Building",
      "Walls",
      "Storage and production",
      "Monsters",
      "Battle boosts",
      "Protection",
    ]);
    expect(
      [...element.querySelectorAll<HTMLElement>(".shop-card")].map(
        (one) => one.dataset["item"],
      ),
    ).toEqual([
      "BEW",
      "BLK2I",
      "BLK3I",
      "ENLI",
      "BIP",
      "HODI",
      "HOD2I",
      "HOD3I",
      "EXHI",
      "TODI",
      "PRO1",
      "PRO2",
      "PRO3",
    ]);
    expect(card("BLK2I")!.querySelector(".shop-card__name")!.textContent).toBe(
      "Granite Blocks",
    );
    expect(card("BLK3I")!.querySelector(".shop-card__gate")!.textContent).toBe(
      "Needs Under Hall level 4.",
    );
    expect(
      element.querySelector('[data-section="walls"] .shop-section__note')!.textContent,
    ).toContain("granite");
    expect(
      element.querySelector('[data-section="protection"] .shop-section__note')!.textContent,
    ).toBe("Your Inferno yard is not protected. Protection you buy starts now.");
    expect(
      element.querySelector('[data-section="boosts"] .shop-section__note')!.textContent,
    ).toBe(
      "Tower Overdrive works when your Inferno yard is attacked. Buying it again restarts it; time left is not added.",
    );
    expect(card("ENLI")!.querySelector(".shop-card__meta")!.textContent).toBe("0 of 5 bought");

    button("ENLI").click();
    button("ENLI").click();
    await settle();
    expect(shopBuy).toHaveBeenCalledWith("ENLI", "9");
  });

  it("sells protection on top of what is left, and says how much is left", () => {
    const { element, card, button } = setup({
      credits: 2_000,
      protected: T0 + 2 * 86_400 + 3 * 3_600,
      storedata: { PRO1: { q: 1, s: T0 - 60, e: T0 + 2 * 86_400 + 3 * 3_600 } },
    });

    expect(element.querySelector('[data-section="protection"] .shop-section__note')!.textContent).toBe(
      "Your yard is protected for 2d 3h. Protection you buy is added on top.",
    );
    // A running PRO1 is still on sale: its time stacks.
    expect(card("PRO1")!.dataset["state"]).toBe("buy");
    expect(card("PRO1")!.querySelector(".shop-card__meta")!.textContent).toBe("Adds 24 hours");
    expect(button("PRO3").getAttribute("aria-label")).toBe("Buy Ultimate Protection, 1,100 Shiny");
  });

  it("keeps a running boost on sale, glowing, with its time left", () => {
    const { card, button } = setup({ storedata: { MOD: { q: 1, s: T0 - 60, e: T0 + 5 * 3_600 + 30 * 60 } } });

    expect(card("MOD")!.dataset["state"]).toBe("buy");
    expect(card("MOD")!.querySelector(".shop-card__meta")!.textContent).toBe(
      "Running: 5h 30m left. Buy again to restart at 24 hours",
    );
    expect(card("MOD")!.classList.contains("shop-card--boosted")).toBe(true);
    expect(button("MOD").hidden).toBe(false);
    expect(button("MOD").disabled).toBe(false);
    expect(card("TOD")!.classList.contains("shop-card--boosted")).toBe(false);
    expect(card("TOD")!.querySelector(".shop-card__meta")!.textContent).toBe("Lasts 24 hours");
  });

  it("says under Battle boosts where they work and that they restart", () => {
    const { element } = setup();

    expect(element.querySelector('[data-section="boosts"] .shop-section__note')!.textContent).toBe(
      "Monster boosts work in your attacks and when your yard is attacked. Buying one again restarts it; time left is not added.",
    );
  });

  it("lists the held-back items as coming later, with no price and no button", () => {
    const { element } = setup();
    const later = [...element.querySelectorAll<HTMLElement>(".shop-card--later")];

    expect(later.map((one) => one.querySelector(".shop-card__name")!.textContent)).toEqual(["Shiny Decorations"]);
    for (const one of later) {
      expect(one.querySelector("button")).toBeNull();
      expect(one.querySelector(".shop-card__meta")!.textContent).toBe("Coming later");
    }
  });

  it("sells the wall upgrades under Walls, priced from the yard's Blocks", async () => {
    const { store, element, card, button } = setup({
      buildingdata: {
        "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
        "1": { id: 1, t: 17, X: 100, Y: 100, l: 1 },
        "2": { id: 2, t: 17, X: 110, Y: 100, l: 2 },
      },
    });

    expect(element.querySelector('[data-section="walls"] .shop-section__note')!.textContent).toContain(
      "3 Shiny to reach stone",
    );
    // Stone: only the level-1 Block, 3 Shiny.
    expect(card("BLK2")!.querySelector(".shop-card__meta")!.textContent).toBe("1 Block to raise");
    expect(button("BLK2").getAttribute("aria-label")).toBe("Buy Stone Blocks, 3 Shiny");
    // Metal: 3 + 6 for the first, 6 for the second; Town Hall 3 is short of 4.
    expect(card("BLK3")!.querySelector(".shop-card__meta")!.textContent).toBe("2 Blocks to raise");
    expect(button("BLK3").disabled).toBe(true);
    expect(card("BLK3")!.querySelector(".shop-card__gate")!.textContent).toBe("Needs Town Hall level 4.");

    const buy = vi.spyOn(store, "buy").mockImplementation(
      (): Promise<YardActionResult<ShopBuyReport>> =>
        Promise.resolve({
          ok: true,
          report: { item: "BLK2", credits: 3, q: 0, endsAt: null, tier: 2, blocks: 1, points: 10 },
          completed: [],
        }),
    );
    button("BLK2").click();
    button("BLK2").click();
    expect(buy).toHaveBeenCalledWith("BLK2");
    await settle();
    expect(spokenText(element.querySelector(".shop-status")!)).toBe("Stone Blocks: 1 Block raised, Shiny 3 spent.");
  });

  it("hides a wall upgrade's button once every Block has reached it", () => {
    const { card, button } = setup({
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 }, "1": { id: 1, t: 17, X: 100, Y: 100, l: 3 } },
    });

    expect(card("BLK2")!.dataset["state"]).toBe("reached");
    expect(card("BLK2")!.querySelector(".shop-card__meta")!.textContent).toBe(
      "Already reached: every Block is stone or better.",
    );
    expect(button("BLK2").hidden).toBe(true);
    expect(button("BLK3").hidden).toBe(true);
    expect(button("BLK4").hidden).toBe(false);
  });

  it("offers Repair everything now while something is damaged, through repair/instant", async () => {
    const { element, card, button, repair } = setup({
      buildingdata: {
        "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
        "1": { id: 1, t: 20, X: 100, Y: 100, l: 1 },
      },
      buildinghealthdata: { "1": 1 },
    });

    expect(element.querySelector("#shop-section-repairs")!.textContent).toBe("Repairs");
    expect(card("FIX")!.querySelector(".shop-card__meta")!.textContent).toBe("1 damaged building");
    button("FIX").click();
    button("FIX").click();
    expect(repair.now).toHaveBeenCalledOnce();
    await settle();
    expect(spokenText(element.querySelector(".shop-status")!)).toBe("1 building repaired: Shiny 12 spent.");
  });

  it("has no Repairs section when nothing is damaged", () => {
    const { element } = setup();
    expect(element.querySelector("#shop-section-repairs")).toBeNull();
  });

  it("closes on Escape and on its close button", () => {
    const { screen, onClose, element } = setup();

    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(screen.isOpen).toBe(false);
    expect(element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();

    screen.open();
    element.querySelector<HTMLButtonElement>(".shop-screen__close")!.click();
    expect(screen.isOpen).toBe(false);
  });
});

describe("protectionText", () => {
  it("says whether the yard is protected", () => {
    expect(protectionText(null, T0)).toBe("Your yard is not protected. Protection you buy starts now.");
    expect(protectionText(T0 + 7 * 86_400, T0)).toBe(
      "Your yard is protected for 7d 0h. Protection you buy is added on top.",
    );
  });
});

describe("durationText", () => {
  it("spells a store duration", () => {
    expect(durationText(3_600)).toBe("1 hour");
    expect(durationText(4 * 3_600)).toBe("4 hours");
    expect(durationText(86_400)).toBe("24 hours");
    expect(durationText(7 * 86_400)).toBe("7 days");
  });
});
