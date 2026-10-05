// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AchievementsApi, AchievementsStateReport, PlayerAchievements } from "@/api/achievements";
import { ApiError } from "@/api/http";
import { FOOTER_TEXT } from "@/game/achievements/achievements";
import { achievementsOpener, setAchievementsOpener } from "@/game/achievements/achievementsView";
import { AchievementsDoor } from "./AchievementsDoor";
import { ALL_DONE, AchievementsScreen, LOAD_FAILED, NONE_YET, NOT_FOUND } from "./AchievementsScreen";

/** The achievements screen (issue #204, §10.1) and the door that docks it. */

const noon = (iso: string): number => Math.floor(new Date(`${iso}T12:00:00`).getTime() / 1000);

const ownState = (): AchievementsStateReport => ({
  achievements: [
    {
      id: 1,
      name: "Moving Up",
      description: "Upgrade your Town Hall to level 2",
      shiny: 5,
      status: "earned",
      at: noon("2026-10-01"),
      progress: { value: 2, target: 2 },
    },
    {
      id: 2,
      name: "Town Planner",
      description: "Town Hall level 5",
      shiny: 10,
      status: "locked",
      progress: { value: 4, target: 5 },
    },
    {
      id: 5,
      name: "Champion of Champions",
      description: "Fully evolve all three",
      shiny: 25,
      status: "locked",
      progress: {
        value: 1,
        target: 3,
        parts: [
          { label: "Gorgo", value: 1, target: 1 },
          { label: "Drull", value: 0, target: 1 },
          { label: "Fomor", value: 0, target: 1 },
        ],
      },
    },
    {
      id: 6,
      name: "Brave New World",
      description: "Upgrade your Map Room to level 2",
      shiny: 10,
      status: "earned",
      at: noon("2026-10-03"),
      progress: { value: 1, target: 1 },
    },
  ],
  earned: 2,
  total: 4,
  shinyEarned: 15,
  fresh: [],
});

const someone = (): PlayerAchievements => ({
  userid: 77,
  name: "Bob",
  earned: 1,
  total: 3,
  achievements: [
    { id: 12, name: "Great Wall", description: "Build 200 Blocks", status: "locked" },
    { id: 1, name: "Moving Up", description: "Town Hall 2", status: "earned", at: noon("2026-09-20") },
    { id: 3, name: "Backyard Boss", description: "Town Hall 8", status: "locked" },
  ],
});

const api = (over: Partial<AchievementsApi> = {}): AchievementsApi => ({
  state: vi.fn(async () => ownState()),
  player: vi.fn(async () => someone()),
  ...over,
});

const rows = (screen: AchievementsScreen, group: number): HTMLElement[] => [
  ...screen.element.querySelectorAll<HTMLElement>(`.ach-group:nth-child(${group}) .ach-row`),
];
const groupTitles = (screen: AchievementsScreen): string[] =>
  [...screen.element.querySelectorAll(".ach-group__title")].map((one) => one.textContent ?? "");
const text = (root: ParentNode, selector: string): string => root.querySelector(selector)?.textContent ?? "";

describe("AchievementsScreen: the player's own", () => {
  afterEach(() => document.body.replaceChildren());

  it("heads with the counts, lists To do closest first and Earned newest first, and ends in the footer", async () => {
    const screen = new AchievementsScreen({ api: api() }).mount(document.body);
    expect(screen.element.hidden).toBe(true);
    await screen.open();

    expect(screen.isOpen).toBe(true);
    expect(text(screen.element, ".panel__title")).toBe("Achievements");
    expect(text(screen.element, ".ach-summary")).toBe("2 of 4 earned · 15 Shiny earned");
    expect(groupTitles(screen)).toEqual(["To do", "Earned"]);
    expect(rows(screen, 1).map((row) => row.dataset["achievement"])).toEqual(["2", "5"]);
    expect(rows(screen, 2).map((row) => row.dataset["achievement"])).toEqual(["6", "1"]);
    expect(text(screen.element, ".ach-footer")).toBe(FOOTER_TEXT);
  });

  it("gives a To do row a bar, its progress words and its reward; an Earned row its date", async () => {
    const screen = new AchievementsScreen({ api: api() }).mount(document.body);
    await screen.open();
    const [planner, champions] = rows(screen, 1);
    expect(text(planner!, ".ach-row__name")).toBe("Town Planner");
    expect(text(planner!, ".ach-row__figures")).toBe("Town Hall 4 / 5");
    expect(text(planner!, ".ach-row__reward")).toBe("+10 Shiny");
    const bar = planner!.querySelector<HTMLElement>(".ach-bar")!;
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-valuetext")).toBe("Town Hall 4 / 5");
    expect(planner!.querySelector<HTMLElement>(".ach-bar__fill")!.style.width).toBe("80%");
    expect(planner!.querySelector(".ach-badge--silver.ach-badge--locked")).not.toBeNull();

    // The champions' entry lists each champion, the one done marked.
    const parts = [...champions!.querySelectorAll(".ach-part")].map((one) => [one.textContent, one.className]);
    expect(parts).toEqual([
      ["Gorgo", "ach-part ach-part--done"],
      ["Drull", "ach-part"],
      ["Fomor", "ach-part"],
    ]);
    expect(champions!.querySelector(".ach-badge--gold")).not.toBeNull();

    const [mapRoom] = rows(screen, 2);
    expect(text(mapRoom!, ".ach-row__date")).toBe("Earned 3 Oct 2026");
    expect(mapRoom!.querySelector(".ach-row__reward")).toBeNull();
    expect(mapRoom!.querySelector(".ach-bar")).toBeNull();
    expect(mapRoom!.querySelector(".ach-badge--locked")).toBeNull();
  });

  it("says so when a group is empty", async () => {
    const state = ownState();
    state.achievements = state.achievements.filter((one) => one.status === "earned");
    const screen = new AchievementsScreen({ api: api({ state: vi.fn(async () => state) }) }).mount(document.body);
    await screen.open();
    expect(text(screen.element, ".ach-group:nth-child(1) .ach-group__empty")).toBe(ALL_DONE);
  });

  it("offers Try again when the list cannot load, and fetches again on it", async () => {
    const state = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ownState());
    const screen = new AchievementsScreen({ api: api({ state }) }).mount(document.body);
    await screen.open();
    expect(text(screen.element, ".ach-status__text")).toBe(LOAD_FAILED);
    expect(screen.element.querySelectorAll(".ach-row").length).toBe(0);

    screen.element.querySelector<HTMLButtonElement>(".ach-status__retry")!.click();
    await vi.waitFor(() => expect(screen.element.querySelectorAll(".ach-row").length).toBe(4));
    expect(screen.element.querySelector<HTMLElement>(".ach-status")!.hidden).toBe(true);
  });

  it("closes on its × and on Escape, and tells the opener when focus was inside", async () => {
    const onClose = vi.fn();
    const screen = new AchievementsScreen({ api: api(), onClose }).mount(document.body);
    await screen.open();
    const close = screen.element.querySelector<HTMLButtonElement>(".ach-screen__close")!;
    expect(document.activeElement).toBe(close);
    close.click();
    expect(screen.isOpen).toBe(false);
    expect(screen.element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledWith(true);

    await screen.open();
    screen.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(screen.isOpen).toBe(false);
  });

  it("drops an answer that arrives after the player has moved on", async () => {
    let answer: (state: AchievementsStateReport) => void = () => {};
    const state = vi.fn(() => new Promise<AchievementsStateReport>((resolve) => (answer = resolve)));
    const screen = new AchievementsScreen({ api: api({ state }) }).mount(document.body);
    const opening = screen.open();
    await screen.openPlayer(77, "Bob");
    answer(ownState());
    await opening;
    expect(text(screen.element, ".panel__title")).toBe("Bob's achievements");
    expect(screen.element.querySelectorAll(".ach-row__reward").length).toBe(0);
  });
});

describe("AchievementsScreen: someone else's, read-only", () => {
  afterEach(() => document.body.replaceChildren());

  it("titles it with their name and shows Earned then Not earned yet, with no progress and no Shiny", async () => {
    const calls = api();
    const screen = new AchievementsScreen({ api: calls }).mount(document.body);
    await screen.openPlayer(77, "Bobby");
    expect(calls.player).toHaveBeenCalledWith(77);
    expect(calls.state).not.toHaveBeenCalled();
    expect(screen.shownPlayer).toBe(77);
    expect(screen.element.dataset["view"]).toBe("player");
    // The answer's name wins over the one the opener knew.
    expect(text(screen.element, ".panel__title")).toBe("Bob's achievements");
    expect(text(screen.element, ".ach-summary")).toBe("1 of 3 earned");
    expect(groupTitles(screen)).toEqual(["Earned", "Not earned yet"]);
    expect(rows(screen, 1).map((row) => row.dataset["achievement"])).toEqual(["1"]);
    expect(text(rows(screen, 1)[0]!, ".ach-row__date")).toBe("Earned 20 Sep 2026");
    expect(rows(screen, 2).map((row) => row.dataset["achievement"])).toEqual(["3", "12"]);
    expect(screen.element.querySelector(".ach-bar, .ach-row__reward, .ach-row__figures")).toBeNull();
    expect(screen.element.querySelectorAll(".ach-badge--plain").length).toBe(3);
  });

  it("says None yet when they have earned nothing", async () => {
    const nothing = { ...someone(), earned: 0, achievements: someone().achievements.filter((one) => one.status !== "earned") };
    const screen = new AchievementsScreen({ api: api({ player: vi.fn(async () => nothing) }) }).mount(document.body);
    await screen.openPlayer(77);
    expect(text(screen.element, ".ach-group:nth-child(1) .ach-group__empty")).toBe(NONE_YET);
  });

  it("says the player cannot be found on a 404, without Try again", async () => {
    const player = vi.fn(async () => {
      throw new ApiError("not found", { status: 404 });
    });
    const screen = new AchievementsScreen({ api: api({ player }) }).mount(document.body);
    await screen.openPlayer(4040, "Ghost");
    expect(text(screen.element, ".panel__title")).toBe("Ghost's achievements");
    expect(text(screen.element, ".ach-status__text")).toBe(NOT_FOUND);
    expect(screen.element.querySelector(".ach-status__retry")).toBeNull();
  });

  it("goes back to the player's own list on open", async () => {
    const screen = new AchievementsScreen({ api: api() }).mount(document.body);
    await screen.openPlayer(77);
    await screen.open();
    expect(screen.shownPlayer).toBeNull();
    expect(text(screen.element, ".panel__title")).toBe("Achievements");
    expect(groupTitles(screen)).toEqual(["To do", "Earned"]);
  });
});

describe("AchievementsDoor", () => {
  afterEach(() => {
    document.body.replaceChildren();
    setAchievementsOpener(null);
  });

  it("gives the unlock pop-up's View its opener while it lives, and takes it back on destroy", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const door = new AchievementsDoor({ container: () => container, api: api() });
    const open = achievementsOpener();
    expect(open).not.toBeNull();

    open!();
    await vi.waitFor(() => expect(door.isOpen).toBe(true));
    expect(container.querySelectorAll(".ach-screen").length).toBe(1);

    door.destroy();
    expect(achievementsOpener()).toBeNull();
  });

  it("leaves a newer door's opener alone when an older one goes", () => {
    const older = new AchievementsDoor({ container: () => null, api: api() });
    const newer = new AchievementsDoor({ container: () => null, api: api() });
    const newerOpener = achievementsOpener();
    older.destroy();
    expect(achievementsOpener()).toBe(newerOpener);
    newer.destroy();
    expect(achievementsOpener()).toBeNull();
  });

  it("docks the screen in its container the first time, and makes room first", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpen = vi.fn();
    const door = new AchievementsDoor({ container: () => container, onOpen, api: api() });
    expect(container.querySelector(".ach-screen")).toBeNull();
    expect(door.isOpen).toBe(false);

    await door.open();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".ach-screen").length).toBe(1);
    expect(door.isOpen).toBe(true);

    await door.openPlayer(77, "Bob");
    expect(container.querySelectorAll(".ach-screen").length).toBe(1);
    expect(onOpen).toHaveBeenCalledTimes(2);

    door.close();
    expect(door.isOpen).toBe(false);
    door.destroy();
    expect(container.querySelector(".ach-screen")).toBeNull();
  });

  it("does nothing while there is nowhere to dock", async () => {
    const onOpen = vi.fn();
    const calls = api();
    const door = new AchievementsDoor({ container: () => null, onOpen, api: calls });
    await door.open();
    expect(onOpen).not.toHaveBeenCalled();
    expect(calls.state).not.toHaveBeenCalled();
  });

  it("hands focus back when the screen closes with focus inside", async () => {
    const onClosedWithFocus = vi.fn();
    const door = new AchievementsDoor({ container: () => document.body, onClosedWithFocus, api: api() });
    await door.open();
    document.querySelector<HTMLButtonElement>(".ach-screen__close")!.click();
    expect(onClosedWithFocus).toHaveBeenCalledOnce();
  });
});
