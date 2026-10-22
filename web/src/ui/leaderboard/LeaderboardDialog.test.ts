// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BoardRow, EmpireBoard } from "@/api/leaderboard";
import { EMPTY, LOAD_FAILED, openLeaderboard, outpostText } from "./LeaderboardDialog";

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
  container.remove();
});

describe("openLeaderboard", () => {
  it("lists the players in rank order with their points and outposts, no Discord tags", async () => {
    await open(boardOf(3, null));
    const shown = rows();
    expect(shown.map((row) => row.querySelector(".leaderboard__rank")!.textContent)).toEqual(["#1", "#2", "#3"]);
    expect(shown[0]!.querySelector(".leaderboard__name")!.textContent).toBe("player1");
    expect(shown[0]!.querySelector(".leaderboard__points-value")!.textContent).toBe("245,566");
    expect(shown[1]!.querySelector(".leaderboard__outposts")!.textContent).toBe("2 outposts");
    expect(shown[0]!.classList.contains("leaderboard__row--medal-1")).toBe(true);
    expect(container.textContent).not.toContain("#1234");
  });

  it("shows each player's face, their pick or their default", async () => {
    await open({ ...boardOf(2, null), top: [rowOf(1, { pic: "/avatars/frog.webp" }), rowOf(2)] });
    const faces = rows().map((row) => row.querySelector<HTMLImageElement>(".leaderboard__face")!.src);
    expect(faces[0]).toContain("avatars/frog-64.webp");
    expect(faces[1]).toMatch(/avatars\/[a-z]+-64\.webp$/);
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

describe("outpostText", () => {
  it("counts one and many", () => {
    expect(outpostText(1)).toBe("1 outpost");
    expect(outpostText(0)).toBe("0 outposts");
    expect(outpostText(12)).toBe("12 outposts");
  });
});
