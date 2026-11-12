// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, Resources } from "@/api/types";
import type { StarterKitActions, StarterKitReport } from "@/api/yardStarterKit";
import { kitSummary, kitTopUpShiny } from "@/game/yard/starterKits";
import { setClassicLook } from "@/game/classicLook";
import { setCurrentAllianceBonuses } from "@/game/alliance/allianceBonuses";
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

  const open = (binding: YardUiBinding, onBought = vi.fn(), freeKit = async () => false) => {
    picker = new StarterKitPicker({ binding, actions, onBought, freeKit }).mount(document.body);
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
      "/assets/ui/kits/kit-regular-modern.webp?v=1",
      "/assets/ui/kits/kit-mega-modern.webp?v=1",
      "/assets/ui/kits/kit-ultra-modern.webp?v=1",
    ]);
    expect(card(1).textContent).toContain("3× Sniper Tower L5");
    expect(card(1).querySelector(".kit-card__shiny")!.getAttribute("aria-label")).toBe("Use 420 Shiny");
    expect(confirm().hidden).toBe(true);
  });

  it("shows the Classic pictures in Classic, and Flash's thumbnail when a picture is missing", () => {
    setClassicLook(true);
    try {
      open(bindingWith(RICH, 5_000));
      const pictures = cards().map((one) => one.querySelector("img")!);
      expect(pictures.map((img) => img.getAttribute("src"))).toEqual([
        "/assets/ui/kits/kit-regular-classic.webp?v=1",
        "/assets/ui/kits/kit-mega-classic.webp?v=1",
        "/assets/ui/kits/kit-ultra-classic.webp?v=1",
      ]);
      pictures[2]!.dispatchEvent(new Event("error"));
      expect(pictures[2]!.getAttribute("src")).toBe("/assets/ui/prefab-4.v5.jpg");
      expect(pictures[0]!.getAttribute("src")).toBe("/assets/ui/kits/kit-regular-classic.webp?v=1");
    } finally {
      setClassicLook(false);
    }
  });

  describe("the alliance's Starter Kit price (beta 7)", () => {
    afterEach(() => setCurrentAllianceBonuses(null));

    it("no alliance, or 0%: no tag and no struck-through price", () => {
      open(bindingWith(RICH, 5_000));
      expect(document.querySelector(".kit-card__alliance-tag")).toBeNull();
      expect(document.querySelector(".kit-card__usual")).toBeNull();
    });

    it("a discount: the shield and -10% on every card, the usual price struck through", () => {
      setCurrentAllianceBonuses({ bonuses: { kitCost: -10 } });
      open(bindingWith(RICH, 5_000));
      const tags = cards().map((one) => one.querySelector(".kit-card__alliance-tag"));
      expect(tags.every((tag) => tag?.textContent === "−10%")).toBe(true);
      expect(tags[0]!.classList.contains("kit-card__alliance-tag--cheaper")).toBe(true);
      expect(tags[0]!.querySelector("img.game-icon--alliance")).not.toBeNull();
      const usual = card(1).querySelector(".kit-card__usual")!;
      expect(usual.textContent).not.toBe("");
      // The card's own price is the alliance's, below the usual one.
      const regular = kitSummary(1)!;
      expect(card(1).querySelector(".kit-card__price")!.textContent).not.toBe(usual.textContent);
      expect(regular.resources.r1).toBeGreaterThan(0);
    });

    it("a dearer kit says so: +5%", () => {
      setCurrentAllianceBonuses({ bonuses: { kitCost: 5 } });
      open(bindingWith(RICH, 5_000));
      const tag = card(2).querySelector(".kit-card__alliance-tag")!;
      expect(tag.textContent).toBe("+5%");
      expect(tag.classList.contains("kit-card__alliance-tag--dearer")).toBe(true);
      expect(tag.getAttribute("title")).toBe("Your alliance: Starter Kits cost 5% more in resources.");
    });
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

  describe("New to Map Room 2: the free Regular kit", () => {
    const openFree = async (resources: Resources = RICH) => {
      const onBought = open(bindingWith(resources, 0), vi.fn(), async () => true);
      await vi.waitFor(() => expect(picker!.showsFreeKit).toBe(true));
      return onBought;
    };

    it("the Regular card says Free with the small label and one Free button; the others are priced", async () => {
      await openFree();
      expect(card(1).classList.contains("kit-card--free")).toBe(true);
      expect(card(1).querySelector(".kit-card__free-tag")!.textContent).toBe("Free");
      expect(card(1).querySelector(".kit-card__free-label")!.textContent).toBe("Frontier Pass");
      expect(card(1).querySelector(".kit-card__free")!.textContent).toBe("Free");
      expect(card(1).querySelector(".kit-card__shiny")).toBeNull();
      expect(card(2).querySelector(".kit-card__free")).toBeNull();
      expect(card(2).querySelector(".kit-card__shiny")).not.toBeNull();
    });

    it("free even with an empty pool and no Shiny: the confirmation builds it free", async () => {
      const onBought = await openFree({ r1: 0, r2: 0, r3: 0, r4: 0 });
      card(1).querySelector<HTMLButtonElement>(".kit-card__free")!.click();
      expect(confirm().textContent).toContain("Free: Frontier Pass.");
      expect(confirm().textContent).toContain("without your worker");
      expect(go().textContent).toBe("Build it free");
      expect(go().disabled).toBe(false);
      go().click();
      await vi.waitFor(() => expect(onBought).toHaveBeenCalled());
      expect(buy).toHaveBeenCalledWith(1, "resources", undefined, true);
    });

    it("refused as no longer free: the prices come back", async () => {
      buy.mockResolvedValueOnce({
        ok: false,
        refusal: { reason: "welcomeUsed", message: "The free Regular Starter Kit is no longer available.", detail: {} },
      });
      await openFree();
      picker!.choose(1, "resources");
      go().click();
      await vi.waitFor(() => expect(picker!.showsFreeKit).toBe(false));
      expect(card(1).querySelector(".kit-card__free")).toBeNull();
      expect(card(1).querySelector(".kit-card__shiny")).not.toBeNull();
    });

    it("not shown when the free kit is not ready", () => {
      open(bindingWith(RICH, 5_000));
      expect(document.querySelector(".kit-card--free")).toBeNull();
    });
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
