import type { IconName } from "./icons";

/**
 * The dashboard's pages (owner, 8 Nov 2026: rebuilt on Codex astra's
 * mock-up). Six destinations in the menu: Home, Moderation, Player support,
 * Announcements, Game activity, Server health. A page with more than one
 * part shows its parts as tabs under its title; each part is a view, and the
 * address names the view, so a view can be linked and the browser's Back goes
 * to the view before:
 *
 * - `#errors`: a view.
 * - `#bugs?list=working`: a view with what it should show.
 * - `#support`: a page, shown at its first view.
 * - `?bug=12` (a Telegram alert's link, kept from before): the bug report, in
 *   the Bug reports view.
 * - `#inbox`, `#cases` (older links): the Moderation list.
 *
 * Views stay in the page while hidden, so what was typed, picked or opened in
 * one is still there on coming back; the scroll position is kept per view
 * ({@link ScrollMemory}).
 *
 * Slots kept for beta 7's two extra views: Photo reports (player profile
 * photos) goes under Moderation, after the list; Weekend events goes under
 * Announcements. Add the view to {@link VIEWS} with that page and it shows as
 * a tab there.
 */

export const PAGES = [
  ["home", "Home", "home", ""],
  ["moderation", "Moderation", "shield", "Review flagged chat, read the player’s history, then choose an action."],
  ["support", "Player support", "support", "Help players with bugs, gifts and conversations."],
  ["announcements", "Announcements", "announce", "Write a message for players and see how it will look in the game."],
  ["activity", "Game activity", "chart", "Player numbers and gameplay in one place."],
  ["server", "Server health", "server", "Game services, backups and errors."],
] as const satisfies readonly (readonly [string, string, IconName, string])[];

export type PageId = (typeof PAGES)[number][0];

/** Every view: its id, its tab's name, and its page. A page opens at its first view. */
export const VIEWS = [
  ["home", "Home", "home"],
  ["moderation", "Review", "moderation"],
  ["find", "Find a player", "moderation"],
  ["attacks", "Attack log", "moderation"],
  ["moderators", "Moderators", "moderation"],
  ["modmail", "Moderator mail", "moderation"],
  ["bugs", "Bug reports", "support"],
  ["shiny", "Give Shiny", "support"],
  ["chat", "Game chat", "support"],
  ["announcements", "Announcements", "announcements"],
  ["players", "Players", "activity"],
  ["activity", "Gameplay", "activity"],
  ["health", "Server", "server"],
  ["errors", "Errors", "server"],
  ["backups", "Backups", "server"],
] as const satisfies readonly (readonly [string, string, PageId])[];

export type ViewId = (typeof VIEWS)[number][0];

/** Older addresses, and page names that are not a view themselves. */
const ALIASES: Readonly<Record<string, ViewId>> = {
  inbox: "moderation",
  cases: "moderation",
  support: "bugs",
  server: "health",
};

export const isView = (name: string): name is ViewId => VIEWS.some(([id]) => id === name);

export const viewLabel = (id: ViewId): string => VIEWS.find(([v]) => v === id)![1];

export const pageOf = (id: ViewId): PageId => VIEWS.find(([v]) => v === id)![2];

export const pageLabel = (id: PageId): string => PAGES.find(([p]) => p === id)![1];

export const pageIcon = (id: PageId): IconName => PAGES.find(([p]) => p === id)![2];

export const pageLede = (id: PageId): string => PAGES.find(([p]) => p === id)![3];

/** A page's views, in tab order. */
export const pageViews = (id: PageId): ViewId[] => VIEWS.filter(([, , page]) => page === id).map(([v]) => v);

/** The view a page's menu link opens. */
export const pageHome = (id: PageId): ViewId => pageViews(id)[0]!;

export type ViewParams = Readonly<Record<string, string>>;

export interface Route {
  view: ViewId;
  /** What the view should show: `list=working`, `player=12`. */
  params: ViewParams;
  /** A bug report to open (`?bug=12`, or `#bugs?bug=12`). */
  bug: number | null;
}

const wholeId = (raw: string | null | undefined): number | null => {
  const n = Number(raw);
  return raw && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * What the address asks for. An unknown or empty hash is Home, unless the
 * address names a bug report (then Bug reports).
 */
export const readRoute = (search: string, hash: string): Route => {
  const raw = hash.replace(/^#/, "");
  const at = raw.indexOf("?");
  const name = at >= 0 ? raw.slice(0, at) : raw;
  const params: Record<string, string> = {};
  if (at >= 0) {
    for (const [key, value] of new URLSearchParams(raw.slice(at + 1))) params[key] = value;
  }
  const bug = wholeId(params["bug"]) ?? wholeId(new URLSearchParams(search).get("bug"));
  delete params["bug"];
  const named = isView(name) ? name : (ALIASES[name] ?? null);
  const view: ViewId = named ?? (bug !== null ? "bugs" : "home");
  return { view, params, bug: view === "bugs" ? bug : null };
};

/** The hash for a view with what it should show: `#bugs?list=working`. Empty values are left out. */
export const viewHash = (view: ViewId, params: Readonly<Record<string, string | number | null | undefined>> = {}): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return `#${view}${text ? `?${text}` : ""}`;
};

/** Each view's scroll position, kept while the owner is in another view. */
export class ScrollMemory {
  private readonly at = new Map<ViewId, number>();

  save(view: ViewId, y: number): void {
    this.at.set(view, Math.max(0, Math.round(y)));
  }

  /** Where to put the page on coming back to a view: where it was, or the top. */
  restore(view: ViewId): number {
    return this.at.get(view) ?? 0;
  }
}
