// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerCell } from "@/api/types";
import { resetOutpostLabels, setOutpostLabels } from "@/game/yard/outpostLabels";
import { YARD_CARD_SHORT, YARD_CARD_TEXT, YardCard, type YardCardOptions } from "./YardCard";

/**
 * The yard info card (beta 7, owner's design B): the player's own yard or
 * outpost in the middle of the screen, with its name, Starter Kit, ground,
 * Flinger, worker, and the monsters housed there under a housing bar.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const CELL = { col: 439, row: 461 };

const outpost = (overrides: Partial<PlayerCell> = {}): PlayerCell => ({
  uid: 2503,
  b: 3,
  i: 150,
  bid: "22913802240208",
  aid: null,
  n: "yardtester",
  l: 30,
  v: 1,
  dm: 0,
  d: 0,
  lo: 0,
  p: 0,
  mine: 1,
  pic_square: null,
  pi: 0,
  fr: 0,
  kit: 3,
  wi: 1,
  m: { housed: { C6: 39, C14: 4 }, space: 540 },
  ...overrides,
});

const main = (overrides: Partial<PlayerCell> = {}): PlayerCell => {
  const cell = outpost({ b: 2, bid: "3502", r: { r1: 50, r1max: 100, r2: 1, r2max: 100, r3: 100, r3max: 100, r4: 0, r4max: 100 }, ...overrides });
  delete cell.kit;
  delete cell.wi;
  return cell;
};

let host: HTMLElement;

const open = (payload: PlayerCell, overrides: Partial<YardCardOptions> = {}) => {
  host = document.createElement("div");
  document.body.append(host);
  const options: YardCardOptions = {
    onOpen: vi.fn(),
    onBookmark: vi.fn(),
    canBookmark: () => true,
    sizeOf: (id) => ({ C6: 5, C14: 20 })[id] ?? 1,
    ownFlinger: () => ({ level: 3, reach: 6 }),
    ownMoves: (_cell, cell) => ({ monsters: true, relocate: cell.b === 3 }),
    onMoveFrom: vi.fn(),
    onBringHere: vi.fn(),
    onRelocate: vi.fn(),
    onInvite: vi.fn(),
    onWithdrawInvite: vi.fn(),
    cellsFromHome: () => 3,
    onClose: vi.fn(),
    ...overrides,
  };
  const card = new YardCard(CELL, payload, options).mount(host);
  return { card, options };
};

const text = (selector: string): string => host.querySelector(selector)?.textContent ?? "";

const visible = (selector: string): HTMLElement[] =>
  [...host.querySelectorAll<HTMLElement>(selector)].filter((node) => !node.closest("[hidden]"));

/** A button by its name: its full words (a phone shows the short ones). */
const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  visible("button").find((node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === name) as
    | HTMLButtonElement
    | undefined;

afterEach(() => {
  host.remove();
  resetOutpostLabels();
});

describe("YardCard on an outpost", () => {
  it("is a centred skinned window titled for the outpost", () => {
    open(outpost());
    const panel = host.querySelector(".popup-backdrop > .panel.yard-card");
    expect(panel).not.toBeNull();
    expect(text(".panel__title")).toBe(YARD_CARD_TEXT.titleOutpost);
  });

  it("calls an unnamed outpost by its cell, and shows its name once it has one", () => {
    open(outpost());
    expect(text(".yard-card__name")).toBe("Outpost 439, 461");
    // The cell is in the name already: the line under it says only how far.
    expect(text(".yard-card__where")).toBe("3 cells from main");
    setOutpostLabels({ names: { "22913802240208": "North gate" }, pins: [] });
    expect(text(".yard-card__name")).toBe("North gate");
    expect(text(".yard-card__where")).toBe("439, 461 · 3 cells from main");
  });

  it("shows the Starter Kit as the kit's own picture and name", () => {
    open(outpost());
    expect(text(".yard-card__kit-name")).toBe("Ultra Kit");
    expect(host.querySelector<HTMLImageElement>(".yard-card__kit-picture")?.getAttribute("src")).toBe(
      "/assets/ui/kits/kit-ultra-modern.webp?v=1",
    );
  });

  it("says so when the outpost has no kit", () => {
    open(outpost({ kit: 0 }));
    expect(text(".yard-card__kit-name")).toBe(YARD_CARD_TEXT.noKit);
    expect(host.querySelector(".yard-card__kit-picture")).toBeNull();
  });

  it("lists the monsters housed as portrait and count, with the housing bar", () => {
    open(outpost());
    const tiles = visible(".yard-card__monster");
    expect(tiles.map((tile) => tile.dataset["monster"])).toEqual(["C6", "C14"]);
    expect(tiles.map((tile) => tile.querySelector(".yard-card__count")?.textContent)).toEqual(["×39", "×4"]);
    expect(tiles.every((tile) => tile.querySelector("img.yard-card__portrait"))).toBe(true);
    // Name and count share one strip, so the count never covers the portrait's head.
    expect(tiles.every((tile) => tile.querySelector(".yard-card__caption > .yard-card__monster-name + .yard-card__count"))).toBe(true);
    // 39 × 5 + 4 × 20 = 275 of 540.
    expect(text(".yard-card__housed-count")).toContain("275 / 540");
    expect(host.querySelector(".yard-card__bar")?.getAttribute("aria-valuenow")).toBe("51");
  });

  it("draws one tile size however many kinds of monster live there", () => {
    open(outpost());
    expect(host.querySelector(".yard-card__grid")?.className).toBe("yard-card__grid");
    open(outpost({ m: { housed: { C1: 1, C2: 1, C3: 1, C4: 1, C5: 1 }, space: 540 } }));
    expect(host.querySelector(".yard-card__grid")?.className).toBe("yard-card__grid");
  });

  it("fades the monster tiles' edge too, where they scroll on their own", () => {
    const { card } = open(outpost());
    const grid = card.popup.body.querySelector<HTMLElement>(".yard-card__grid")!;
    Object.defineProperty(grid, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(grid, "scrollHeight", { configurable: true, value: 220 });
    grid.dispatchEvent(new Event("scroll"));
    expect(grid.classList.contains("yard-card__grid--more-below")).toBe(true);
    expect(grid.classList.contains("yard-card__body--more-below")).toBe(false);
  });

  it("says what each ground bonus is for, with a sentence on hover", () => {
    open(outpost({ i: 150 }));
    const bonuses = visible(".yard-card__bonus");
    expect(bonuses.map((chip) => chip.querySelector(".yard-card__chip-label")?.textContent)).toEqual([
      YARD_CARD_TEXT.towerReach,
      YARD_CARD_TEXT.income,
    ]);
    expect(bonuses.every((chip) => chip.title.length > 0)).toBe(true);
  });

  it("says when nobody lives there, and Move monsters from here waits", () => {
    open(outpost({ m: { housed: {}, space: 540 } }));
    expect(text(".yard-card__empty")).toBe(YARD_CARD_TEXT.noMonsters);
    expect(buttonNamed(YARD_CARD_TEXT.moveFrom)?.disabled).toBe(true);
    expect(buttonNamed(YARD_CARD_TEXT.bringHere)?.disabled).toBe(false);
  });

  it("shows the Flinger's reach and an idle worker", () => {
    open(outpost());
    expect(text(".yard-card__stat--flinger .yard-card__stat-value")).toBe("6 cells");
    expect(text(".yard-card__stat--flinger .yard-card__stat-detail")).toBe("Level 3");
    expect(text(".yard-card__stat--worker .yard-card__stat-value")).toBe(YARD_CARD_TEXT.idle);
  });

  it("wires every action to its cell", () => {
    const { options } = open(outpost());
    buttonNamed(YARD_CARD_TEXT.openOutpost)?.click();
    expect(options.onOpen).toHaveBeenCalled();
    buttonNamed(YARD_CARD_TEXT.moveFrom)?.click();
    expect(options.onMoveFrom).toHaveBeenCalledWith(CELL, expect.objectContaining({ bid: "22913802240208" }));
    buttonNamed(YARD_CARD_TEXT.bringHere)?.click();
    expect(options.onBringHere).toHaveBeenCalledWith(CELL, expect.objectContaining({ bid: "22913802240208" }));
    buttonNamed(YARD_CARD_TEXT.relocate)?.click();
    expect(options.onRelocate).toHaveBeenCalled();
    buttonNamed(YARD_CARD_TEXT.invite)?.click();
    expect(options.onInvite).toHaveBeenCalled();
    buttonNamed(YARD_CARD_TEXT.bookmark)?.click();
    expect(options.onBookmark).toHaveBeenCalledWith(CELL);
  });

  it("has one main action, the monster moves beside it, and the rest as smaller plates", () => {
    open(outpost());
    const main = visible(".yard-card__row--main > button").map((node) => node.getAttribute("aria-label"));
    const minor = visible(".yard-card__row--second > button").map((node) => node.getAttribute("aria-label"));
    expect(main).toEqual([YARD_CARD_TEXT.openOutpost, YARD_CARD_TEXT.moveFrom, YARD_CARD_TEXT.bringHere]);
    expect(minor).toEqual([YARD_CARD_TEXT.relocate, YARD_CARD_TEXT.invite, YARD_CARD_TEXT.bookmark]);
    expect(visible(".btn--primary")).toHaveLength(1);
    // Each plate carries its full words and the phone's short ones.
    const open1 = buttonNamed(YARD_CARD_TEXT.openOutpost)!;
    expect(open1.querySelector(".yard-card__label--long")?.textContent).toBe(YARD_CARD_TEXT.openOutpost);
    expect(open1.querySelector(".yard-card__label--short")?.textContent).toBe(YARD_CARD_SHORT[YARD_CARD_TEXT.openOutpost]);
  });

  it("withdraws a waiting invitation instead of sending one", () => {
    const { options } = open(outpost({ pi: 12 }));
    buttonNamed(YARD_CARD_TEXT.withdraw)?.click();
    expect(options.onWithdrawInvite).toHaveBeenCalled();
    expect(options.onInvite).not.toHaveBeenCalled();
  });

  it("leaves the moves out when the player has nowhere to move monsters", () => {
    open(outpost(), { ownMoves: () => ({ monsters: false, relocate: true }) });
    expect(buttonNamed(YARD_CARD_TEXT.moveFrom)).toBeUndefined();
    expect(buttonNamed(YARD_CARD_TEXT.bringHere)).toBeUndefined();
  });

  it("renames in place: Enter saves through the outpost names", async () => {
    const rename = vi.fn(async (baseid: string, name: string) => ({ names: { [baseid]: name }, pins: [] }));
    open(outpost(), { rename });
    host.querySelector<HTMLButtonElement>(".yard-card__rename")?.click();
    const input = host.querySelector<HTMLInputElement>(".yard-card__input")!;
    input.value = "  Putty   farm ";
    input.form?.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(rename).toHaveBeenCalledWith("22913802240208", "Putty farm");
    expect(text(".yard-card__name")).toBe("Putty farm");
  });

  it("shows the server's words when a rename is refused", async () => {
    const rename = vi.fn(async () => {
      throw new Error("That name is not allowed.");
    });
    open(outpost(), { rename });
    host.querySelector<HTMLButtonElement>(".yard-card__rename")?.click();
    const input = host.querySelector<HTMLInputElement>(".yard-card__input")!;
    input.value = "bad";
    input.form?.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(text(".yard-card__error")).toBe("That name is not allowed.");
  });

  it("pins and unpins the outpost", async () => {
    const pin = vi.fn(async (baseid: string, on: boolean) => ({ names: {}, pins: on ? [baseid] : [] }));
    open(outpost(), { pin });
    host.querySelector<HTMLButtonElement>(".yard-card__pin")?.click();
    await flush();
    expect(pin).toHaveBeenCalledWith("22913802240208", true);
    const button = host.querySelector<HTMLButtonElement>(".yard-card__pin")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe(YARD_CARD_TEXT.pin);
    expect(button.classList.contains("yard-card__pin--on")).toBe(true);
    expect(button.title).toBe(YARD_CARD_TEXT.pinned);
    button.click();
    await flush();
    expect(pin).toHaveBeenLastCalledWith("22913802240208", false);
    expect(host.querySelector(".yard-card__pin")?.classList.contains("yard-card__pin--on")).toBe(false);
  });

  it("redraws only when the map sends news, and keeps a rename being typed", () => {
    const payload = outpost();
    const { card } = open(payload);
    const before = host.querySelector(".yard-card__monster");
    card.update(CELL, payload);
    expect(host.querySelector(".yard-card__monster")).toBe(before);

    host.querySelector<HTMLButtonElement>(".yard-card__rename")?.click();
    card.update(CELL, outpost({ m: { housed: { C6: 40 }, space: 540 } }));
    expect(host.querySelector(".yard-card__input")).not.toBeNull();
    expect(visible(".yard-card__count").map((node) => node.textContent)).toEqual(["×40"]);
  });

  it("fades the body's bottom edge while more is below, and its top once scrolled", () => {
    const { card } = open(outpost());
    const body = card.popup.body;
    Object.defineProperty(body, "clientHeight", { configurable: true, value: 150 });
    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 370 });
    body.dispatchEvent(new Event("scroll"));
    expect(body.classList.contains("yard-card__body--more-below")).toBe(true);
    expect(body.classList.contains("yard-card__body--more-above")).toBe(false);
    body.scrollTop = 220;
    body.dispatchEvent(new Event("scroll"));
    expect(body.classList.contains("yard-card__body--more-below")).toBe(false);
    expect(body.classList.contains("yard-card__body--more-above")).toBe(true);
  });

  it("tells the map when the player closes it, but not when the map does", () => {
    const first = open(outpost());
    first.card.popup.close();
    expect(first.options.onClose).toHaveBeenCalledTimes(1);
    host.remove();

    const second = open(outpost());
    second.card.dismiss();
    expect(second.options.onClose).not.toHaveBeenCalled();
    expect(host.querySelector(".yard-card")).toBeNull();
  });
});

describe("YardCard on the main yard", () => {
  it("has no kit, no rename, no worker; it shows the stores instead", () => {
    open(main());
    expect(text(".panel__title")).toBe(YARD_CARD_TEXT.titleMain);
    expect(text(".yard-card__name")).toBe("Main yard");
    expect(host.querySelector(".yard-card__rename")).toBeNull();
    expect(visible(".yard-card__kit")).toHaveLength(0);
    expect(host.querySelector(".yard-card__stat--worker")).toBeNull();
    expect(visible(".yard-card__store").map((node) => node.textContent)).toEqual(["50%", "1%", "100%", "0%"]);
    expect(text(".yard-card__where")).toBe("439, 461");
  });

  it("offers Open yard and the monster moves, but not Move main yard here", () => {
    open(main());
    expect(buttonNamed(YARD_CARD_TEXT.openMain)).toBeDefined();
    expect(buttonNamed(YARD_CARD_TEXT.moveFrom)).toBeDefined();
    expect(buttonNamed(YARD_CARD_TEXT.relocate)).toBeUndefined();
    expect(buttonNamed(YARD_CARD_TEXT.invite)).toBeUndefined();
  });
});
