/**
 * The dashboard's pages (owner, 8 Nov 2026: "horrible" to find your way in).
 * Each main task is its own view instead of one long scrolling page: a left
 * list on a computer, four tabs on a phone (Home, Moderation, Bugs, More).
 * The address names the view, so a view can be linked, and the browser's Back
 * goes to the view before:
 *
 * - `#errors`: a view.
 * - `#bugs?list=working`: a view with what it should show.
 * - `?bug=12` (a Telegram alert's link, kept from before): the bug report, in
 *   the Bug reports view.
 *
 * Views stay in the page while hidden, so what was typed, picked or opened in
 * one is still there on coming back; the scroll position is kept per view
 * ({@link ScrollMemory}).
 */

export const VIEWS = [
  ["home", "Home", ""],
  ["cases", "Chat cases", "Moderation"],
  ["photos", "Photo reports", "Moderation"],
  ["moderation", "Find a player", "Moderation"],
  ["moderators", "Moderators", "Moderation"],
  ["modmail", "Moderator mail", "Moderation"],
  ["bugs", "Bug reports", "Players"],
  ["chat", "Chat", "Players"],
  ["shiny", "Shiny", "Players"],
  ["announcements", "Announcements", "Players"],
  ["weekend", "Weekend events", "Players"],
  ["players", "Players", "Monitoring"],
  ["activity", "Activity", "Monitoring"],
  ["errors", "Errors", "Monitoring"],
  ["health", "Server", "Monitoring"],
  ["backups", "Backups", "Monitoring"],
] as const;

export type ViewId = (typeof VIEWS)[number][0];

/** The phone's tabs; every other view is under More. */
export const PHONE_TABS: readonly ViewId[] = ["home", "cases", "bugs"];

export const isView = (name: string): name is ViewId => VIEWS.some(([id]) => id === name);

export const viewLabel = (id: ViewId): string => VIEWS.find(([v]) => v === id)![1];

/** The nav's groups in order, each with its views. */
export const viewGroups = (): { title: string; views: ViewId[] }[] => {
  const groups: { title: string; views: ViewId[] }[] = [];
  for (const [id, , group] of VIEWS) {
    const last = groups[groups.length - 1];
    if (last && last.title === group) last.views.push(id);
    else groups.push({ title: group, views: [id] });
  }
  return groups;
};

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
  const view: ViewId = isView(name) ? name : bug !== null ? "bugs" : "home";
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

/** The tab a phone marks for a view: its own, or More. */
export const phoneTab = (view: ViewId): ViewId | "more" => (PHONE_TABS.includes(view) ? view : "more");

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
