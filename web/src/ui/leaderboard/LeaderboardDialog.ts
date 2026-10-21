import { getEmpireBoard, type BoardRow, type EmpireBoard } from "@/api/leaderboard";
import { avatarOf, avatarUrl } from "@/game/avatars";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import "./leaderboard.css";

/**
 * The leaderboard (beta.4): every player ranked by empire points, the
 * original's score (yard points + base value), with their Map Room 2
 * outposts. The top 100 in a list, the player's own row lit up; a player
 * below the top 100 gets a "You: #N" line under it. Opened from the Account
 * menu's "Leaderboard" item. The server keeps each board a few minutes
 * (`server/src/services/leaderboard/empireBoard.ts`).
 */

export const LOAD_FAILED = "Could not load the leaderboard. Try again in a moment.";
export const EMPTY = "Nobody is on the board yet.";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** "1 outpost", "3 outposts". */
export const outpostText = (count: number): string => `${formatAmount(count)} ${count === 1 ? "outpost" : "outposts"}`;

const row = (item: BoardRow, mine: boolean): HTMLLIElement => {
  const line = el("li", "leaderboard__row");
  if (item.rank <= 3) line.classList.add(`leaderboard__row--medal-${item.rank}`);
  if (mine) {
    line.classList.add("leaderboard__row--you");
    line.setAttribute("aria-current", "true");
  }
  line.dataset["rank"] = String(item.rank);

  const face = el("img", "leaderboard__face");
  face.src = avatarUrl(avatarOf(item.pic, item.userId), "small");
  face.alt = "";
  face.decoding = "async";
  face.loading = "lazy";

  const words = el("div", "leaderboard__who");
  words.append(el("span", "leaderboard__name", item.name), el("span", "leaderboard__outposts", outpostText(item.outposts)));

  const points = el("span", "leaderboard__points");
  points.append(el("span", "leaderboard__points-value", formatAmount(item.empirePoints)), el("span", "leaderboard__points-unit", "pts"));

  line.append(el("span", "leaderboard__rank", `#${item.rank}`), face, words, points);
  return line;
};

/** The board's body: the list, and the "You" line when the player is below it. */
export const boardContent = (board: EmpireBoard, userId: number | null): HTMLElement => {
  const body = el("div", "leaderboard");
  body.append(el("p", "leaderboard__intro", "Ranked by empire points: your yard's points plus what its buildings are worth."));
  if (board.top.length === 0) {
    body.append(el("p", "leaderboard__empty", EMPTY));
    return body;
  }
  const mineRank = board.you?.rank ?? null;
  const list = el("ol", "leaderboard__list");
  list.append(...board.top.map((item) => row(item, item.rank === mineRank || item.userId === userId)));
  body.append(list);

  const inTop = mineRank !== null && board.top.some((item) => item.rank === mineRank);
  if (board.you && !inTop) {
    const you = el("div", "leaderboard__you");
    you.append(el("span", "leaderboard__you-label", `You: #${formatAmount(board.you.rank)}`));
    const own = el("ol", "leaderboard__list leaderboard__list--you");
    own.append(row(board.you, true));
    you.append(own);
    body.append(you);
  }
  return body;
};

export interface LeaderboardOptions {
  /** Where the popup mounts: the modal layer. */
  readonly container: HTMLElement;
  /** The signed-in player, for lighting up their row. */
  readonly userId: number | null;
  /** The board's request; the server's by default. */
  readonly load?: () => Promise<EmpireBoard>;
  readonly onClose?: () => void;
}

/** Opens the leaderboard: a loading line until the board arrives, then the list. */
export const openLeaderboard = (options: LeaderboardOptions): Popup => {
  const popup = new Popup({
    title: "Leaderboard",
    className: "leaderboard-popup",
    ...(options.onClose && { onClose: options.onClose }),
  });
  const waiting = el("div", "leaderboard");
  waiting.append(el("p", "leaderboard__status", "Loading the leaderboard…"));
  popup.setContent(waiting).mount(options.container);

  void (options.load ?? getEmpireBoard)()
    .then((board) => {
      popup.setContent(boardContent(board, options.userId));
      // The player's own row in view, without moving the page behind.
      popup.element.querySelector<HTMLElement>(".leaderboard__list .leaderboard__row--you")?.scrollIntoView?.({ block: "nearest" });
    })
    .catch(() => {
      const failed = el("div", "leaderboard");
      failed.append(el("p", "leaderboard__status leaderboard__status--error", LOAD_FAILED));
      popup.setContent(failed);
    });
  return popup;
};
