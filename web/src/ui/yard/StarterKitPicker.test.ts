// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, Resources } from "@/api/types";
import type { StarterKitActions, StarterKitReport } from "@/api/yardStarterKit";
import { kitTopUpShiny } from "@/game/yard/starterKits";
import { readYard } from "@/game/yard/yardModel";
import type { YardListener, YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { Notices } from "@/ui/maproom/Notices";
import { contentLines, KIT_WARNING, shortfallText, StarterKitPicker } from "./StarterKitPicker";

/**
 * The Starter Kit picker (outposts WP9, #188): three cards, a confirmation
 * that is the only place money moves, the wipe warning, the top-up offer.
 */

const CORE_ONLY = { "1": { X: 0, Y: -50, id: 1, t: 112, l: 1 } };

const bindingWith = (
  resources: Resources,
  credits: number,
  buildingdata: BaseLoadResponse["buildingdata"] = CORE_ONLY,
): YardUiBinding => {
  const save = {
    error: 0,
    id: 1,
    baseid: "9",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1,
    savetime: 1,
    type: "outpost",
    buildingdata,
  } as BaseLoadResponse;
  const listeners = new Set<YardListener>();
  const store = {
    kind: "outpost",
    resources,
    credits,
    save,
    yard: readYard(save),
    isRunning: () => false,
    subscribe: (listener: YardListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { store: store as unknown as YardStore, scene: { selectBuilding: () => {} }, notices: new Notices() };
};

const RICH = { r1: 300_000_000, r2: 300_000_000, r3: 300_000_000, r4: 0 };

const report = (pay: "resources" | "shiny"): StarterKitReport => ({
  kit: 1,
  pay,
  placed: 112,
  removed: 0,
  cost: { r1: 0, r2: 0, r3: 0, r4: 0 },
  shiny: 0,
  doneBy: 0,
});

describe("StarterKitPicker", () => {
  let picker: StarterKitPicker | null = null;
  let buy: ReturnType<typeof vi.fn>;
  let actions: StarterKitActions;

  beforeEach(() => {
    document.body.replaceChildren();
    buy = vi.fn(() => Promise.resolve({ ok: true, report: report("resources"), completed: [] }));
    actions = { buy } as unknown as StarterKitActions;
  });

  afterEach(() => {
    picker?.close();
    picker = null;
  });

  const open = (binding: YardUiBinding, onBought = vi.fn()) => {
    picker = new StarterKitPicker({ binding, actions, onBought }).mount(document.body);
    return onBought;
  };
  const cards = () => [...document.querySelectorAll<HTMLElement>(".kit-card")];
  const card = (id: number) => document.querySelector<HTMLElement>(`.kit-card[data-kit="${id}"]`)!;
  const confirm = () => document.querySelector<HTMLElement>(".kit-picker__confirm")!;
  const go = () => document.querySelector<HTMLButtonElement>(".kit-picker__go")!;

  it("shows three cards: thumbnail, name, contents, price and both payments", () => {
    open(bindingWith(RICH, 5_000));
    expect(cards().map((one) => one.querySelector("h3")!.textContent)).toEqual([
      "Regular Kit",
      "Mega Kit",
      "Ultra Kit",
    ]);
    expect(cards().map((one) => one.querySelector("img")!.getAttribute("src"))).toEqual([
      "/assets/ui/prefab-2.v5.jpg",
      "/assets/ui/prefab-3.v5.jpg",
      "/assets/ui/prefab-4.v5.jpg",
    ]);
    expect(card(1).textContent).toContain("3× Sniper Tower L5");
    expect(card(1).querySelector(".kit-card__shiny")!.getAttribute("aria-label")).toBe("Use 420 Shiny");
    expect(confirm().hidden).toBe(true);
  });

  it("spends nothing on a card's press: a confirmation says what happens first", async () => {
    const onBought = open(bindingWith(RICH, 5_000));
    card(1).querySelector<HTMLButtonElement>(".kit-card__resources")!.click();
    expect(buy).not.toHaveBeenCalled();
    expect(confirm().hidden).toBe(false);
    expect(confirm().textContent).toContain("build up over time, without your worker");
    expect(confirm().textContent).not.toContain(KIT_WARNING);

    go().click();
    await vi.waitFor(() => expect(onBought).toHaveBeenCalled());
    expect(buy).toHaveBeenCalledWith(1, "resources", undefined);
    expect(picker!.isOpen).toBe(false);
  });

  it("warns that the kit replaces the buildings when the yard holds more than its core", () => {
    open(bindingWith(RICH, 5_000, { ...CORE_ONLY, "2": { X: 100, Y: 0, id: 2, t: 20 } }));
    picker!.choose(2, "shiny");
    expect(confirm().textContent).toContain(KIT_WARNING);
  });

  it("offers the Shiny top-up for a short pool, in Flash's words", async () => {
    const short = { r1: 11_000_000, r2: 12_000_000, r3: 5_500_000, r4: 0 };
    open(bindingWith(short, 5_000));
    picker!.choose(1, "resources");
    const topUp = kitTopUpShiny(1_500_000);
    expect(confirm().textContent).toContain(`You need an extra ${shortfallText({ r1: 1_000_000, r2: 0, r3: 500_000 })}`);
    expect(go().textContent).toBe(`Use ${topUp} Shiny`);

    go().click();
    await vi.waitFor(() => expect(buy).toHaveBeenCalledWith(1, "resources", topUp));
  });

  it("will not spend Shiny the player does not have", () => {
    open(bindingWith(RICH, 100));
    picker!.choose(3, "shiny");
    expect(go().disabled).toBe(true);
    expect(confirm().textContent).toContain("You need 1,400 more Shiny.");
  });

  it("stays open with the server's reason when the kit is refused", async () => {
    buy.mockResolvedValueOnce({
      ok: false,
      refusal: { reason: "monsters", message: "Move the monsters out of this outpost first.", detail: {} },
    });
    open(bindingWith(RICH, 5_000));
    picker!.choose(1, "shiny");
    go().click();
    await vi.waitFor(() =>
      expect(document.querySelector(".kit-picker__status")!.textContent).toBe(
        "Move the monsters out of this outpost first.",
      ),
    );
    expect(picker!.isOpen).toBe(true);
  });
});

describe("the card list", () => {
  it("merges one type's levels into one line", () => {
    expect(contentLines({ contents: [[17, 2, 24], [17, 3, 68], [21, 5, 3]] })).toEqual([
      "92× Block L2-3",
      "3× Sniper Tower L5",
    ]);
  });
});
