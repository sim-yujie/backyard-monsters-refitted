// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, ChampionSaveEntry, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { ChampionActions } from "@/api/yardChampion";
import { YardStore } from "@/game/yard/YardStore";
import { ChampionPanel, feedGate, hungerText } from "./ChampionPanel";
import { cageView } from "@/game/yard/championModel";

/**
 * The Champion Cage's controls as a player meets them: the raise cards, the
 * champion's health, growth and hunger in plain words, the feed recipe and
 * its buttons, rename and juice behind a confirmation. The rules are
 * `game/yard/championModel.test.ts`'s; this checks the drawing and the wiring.
 */

const T0 = 2_000_000;
const HOUR = 3_600;

const CAGE: BuildingData = { id: 3, t: 114, l: 1, X: 0, Y: 0 };
const JUICER: BuildingData = { id: 9, t: 9, l: 1, X: 200, Y: 0 };

const gorgo = (overrides: Partial<ChampionSaveEntry> = {}): ChampionSaveEntry => ({
  t: 1,
  hp: 40_000,
  l: 1,
  ft: T0 + 14 * HOUR,
  fd: 1,
  fb: 0,
  pl: 1,
  status: 0,
  ...overrides,
});

const loadOf = (champion: ChampionSaveEntry[], buildings: BuildingData[] = [CAGE]): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    credits: 500,
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: {},
    storedata: {},
    monsters: { housed: { C2: 40 } },
    lockerdata: {},
    academy: {},
    champion,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);

const setup = (
  champion: ChampionSaveEntry[],
  buildings?: BuildingData[],
  actions: Partial<ChampionActions> = {},
) => {
  const api = { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi;
  const store = new YardStore({
    save: loadOf(champion, buildings),
    api,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const spies = {
    raise: vi.fn(actions.raise ?? (() => never())),
    cancelEgg: vi.fn(actions.cancelEgg ?? (() => never())),
    feed: vi.fn(actions.feed ?? (() => never())),
    evolve: vi.fn(actions.evolve ?? (() => never())),
    heal: vi.fn(actions.heal ?? (() => never())),
    rename: vi.fn(actions.rename ?? (() => never())),
    juice: vi.fn(actions.juice ?? (() => never())),
    freeze: vi.fn(actions.freeze ?? (() => never())),
    thaw: vi.fn(actions.thaw ?? (() => never())),
    healSpecial: vi.fn(actions.healSpecial ?? (() => never())),
    freezeSpecial: vi.fn(actions.freezeSpecial ?? (() => never())),
  };
  const panel = new ChampionPanel({ store, actions: spies as ChampionActions });
  document.body.replaceChildren(panel.element);
  panel.show();
  return { panel, store, spies, element: panel.element };
};

afterEach(() => {
  document.body.replaceChildren();
});

const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.startsWith(text));
const textOf = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent ?? "";

describe("ChampionPanel: no champion", () => {
  it("offers Gorgo, Drull and Fomor, each with its own art and a Raise", () => {
    const { element, spies } = setup([]);
    const cards = [...element.querySelectorAll<HTMLElement>(".champion-card")];
    expect(cards.map((card) => card.dataset["champion"])).toEqual(["G1", "G2", "G3"]);
    expect(cards[1]!.querySelector("img")!.getAttribute("src")).toBe("/portraits/G2-L1.webp");
    buttonNamed(element, "Raise Drull")!.click();
    expect(spies.raise).toHaveBeenCalledWith(2);
  });

  it("says each one hatches in 1 day", () => {
    const { element } = setup([]);
    expect(element.textContent).toContain("lays an egg that hatches in 1 day");
    expect(textOf(element, ".champion-card__hatch")).toBe("Hatches in 1 day");
  });

  it("says a frozen champion must be thawed instead", () => {
    const { element } = setup([gorgo({ status: 1, ft: HOUR })]);
    expect(buttonNamed(element, "Raise Gorgo")).toBeUndefined();
    expect(textOf(element, ".champion-card .champion__gate")).toContain("frozen in the Champion Chamber");
  });

  it("says so while the cage is being built", () => {
    const { element } = setup([], [{ ...CAGE, l: 0, cB: 500 }]);
    expect(element.textContent).toContain("once it is built");
  });
});

describe("ChampionPanel: an egg", () => {
  const egg = (left: number) => gorgo({ t: 2, status: 3, ft: T0 + left });

  it("shows the egg and the time to hatching, and none of a champion's buttons", () => {
    const { element } = setup([egg(23 * HOUR + 12 * 60 + 5)], [CAGE, JUICER]);
    expect(textOf(element, ".champion__name")).toBe("Drull egg");
    expect(textOf(element, ".champion__egg-time")).toBe("Hatches in 23h 12m");
    expect(element.querySelector(".champion__egg-picture")!.getAttribute("src")).toBe("/eggs/G2-egg.webp");
    for (const name of ["Feed", "Heal", "Evolve", "Juice", "Freeze", "Rename", "Raise"]) {
      expect(buttonNamed(element, name)).toBeUndefined();
    }
  });

  it("cancels only after the confirmation, and Keep it goes back", () => {
    const { element, spies } = setup([egg(HOUR)]);
    buttonNamed(element, "Cancel egg")!.click();
    expect(textOf(element, ".champion__question")).toBe(
      "Cancel the egg? You can pick again, but the new egg takes a full day.",
    );
    buttonNamed(element, "Keep it")!.click();
    expect(spies.cancelEgg).not.toHaveBeenCalled();
    buttonNamed(element, "Cancel egg")!.click();
    buttonNamed(element, "Yes, cancel the egg")!.click();
    expect(spies.cancelEgg).toHaveBeenCalledTimes(1);
  });

  it("says Hatching… at 0 and asks the server once", () => {
    const { element, panel, store } = setup([egg(0)]);
    const refresh = vi.spyOn(store, "refresh").mockResolvedValue(undefined as never);
    expect(textOf(element, ".champion__egg-time")).toBe("Hatching…");
    panel.tick();
    panel.tick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("ChampionPanel: whose health each number is", () => {
  it("names the champion's live health and calls the card's figure its max health", () => {
    // Level 1 Gorgo, hurt: the live line is its own, the card's 40,000 → 80,000 its full health now and at level 2.
    const { element } = setup([gorgo({ hp: 1_200, nm: "Gorgy" })]);
    // The heart says whose health it is, for hover and screen readers; the line shows the numbers.
    const line = element.querySelector(".champion__line--health")!;
    expect(line.querySelector(".game-icon--health")!.getAttribute("aria-label")).toBe("Gorgy's health");
    expect(textOf(element, ".champion__line--health strong")).toBe("1,200 / 40,000");
    expect(element.querySelector(".champion__bar--health")!.getAttribute("aria-label")).toBe("Gorgy's health");
    const stats = [...element.querySelectorAll<HTMLElement>(".champion__stat")].map((item) => item.title);
    expect(stats).toContain("Max health 40,000 → 80,000");
    expect(stats.some((line) => line.startsWith("Health"))).toBe(false);
  });
});

describe("ChampionPanel: a fed champion", () => {
  it("shows name, level, health, feeds and the time to hunger", () => {
    const { element } = setup([gorgo({ hp: 20_000 })]);
    expect(textOf(element, ".champion__name")).toBe("Gorgo");
    expect(textOf(element, ".champion__level")).toBe("Level 1 of 6 · High Defense");
    expect(element.querySelector(".champion__picture")!.getAttribute("src")).toBe("/portraits/G1-L1.webp");
    expect(textOf(element, ".champion__line--health")).toContain("20,000 / 40,000");
    expect(element.textContent).toContain("Feeds 1 / 3 to level 2");
    expect(textOf(element, ".champion__hunger").trim()).toBe("Fed. Hungry in 14h 0m.");
  });

  it("Feed now waits for hunger; Evolve now is on offer at the doubled price", () => {
    const { element } = setup([gorgo()]);
    const feed = buttonNamed(element, "Feed now")!;
    expect(feed.disabled).toBe(true);
    // The hunger clock already says when: the reason is on hover, not another line.
    expect(feed.title).toContain("Not hungry yet.");
    expect(element.textContent).not.toContain("Not hungry yet.");
    expect(buttonNamed(element, "Feed with Shiny")).toBeUndefined();
    expect(buttonNamed(element, "Evolve now")!.textContent).toContain("104");
  });

  it("shows the new level's picture as soon as Evolve now is done (#311)", async () => {
    const evolved = gorgo({ l: 2, fd: 0 });
    const cage = setup([gorgo()], undefined, {
      evolve: async () => {
        cage.store.mergeWrite({ champion: [evolved] });
        return { ok: true, report: { champion: evolved, credits: 104 }, completed: [] };
      },
    });
    const picture = () => cage.element.querySelector(".champion__picture")!.getAttribute("src");
    expect(picture()).toBe("/portraits/G1-L1.webp");
    const evolve = buttonNamed(cage.element, "Evolve now")!;
    evolve.click();
    evolve.click();
    await vi.waitFor(() => expect(cage.spies.evolve).toHaveBeenCalled());
    await vi.waitFor(() => expect(picture()).toBe("/portraits/G1-L2.webp"));
    expect(textOf(cage.element, ".champion__level")).toContain("Level 2 of 6");
  });

  it("Heal is two taps and hidden at full health", () => {
    const hurt = setup([gorgo({ hp: 20_000 })]);
    const heal = buttonNamed(hurt.element, "Heal now")!;
    expect(heal.hidden).toBe(false);
    heal.click();
    expect(hurt.spies.heal).not.toHaveBeenCalled();
    heal.click();
    expect(hurt.spies.heal).toHaveBeenCalledTimes(1);
    const full = setup([gorgo()]);
    expect(buttonNamed(full.element, "Heal now")!.hidden).toBe(true);
  });
});

describe("ChampionPanel: how it fights (#219)", () => {
  const tendencies = (root: HTMLElement) =>
    [...root.querySelectorAll(".champion__tendency")].map((one) => one.textContent);

  it("says a champion with no brain yet is still learning", () => {
    const { element } = setup([gorgo()]);
    expect(textOf(element, ".champion__part--brain .champion__heading")).toBe("How it fights");
    expect(tendencies(element)).toEqual(["Still learning"]);
    expect(element.querySelector(".champion__tendency--learning")).not.toBeNull();
    expect(textOf(element, ".champion__part--brain .champion__note")).toContain(
      "It learns from every attack it fights in.",
    );
  });

  it("names what its attacks taught it, strongest first, and how many it learned from", () => {
    const { element } = setup([
      gorgo({ b: { tower: 0, loot: 140, finish: 0, focus: 70, threat: 95 }, bs: { n: 18, hyb: 0.6 } }),
    ]);
    expect(tendencies(element)).toEqual(["Loves loot", "Cautious near towers", "Sticks with the pack"]);
    expect(element.querySelector(".champion__tendency--learning")).toBeNull();
    expect(textOf(element, ".champion__part--brain .champion__note")).toContain("Learned from 18 attacks.");
  });

  it("has no reset", () => {
    const { element } = setup([gorgo({ b: { loot: 140 }, bs: { n: 3 } })]);
    const block = element.querySelector<HTMLElement>(".champion__part--brain")!;
    expect(block.querySelector("button")).toBeNull();
  });
});

describe("ChampionPanel: a hungry champion", () => {
  it("says it is hungry and when it starves, and feeds from housing", () => {
    const { element, spies } = setup([gorgo({ ft: T0 - HOUR })]);
    expect(textOf(element, ".champion__hunger").trim()).toBe("Hungry! Feed it within 23h 0m or it loses a feed.");
    expect(element.querySelector(".champion__hunger--hungry")).not.toBeNull();
    expect(textOf(element, ".champion__recipe")).toBe("15 Octo-oozeyou have 40");
    const feed = buttonNamed(element, "Feed now")!;
    expect(feed.disabled).toBe(false);
    feed.click();
    expect(spies.feed).toHaveBeenCalledWith("monsters");
    expect(buttonNamed(element, "Feed with Shiny")!.textContent).toContain("26");
  });

  it("names the monster that is short", () => {
    const { element } = setup([gorgo({ ft: T0 - HOUR, l: 2 })]);
    // Level 2 Gorgo eats 10 Octo-ooze and 5 Wormzer; housing has no Wormzer.
    expect(buttonNamed(element, "Feed now")!.disabled).toBe(true);
    expect(element.textContent).toMatch(/Not enough \w+: you have 0 of 5/);
  });
});

describe("ChampionPanel: rename and juice", () => {
  it("renames inline", () => {
    const { element, spies } = setup([gorgo()]);
    buttonNamed(element, "Rename")!.click();
    const input = element.querySelector<HTMLInputElement>(".champion__name-input")!;
    expect(input.value).toBe("Gorgo");
    input.value = "Kong";
    input.dispatchEvent(new Event("input"));
    element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(spies.rename).toHaveBeenCalledWith("Kong");
  });

  it("juices only after a confirmation, and only with a working Juicer", () => {
    const none = setup([gorgo()]);
    const locked = buttonNamed(none.element, "Juice")!;
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    expect(textOf(locked, ".champion-act__short")).toBe("Needs Monster Juicer");
    expect(locked.title).toContain("Build a Monster Juicer");
    locked.click();
    expect(none.spies.juice).not.toHaveBeenCalled();
    expect(none.element.querySelector(".champion__confirm")).toBeNull();

    const { element, spies } = setup([gorgo()], [CAGE, JUICER]);
    const juice = buttonNamed(element, "Juice")!;
    expect(juice.hasAttribute("aria-disabled")).toBe(false);
    juice.click();
    expect(spies.juice).not.toHaveBeenCalled();
    expect(element.textContent).toContain("gone for good and gives no goo");
    buttonNamed(element, "Yes, juice Gorgo")!.click();
    expect(spies.juice).toHaveBeenCalledTimes(1);
  });
});

describe("ChampionPanel: freeze (#125)", () => {
  const CHAMBER: BuildingData = { id: 4, t: 119, l: 1, X: 400, Y: 0 };

  it("freezes a fed, healthy champion in one tap when there is a chamber", () => {
    const { element, spies } = setup([gorgo()], [CAGE, CHAMBER]);
    const freeze = buttonNamed(element, "Freeze")!;
    expect(freeze.hasAttribute("aria-disabled")).toBe(false);
    expect(freeze.querySelector<HTMLImageElement>(".champion-act__art")!.getAttribute("src")).toBe(
      "/assets/buildingbuttons/119.jpg",
    );
    freeze.click();
    expect(spies.freeze).toHaveBeenCalledTimes(1);
  });

  it("shows the Chamber's silhouette and a few words while there is none, the sentence on hover and tap", () => {
    const { element, spies } = setup([gorgo()]);
    const freeze = buttonNamed(element, "Freeze")!;
    expect(freeze.getAttribute("aria-disabled")).toBe("true");
    expect(freeze.querySelector<HTMLImageElement>(".champion-act__art")!.getAttribute("src")).toBe(
      "/assets/buildingbuttons/119.silhouette.jpg",
    );
    expect(textOf(freeze, ".champion-act__short")).toBe("Needs Champion Chamber");
    expect(freeze.title).toContain("Build a Champion Chamber");
    expect(textOf(freeze, ".u-visually-hidden")).toContain("Build a Champion Chamber");
    const hint = element.querySelector<HTMLElement>(".champion__act-hint")!;
    expect(hint.hidden).toBe(true);
    freeze.click();
    expect(spies.freeze).not.toHaveBeenCalled();
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain("Build a Champion Chamber");
  });

  it("says what stands in the way", () => {
    const hurt = setup([gorgo({ hp: 10 })], [CAGE, CHAMBER]);
    const freeze = buttonNamed(hurt.element, "Freeze")!;
    expect(freeze.getAttribute("aria-disabled")).toBe("true");
    expect(textOf(freeze, ".champion-act__short")).toBe("Heal it first");
    expect(freeze.title).toBe("Heal Gorgo to full health before you freeze it.");
    freeze.click();
    expect(hurt.spies.freeze).not.toHaveBeenCalled();
  });
});

describe("hunger words", () => {
  const view = (champion: ChampionSaveEntry, now = T0) => {
    const cage = cageView(loadOf([champion]), now);
    if (cage.kind !== "active") throw new Error("no champion");
    return cage.view;
  };

  it("at the top level talks about the food bonus", () => {
    const top = view(gorgo({ l: 6, fb: 2, hp: 227_500, ft: T0 - HOUR }));
    expect(hungerText(top, T0).detail).toBe("Feed it within 23h 0m or it loses a food bonus.");
  });

  it("with nothing to lose it just asks for food", () => {
    expect(hungerText(view(gorgo({ fd: 0, ft: T0 - HOUR })), T0).title).toBe("Hungry!");
    expect(feedGate(view(gorgo({ ft: T0 - HOUR })))).toBeNull();
  });

  it("starving says what it cost", () => {
    const starving = view(gorgo({ fd: 2, ft: T0 - 25 * HOUR }));
    expect(hungerText(starving, T0)).toEqual({
      title: "Starving!",
      detail: "It went too long without food and loses a feed.",
    });
  });
});

describe("ChampionPanel: stats and Krallen", () => {
  const krallen = (overrides: Partial<ChampionSaveEntry> = {}) =>
    gorgo({ t: 5, l: 5, hp: 30_000, ft: T0 + 14 * HOUR, ...overrides });

  it("shows speed and range with a level preview on the champion's card", () => {
    const { element } = setup([gorgo()]);
    const stats = element.querySelector(".champion__stats")!;
    expect(stats.querySelector(".game-icon--speed")!.getAttribute("aria-label")).toBe("Speed");
    expect(stats.querySelector<HTMLElement>('[data-stat="speed"]')!.title).toMatch(/^Speed .+ → /);
    // Range has no painted icon yet: it keeps its word.
    expect(stats.textContent).toMatch(/Range/);
    expect(stats.textContent).toMatch(/→/);
    expect(element.textContent).toMatch(/Arrows show level 2/);
  });

  it("at the top level names what the next food-bonus rank adds", () => {
    const { element } = setup([gorgo({ l: 6, fb: 1, hp: 227_500 })]);
    expect(element.textContent).toMatch(/Next food-bonus rank \(2 of 3\): \+/);
  });

  it("shows Krallen under the cage and heals him with the special action", () => {
    const { element, spies } = setup([gorgo(), krallen()], [CAGE, { id: 4, t: 119, l: 1, X: 400, Y: 0 }]);
    const card = element.querySelector<HTMLElement>(".champion__part--special")!;
    expect(card.textContent).toMatch(/Krallen/);
    expect(card.textContent).toMatch(/Level 5 of 5/);
    expect(card.querySelector(".champion__heal--special")).not.toBeNull();
    // Hurt, he cannot be frozen yet: the tile says so and does nothing.
    const locked = buttonNamed(card, "Freeze")!;
    expect(textOf(locked, ".champion-act__short")).toBe("Heal it first");
    locked.click();
    expect(spies.freezeSpecial).not.toHaveBeenCalled();

    const healed = setup([gorgo(), krallen({ hp: 10_000_000 })], [CAGE, { id: 4, t: 119, l: 1, X: 400, Y: 0 }]);
    buttonNamed(healed.element.querySelector<HTMLElement>(".champion__part--special")!, "Freeze")!.click();
    expect(healed.spies.freezeSpecial).toHaveBeenCalled();
  });

  it("says a frozen Krallen waits in the Chamber", () => {
    const { element } = setup([krallen({ status: 1 })]);
    expect(element.querySelector(".champion__part--special")!.textContent).toMatch(/asleep in the Champion Chamber/);
  });

  it("shows no Krallen card before he is granted", () => {
    const { element } = setup([gorgo()]);
    expect(element.querySelector(".champion__part--special")).toBeNull();
  });
});
