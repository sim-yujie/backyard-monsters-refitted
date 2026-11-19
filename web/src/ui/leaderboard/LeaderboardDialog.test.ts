// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import type { BoardRow, EmpireBoard } from "@/api/leaderboard";
import { EMPTY, LOAD_FAILED, openLeaderboard, outpostIcon, outpostText, splitText } from "./LeaderboardDialog";

/**
 * The leaderboard popup, driven through its DOM with the request stubbed:
 * the rows in order with their points and outposts, the player's own row lit
 * up, the "You: #N" line below the top 100, the empty board and a failed load.
 */

const rowOf = (rank: number, extra: Partial<BoardRow> = {}): BoardRow => ({
  rank,
  userId: 1000 + rank,
  name: `player${rank}`,
  pic: null,
  empirePoints: (200 - rank) * 1234,
  outposts: rank % 3,
  ...extra,
});

const boardOf = (count: number, you: BoardRow | null, total = count): EmpireBoard => ({
  top: Array.from({ length: count }, (_, i) => rowOf(i + 1)),
  you,
  total,
  builtAt: 1_700_000_000,
});

let container: HTMLElement;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = async (board: EmpireBoard | Error, userId: number | null = null) => {
  const popup = openLeaderboard({
    container,
    userId,
    load: () => (board instanceof Error ? Promise.reject(board) : Promise.resolve(board)),
  });
  await flush();
  return popup;
};

const rows = () => [...container.querySelectorAll<HTMLElement>(".leaderboard__list:not(.leaderboard__list--you) .leaderboard__row")];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  container.querySelectorAll<HTMLButtonElement>('button[aria-label="Close"]').forEach((button) => button.click());
  container.remove();
  setClassicLook(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("openLeaderboard", () => {
  it.each([false, true])("explains the flag inline in the current look (Classic: %s)", async (classic) => {
    setClassicLook(classic);
    await open(boardOf(1, null));
    const intro = container.querySelector(".leaderboard__intro")!;
    expect(intro.textContent!.replace(/\s+/g, " ")).toBe("Ranked by empire points: your yard plus your outposts.");
    const flag = intro.querySelector("img")!;
    expect(flag.dataset["icon"]).toBe(classic ? "outpostclassic" : "outpost");
    expect(flag.width).toBe(16);
    expect(flag.height).toBe(16);
    expect(flag.getAttribute("aria-hidden")).toBe("true");
    expect(flag.nextSibling!.textContent).toBe(" outposts.");
  });

  it("fades overflowing edges after showing the own row, and stops on close", async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const onClose = vi.fn();
    const popup = openLeaderboard({ container, userId: 1002, load: async () => boardOf(3, rowOf(2)), onClose });
    Object.defineProperties(popup.body, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 300 },
    });
    const scrollIntoView = vi.fn(function (this: HTMLElement) {
      expect(this.dataset["rank"]).toBe("2");
      popup.body.scrollTop = 50;
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class {
      observe = observe;
      disconnect = disconnect;
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      await flush();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(observe.mock.calls.map(([element]) => element)).toEqual([popup.body, container.querySelector(".leaderboard__list")]);
      expect(popup.body.classList.contains("scroll-fade--more-above")).toBe(true);
      expect(popup.body.classList.contains("scroll-fade--more-below")).toBe(true);
      popup.body.scrollTop = 200;
      popup.body.dispatchEvent(new Event("scroll"));
      expect(popup.body.classList.contains("scroll-fade--more-below")).toBe(false);
      popup.close();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      popup.body.scrollTop = 0;
      popup.body.dispatchEvent(new Event("scroll"));
      expect(popup.body.classList.contains("scroll-fade--more-above")).toBe(true);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("does not start fading if closed before the board arrives", async () => {
    let resolve!: (board: EmpireBoard) => void;
    const popup = openLeaderboard({ container, userId: null, load: () => new Promise((done) => { resolve = done; }) });
    popup.close();
    resolve(boardOf(3, null));
    await flush();
    expect(popup.body.classList.contains("scroll-fade")).toBe(false);
    expect(popup.body.querySelector(".leaderboard__list")).toBeNull();
  });

  it("lists the players in rank order with their points and outposts, no Discord tags", async () => {
    await open(boardOf(3, null));
    const shown = rows();
    expect(shown.map((row) => row.querySelector(".leaderboard__rank")!.textContent)).toEqual(["#1", "#2", "#3"]);
    expect(shown[0]!.querySelector(".leaderboard__name")!.textContent).toBe("player1");
    expect(shown[0]!.querySelector(".leaderboard__points-value")!.textContent).toBe("245,566");
    // The outpost icon and the count, the words in its label.
    const held = shown[1]!.querySelector(".leaderboard__outposts")!;
    expect(held.textContent).toBe("2");
    expect(held.querySelector("img")!.dataset["icon"]).toBe("outpost");
    expect(outpostIcon(true)).toBe("outpostclassic");
    expect(outpostIcon(false)).toBe("outpost");
    expect(held.querySelector("img")!.getAttribute("aria-label")).toBe("2 outposts");
    expect(shown[0]!.classList.contains("leaderboard__row--medal-1")).toBe(true);
    expect(container.textContent).not.toContain("#1234");
  });

  it("shows no outpost icon or count for a player with none", async () => {
    await open(boardOf(3, null));
    expect(rows()[2]!.querySelector(".leaderboard__outposts")).toBeNull();
    expect(rows()[2]!.textContent).not.toContain("outpost");
  });

  it("shows the total, its split in the tooltip when outposts add to it", async () => {
    await open({
      ...boardOf(2, null),
      top: [
        rowOf(1, { empirePoints: 492_672_756, yardPoints: 479_849_665, outpostPoints: 12_823_091, outposts: 1 }),
        rowOf(2, { empirePoints: 400_000_000, yardPoints: 400_000_000, outpostPoints: 0, outposts: 0 }),
      ],
    });
    const [first, second] = rows();
    expect(first!.querySelector(".leaderboard__points-value")!.textContent).toBe("492,672,756");
    expect(first!.querySelector<HTMLElement>(".leaderboard__points")!.title).toBe("Main yard 479,849,665 + outposts 12,823,091");
    expect(second!.querySelector<HTMLElement>(".leaderboard__points")!.title).toBe("");
  });

  it("shows each player's face, their pick or their default", async () => {
    await open({ ...boardOf(2, null), top: [rowOf(1, { pic: "/avatars/frog.webp" }), rowOf(2)] });
    const faces = rows().map((row) => row.querySelector<HTMLImageElement>(".leaderboard__face")!.src);
    expect(faces[0]).toContain("avatars/frog-64.webp");
    expect(faces[1]).toMatch(/avatars\/[a-z]+-64\.webp$/);
  });

  it("shows a player's uploaded photo in place of their critter (owner, 13 Nov 2026)", async () => {
    await open({ ...boardOf(2, null), top: [rowOf(1, { pic: "/avatars/frog.webp", photo: 3 }), rowOf(2, { photo: null })] });
    const faces = rows().map((row) => row.querySelector<HTMLImageElement>(".leaderboard__face")!);
    expect(faces[0]!.src).toContain(`/profile/photos/${rowOf(1).userId}?v=3`);
    expect(faces[0]!.classList.contains("is-photo")).toBe(true);
    expect(faces[1]!.src).toMatch(/avatars\/[a-z]+-64\.webp$/);
    expect(faces[1]!.classList.contains("is-photo")).toBe(false);
  });

  it("lights up the player's own row in the top 100 and adds no You line", async () => {
    await open(boardOf(100, rowOf(42)), 1042);
    const mine = rows().filter((row) => row.classList.contains("leaderboard__row--you"));
    expect(mine.map((row) => row.dataset["rank"])).toEqual(["42"]);
    expect(mine[0]!.getAttribute("aria-current")).toBe("true");
    expect(container.querySelector(".leaderboard__you")).toBeNull();
  });

  it("below the top 100, shows a You: #N line with the player's own row", async () => {
    await open(boardOf(100, rowOf(1234, { name: "me" }), 2000), 2234);
    expect(rows().some((row) => row.classList.contains("leaderboard__row--you"))).toBe(false);
    const you = container.querySelector(".leaderboard__you")!;
    expect(you.querySelector(".leaderboard__you-label")!.textContent).toBe("You: #1,234");
    expect(you.querySelector(".leaderboard__name")!.textContent).toBe("me");
  });

  it("a player who is not on the board sees the list without a You line", async () => {
    await open(boardOf(5, null), 7);
    expect(container.querySelector(".leaderboard__you")).toBeNull();
    expect(container.querySelector(".leaderboard__row--you")).toBeNull();
  });

  it("says so when the board is empty", async () => {
    await open(boardOf(0, null));
    expect(container.querySelector(".leaderboard__empty")!.textContent).toBe(EMPTY);
  });

  it("says so when the board could not be loaded", async () => {
    await open(new Error("offline"));
    expect(container.querySelector(".leaderboard__status--error")!.textContent).toBe(LOAD_FAILED);
  });
});

describe("splitText", () => {
  it("works the main yard part out of an older board without it", () => {
    expect(splitText(rowOf(1, { empirePoints: 1500, outpostPoints: 500 }))).toBe("Main yard 1,000 + outposts 500");
    expect(splitText(rowOf(1, { empirePoints: 1500 }))).toBeNull();
  });
});

describe("outpostText", () => {
  it("counts one and many", () => {
    expect(outpostText(1)).toBe("1 outpost");
    expect(outpostText(0)).toBe("0 outposts");
    expect(outpostText(12)).toBe("12 outposts");
  });
});
