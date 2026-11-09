// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import type { OutpostLabels } from "@/api/outpostLabels";
import { outpostLabels, resetOutpostLabels } from "@/game/yard/outpostLabels";
import { MAIN_YARD, outpostTarget, type OwnYardTarget } from "@/game/yard/ownYards";
import type { YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { Notices } from "@/ui/maproom/Notices";
import { YardDock } from "./YardDock";
import { YardSwitcher } from "./YardSwitcher";

/**
 * The HUD's yard switcher (outposts WP5, #146): the open yard's title, the
 * outpost count, and a menu of the main yard and every outpost.
 */

const bindingFor = (
  outposts: BaseLoadResponse["outposts"],
  target: OwnYardTarget,
  outpostlabels?: unknown,
): YardUiBinding => {
  const store = {
    save: {
      outposts,
      ...(outpostlabels !== undefined && { outpostlabels }),
    } as BaseLoadResponse,
    target,
    kind: target.kind,
    // What the rest of the HUD reads once bound.
    caps: null,
    workers: { total: 1, busy: 0 },
    jobs: () => [],
    now: () => 0,
    isRunning: () => false,
    subscribe: () => () => undefined,
  };
  return {
    store: store as unknown as YardStore,
    scene: { selectBuilding: () => undefined },
    notices: new Notices(),
  };
};

const TWO: BaseLoadResponse["outposts"] = [
  [242, 209, "2000242209"],
  [240, 210, "2000240210"],
];

describe("YardSwitcher", () => {
  let onSelect: ReturnType<typeof vi.fn<(target: OwnYardTarget) => void>>;
  let switcher: YardSwitcher;

  beforeEach(() => {
    document.body.replaceChildren();
    resetOutpostLabels();
    onSelect = vi.fn<(target: OwnYardTarget) => void>();
    switcher = new YardSwitcher({ onSelect });
    document.body.append(switcher.element);
  });

  afterEach(() => switcher.destroy());

  const button = (): HTMLButtonElement =>
    switcher.element.querySelector<HTMLButtonElement>(".yard-switcher__button")!;
  const items = (): HTMLButtonElement[] => [
    ...switcher.element.querySelectorAll<HTMLButtonElement>(".yard-switcher__item"),
  ];

  it("is hidden until an own yard is bound", () => {
    expect(switcher.element.hidden).toBe(true);
    switcher.bind(bindingFor(TWO, MAIN_YARD));
    expect(switcher.element.hidden).toBe(false);
    switcher.bind(null);
    expect(switcher.element.hidden).toBe(true);
  });

  it("lists the main yard and each outpost, the open one marked", () => {
    switcher.bind(bindingFor(TWO, outpostTarget("2000242209", { col: 242, row: 209 })));
    expect(button().textContent).toBe("2Outpost (242, 209)");
    expect(button().getAttribute("aria-label")).toBe(
      "Your yards: Outpost (242, 209), 2 outposts",
    );
    button().click();
    // One line each: an unnamed outpost is its coordinates.
    expect(items().map((item) => item.textContent)).toEqual([
      "Main yard",
      "242, 209",
      "240, 210",
    ]);
    expect(items().map((item) => item.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
  });

  it("lists only the main yard for a player with no outposts", () => {
    switcher.bind(bindingFor([], MAIN_YARD));
    // No badge for no outposts; the label is the yard's title.
    expect(button().querySelector<HTMLElement>(".yard-switcher__count")!.hidden).toBe(true);
    expect(button().querySelector(".yard-switcher__title")!.textContent).toBe("Main yard");
    button().click();
    expect(items().map((item) => item.textContent)).toEqual(["Main yard"]);
  });

  it("opens on a click, reports the yard picked, and ignores the open one", () => {
    switcher.bind(bindingFor(TWO, MAIN_YARD));
    button().click();
    expect(switcher.open).toBe(true);
    items()[0]!.click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(switcher.open).toBe(false);

    button().click();
    items()[2]!.click();
    expect(onSelect).toHaveBeenCalledWith({
      baseid: "2000240210",
      kind: "outpost",
      cell: { col: 240, row: 210 },
    });
  });

  it("closes on Escape and on a press elsewhere", () => {
    switcher.bind(bindingFor(TWO, MAIN_YARD));
    button().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(switcher.open).toBe(false);
    button().click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(switcher.open).toBe(false);
  });
});

describe("outpost names and pins (beta 7)", () => {
  const THREE: BaseLoadResponse["outposts"] = [
    [439, 461, "101"],
    [438, 462, "102"],
    [436, 464, "103"],
  ];
  let rename: ReturnType<
    typeof vi.fn<(baseid: string, name: string) => Promise<OutpostLabels>>
  >;
  let pin: ReturnType<typeof vi.fn<(baseid: string, pin: boolean) => Promise<OutpostLabels>>>;
  let switcher: YardSwitcher;

  beforeEach(() => {
    document.body.replaceChildren();
    resetOutpostLabels();
    rename = vi.fn<(baseid: string, name: string) => Promise<OutpostLabels>>();
    pin = vi.fn<(baseid: string, pin: boolean) => Promise<OutpostLabels>>();
    switcher = new YardSwitcher({ onSelect: () => undefined, api: { rename, pin } });
    document.body.append(switcher.element);
  });

  afterEach(() => switcher.destroy());

  const q = <T extends Element>(selector: string): T =>
    switcher.element.querySelector<T>(selector)!;
  const all = <T extends Element>(selector: string): T[] => [
    ...switcher.element.querySelectorAll<T>(selector),
  ];
  const names = (): string[] => all(".yard-switcher__name").map((one) => one.textContent ?? "");
  const open = (): void => q<HTMLButtonElement>(".yard-switcher__button").click();
  const rowOf = (name: string): HTMLElement =>
    all<HTMLElement>(".yard-switcher__row").find(
      (row) => row.querySelector(".yard-switcher__name")?.textContent === name,
    )!;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("shows a name with the coordinates muted beside it, and pinned outposts first in pin order", () => {
    switcher.bind(
      bindingFor(THREE, outpostTarget("103", { col: 436, row: 464 }), {
        names: { "102": "Gold mine", "103": "Front line" },
        pins: ["103", "101"],
      }),
    );
    // The HUD title is the open outpost's name.
    expect(q(".yard-switcher__title").textContent).toBe("Front line");
    open();
    expect(names()).toEqual(["Main yard", "Front line", "439, 461", "Gold mine"]);
    expect(all(".yard-switcher__cell").map((one) => one.textContent)).toEqual([
      "436, 464",
      "438, 462",
    ]);
    expect(all(".yard-switcher__pin").map((one) => one.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
      "false",
    ]);
    // The main yard has no pin and no rename.
    expect(
      all(".yard-switcher__row")[0]!.querySelectorAll(".yard-switcher__action"),
    ).toHaveLength(0);
    expect(q(".yard-switcher__pins").textContent).toContain("2/20");
  });

  it("pinning moves the outpost to the top, after the main yard", async () => {
    switcher.bind(bindingFor(THREE, MAIN_YARD));
    open();
    pin.mockResolvedValue({ names: {}, pins: ["103"] });
    rowOf("436, 464").querySelector<HTMLButtonElement>(".yard-switcher__pin")!.click();
    expect(pin).toHaveBeenCalledWith("103", true);
    await settle();
    expect(names()).toEqual(["Main yard", "436, 464", "439, 461", "438, 462"]);
    expect(outpostLabels().pins).toEqual(["103"]);

    pin.mockResolvedValue({ names: {}, pins: [] });
    rowOf("436, 464").querySelector<HTMLButtonElement>(".yard-switcher__pin")!.click();
    expect(pin).toHaveBeenLastCalledWith("103", false);
    await settle();
    expect(names()).toEqual(["Main yard", "439, 461", "438, 462", "436, 464"]);
  });

  it("refuses a 21st pin without asking the server", () => {
    const many: BaseLoadResponse["outposts"] = Array.from({ length: 21 }, (_, i) => [
      i,
      i,
      String(500 + i),
    ]);
    switcher.bind(
      bindingFor(many, MAIN_YARD, { names: {}, pins: many!.slice(0, 20).map((one) => one[2]) }),
    );
    open();
    rowOf("20, 20").querySelector<HTMLButtonElement>(".yard-switcher__pin")!.click();
    expect(pin).not.toHaveBeenCalled();
    expect(q(".yard-switcher__error").textContent).toBe("Pinned 20 already. Unpin one first.");
  });

  it("renames in place: Enter saves, the list and the HUD title follow", async () => {
    switcher.bind(bindingFor(THREE, outpostTarget("101", { col: 439, row: 461 })));
    open();
    rowOf("439, 461").querySelector<HTMLButtonElement>(".yard-switcher__rename")!.click();
    const input = q<HTMLInputElement>(".yard-switcher__input");
    expect(input.maxLength).toBe(24);
    expect(input.placeholder).toBe("439, 461");
    rename.mockResolvedValue({ names: { "101": "Home front" }, pins: [] });
    input.value = "  Home   front ";
    input.form!.requestSubmit();
    expect(rename).toHaveBeenCalledWith("101", "Home front");
    await settle();
    expect(all(".yard-switcher__input")).toHaveLength(0);
    expect(names()).toEqual(["Main yard", "Home front", "438, 462", "436, 464"]);
    expect(q(".yard-switcher__title").textContent).toBe("Home front");
    expect(switcher.open).toBe(true);
  });

  it("Escape in the box keeps the old name and the list open; an unchanged name is not sent", () => {
    switcher.bind(bindingFor(THREE, MAIN_YARD, { names: { "102": "Gold mine" }, pins: [] }));
    open();
    rowOf("Gold mine").querySelector<HTMLButtonElement>(".yard-switcher__rename")!.click();
    q<HTMLInputElement>(".yard-switcher__input").value = "Something else";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(switcher.open).toBe(true);
    expect(all(".yard-switcher__input")).toHaveLength(0);
    expect(names()).toContain("Gold mine");

    rowOf("Gold mine").querySelector<HTMLButtonElement>(".yard-switcher__rename")!.click();
    q<HTMLInputElement>(".yard-switcher__input").form!.requestSubmit();
    expect(rename).not.toHaveBeenCalled();
  });

  it("an empty name goes back to the coordinates; a refusal shows the server's words and keeps the box", async () => {
    switcher.bind(bindingFor(THREE, MAIN_YARD, { names: { "102": "Gold mine" }, pins: [] }));
    open();
    rowOf("Gold mine").querySelector<HTMLButtonElement>(".yard-switcher__rename")!.click();
    rename.mockRejectedValueOnce(new Error("That name has a word that is not allowed."));
    q<HTMLInputElement>(".yard-switcher__input").value = "rude";
    q<HTMLInputElement>(".yard-switcher__input").form!.requestSubmit();
    await settle();
    expect(q(".yard-switcher__error").textContent).toBe(
      "That name has a word that is not allowed.",
    );
    expect(q<HTMLInputElement>(".yard-switcher__input").value).toBe("rude");

    rename.mockResolvedValue({ names: {}, pins: [] });
    q<HTMLInputElement>(".yard-switcher__input").value = "";
    q<HTMLInputElement>(".yard-switcher__input").form!.requestSubmit();
    expect(rename).toHaveBeenLastCalledWith("102", "");
    await settle();
    expect(names()).toEqual(["Main yard", "439, 461", "438, 462", "436, 464"]);
  });

  it("lists 800 outposts as 801 one-line rows, quickly, and only while open", () => {
    const outposts: BaseLoadResponse["outposts"] = Array.from({ length: 800 }, (_, i) => [
      100 + (i % 40),
      200 + Math.floor(i / 40),
      String(10_000 + i),
    ]);
    switcher.bind(
      bindingFor(outposts, MAIN_YARD, { names: { "10005": "Fifth" }, pins: ["10799"] }),
    );
    expect(all(".yard-switcher__row")).toHaveLength(0);
    const started = performance.now();
    open();
    const took = performance.now() - started;
    expect(all(".yard-switcher__row")).toHaveLength(801);
    expect(names().slice(0, 3)).toEqual(["Main yard", "139, 219", "100, 200"]);
    expect(q(".yard-switcher__outposts").textContent).toBe("800");
    // Generous for a slow test machine; a browser builds it far faster.
    expect(took).toBeLessThan(1500);
  });
});

describe("the dock's switcher", () => {
  it("rides with the round buttons only when the scene can switch yards", () => {
    const plain = new YardDock({ onMap: () => {}, onLayout: () => {} });
    expect(plain.element.querySelector(".yard-switcher")).toBeNull();
    plain.destroy();

    const dock = new YardDock({ onMap: () => {}, onLayout: () => {}, onYardSelect: () => {} });
    const element = dock.element.querySelector<HTMLElement>(".yard-switcher")!;
    expect(element.hidden).toBe(true);
    dock.bind(bindingFor(TWO, MAIN_YARD));
    expect(element.hidden).toBe(false);
    dock.destroy();
  });
});
