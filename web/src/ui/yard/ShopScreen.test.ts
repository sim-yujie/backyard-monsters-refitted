// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, ShopBuyReport, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { RepairActions, RepairInstantReport } from "@/api/yardRepair";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { durationText, ShopScreen } from "./ShopScreen";

/**
 * The Shop screen as a player meets it (§8.2): the headed cards, the next
 * price, a running item's time left, a gate under a blocked button, the
 * tap-again purchase and its answer, the outpost list and Repair everything
 * now. The rows are `shop.test.ts`'s; this checks the drawing and the wiring.
 */

const T0 = 2_000_000;

const never = <R>() => new Promise<R>(() => undefined);

const setup = (extra: Partial<BaseLoadResponse> = {}, kind: "main" | "outpost" = "main") => {
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
    ...(kind === "outpost" ? { target: { baseid: "9", kind: "outpost" } as const } : {}),
    api: { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const repair: RepairActions = {
    one: vi.fn(),
    all: vi.fn(),
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
      "Storage and production",
      "Monsters",
    ]);
    expect(
      [...element.querySelectorAll<HTMLElement>(".shop-card")].map((one) => one.dataset["item"]),
    ).toEqual(["BEW", "BST", "BIP", "ENL", "POD", "CLOD", "HOD", "HOD2", "HOD3", "EXH"]);
    expect(card("BEW")!.querySelector(".shop-card__meta")!.textContent).toBe("1 of 4 bought");
    expect(spokenText(button("BEW"))).toContain("500");
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
      [...element.querySelectorAll<HTMLElement>(".shop-card")].map((one) => one.dataset["item"]),
    ).toEqual(["BST", "POD", "HOD", "HOD2", "HOD3", "EXH"]);
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

describe("durationText", () => {
  it("spells a store duration", () => {
    expect(durationText(3_600)).toBe("1 hour");
    expect(durationText(4 * 3_600)).toBe("4 hours");
    expect(durationText(86_400)).toBe("24 hours");
    expect(durationText(7 * 86_400)).toBe("7 days");
  });
});
