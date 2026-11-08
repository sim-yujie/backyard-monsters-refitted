import "./admin.css";
import { restoreStoredSession } from "@/api/auth";
import { ApiError } from "@/api/http";
import { SESSION_STORAGE_KEY } from "@/config";
import {
  adoptNewerSignIn,
  failureKind,
  fetchAnnouncements,
  fetchBugReports,
  fetchHealth,
  fetchModerators,
  fetchMe,
  fetchOverview,
  type AdminHealthReport,
  type BugReportSummary,
  type DashboardSection,
  type InboxList,
  type StatsOverview,
} from "./api";
import { AnnouncementsView } from "./announcements";
import { AttackLogSection } from "./attacks";
import { BugsView } from "./bugs";
import { ChatPanel } from "./chat";
import { h, replace } from "./dom";
import { ErrorsView } from "./errors";
import { ModerationView } from "./moderation";
import { ModeratorsView } from "./moderators";
import { ModMailSection } from "./modmail";
import { homeSplitWords } from "./evidence";
import { ago, count, dateTime, plural } from "./format";
import { icon } from "./icons";
import { topItems, verdict, type TopItem } from "./problems";
import {
  mark,
  renderActivity,
  renderBackups,
  renderHealth,
  renderPlayers,
  type Level,
} from "./sections";
import { QueueView } from "./queue";
import { ShinyView } from "./shiny";
import { applyTheme, readTheme, themePicker } from "./theme";
import {
  PAGES,
  ScrollMemory,
  VIEWS,
  isView,
  pageHome,
  pageIcon,
  pageLabel,
  pageLede,
  pageOf,
  pageViews,
  readRoute,
  viewHash,
  viewLabel,
  type PageId,
  type ViewId,
  type ViewParams,
} from "./views";

/**
 * The owner's dashboard at /admin (docs/design/admin-dashboard-api.md). It
 * uses the game's sign-in from this browser. Anyone but the owner, signed in
 * or not, sees only "Not found", the same as any unknown page: the server
 * answers them 404 and the page shows nothing more.
 *
 * Six pages in the menu (owner, 8 Nov 2026, built on Codex astra's
 * mock-up): Home, Moderation, Player support, Announcements, Game activity
 * and Server health (`views.ts`). A page with several parts shows them as
 * tabs under its title; each part is a view the address names (`#errors`,
 * `#bugs?list=working`, `#moderation?player=12`), so the browser's Back goes
 * to the view before and a Telegram alert can link one (`#health`,
 * `#backups`, `#errors`, `#bugs`, or a report: `?bug=<id>`). A computer lists
 * the pages down the left; a phone has a Menu button that opens them in two
 * columns. Views stay in the page while hidden: a search typed, a filter
 * picked or a report opened is still there on coming back, and each view
 * keeps its scroll position. The menu carries each page's state (players
 * waiting on Moderation, new bug reports on Player support, a mark on Server
 * health when something there needs a look).
 */

/** Views whose tab shows the server's health marks. */
const HEALTH_MARK_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(["health", "backups", "errors"]);

/** Views with a list and an opened item side by side: they get a wider page. */
const WIDE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(["moderation", "bugs"]);

const RANGES = [
  [30, "30 days"],
  [90, "90 days"],
  [365, "1 year"],
] as const;

/** Health is checked again this often while the page is open and showing. */
const HEALTH_REFRESH_MS = 60_000;

export { readRoute };

/** The worst state among a section's problems, for its link and heading. */
export const sectionLevels = (
  items: readonly TopItem[],
): Partial<Record<DashboardSection, Level>> => {
  const levels: Partial<Record<DashboardSection, Level>> = {};
  for (const item of items) {
    if (levels[item.section] !== "bad") levels[item.section] = item.level;
  }
  return levels;
};

/** The plain page anyone but the owner gets. */
export const showNotFound = (): void => {
  document.title = "Not found";
  document.body.className = "notfound-body";
  replace(
    document.body,
    h(
      "main",
      { class: "notfound" },
      h("h1", {}, "Not found"),
      h("p", {}, "There is nothing at this address."),
      h("a", { attrs: { href: "/" } }, "Go to the game"),
    ),
  );
};

const skeleton = (lines = 3) =>
  h(
    "div",
    { class: "skeleton-group", attrs: { "aria-hidden": "true" } },
    ...Array.from({ length: lines }, () => h("div", { class: "skeleton" })),
  );

interface Section {
  element: HTMLElement;
  body: HTMLElement;
  state: HTMLElement;
}

type SectionId = Exclude<ViewId, "home">;

class Dashboard {
  private range: number = RANGES[0][0];
  private overview: StatsOverview | null = null;
  private readonly toast = h("div", { class: "toast", attrs: { role: "status", hidden: "" } });
  private readonly verdict = h(
    "section",
    { class: "verdict verdict-loading", attrs: { id: "problems", "aria-labelledby": "verdict-title" } },
    h("h2", { attrs: { id: "verdict-title" } }, "Checking the server…"),
    skeleton(2),
  );
  private readonly updated = h("span", { class: "updated" }, "Not checked yet");
  private readonly refreshButton: HTMLButtonElement;
  /** The last health check was refused this browser's sign-in. */
  private signedOut = false;
  private readonly bugs = new BugsView({
    onRoute: (id) => this.openBug(id),
    onList: (list) => this.openBugList(list),
    onError: (message) => this.say(message),
    onSay: (message) => this.say(message),
    onAward: () => void this.shiny.refresh(),
  });
  private readonly shiny = new ShinyView({
    openReport: (id) => this.openBug(id),
    say: (message) => this.say(message),
  });
  /** Find a player: any player's whole record and every tool (the old Moderation view). */
  private readonly moderation = new ModerationView({
    say: (message) => this.say(message),
    onChanged: () => void this.queue.refresh(),
  });
  private readonly moderators = new ModeratorsView({ say: (message) => this.say(message) });
  private readonly attacks = new AttackLogSection({
    say: (message) => this.say(message),
    navigate: ({ player, side, range }) => {
      location.hash = viewHash("attacks", { player, side: side === "both" ? null : side, range: range === "7d" ? null : range });
    },
    openPlayer: (userid) => this.openPlayer(userid),
  });
  private readonly modMail = new ModMailSection({
    say: (message) => this.say(message),
    onViewChange: () => undefined,
  });
  /** The Moderation list: player reports and word-filter catches, one row per player. */
  private readonly queue = new QueueView({
    say: (message) => this.say(message),
    onCount: (counts) => {
      this.inboxCounts = counts;
      this.renderInboxState();
      this.renderHomeNeeds();
    },
    onChanged: () => void this.moderation.refresh(),
    openPlayer: (userid) => this.openPlayer(userid),
    navigate: ({ filter, player, act, tab }) => {
      location.hash = viewHash("moderation", { filter: filter === "all" ? null : filter, player, act, tab });
    },
  });
  /** Players in the Moderation list, by list, or null before they are read. */
  private inboxCounts: InboxList["counts"] | null = null;
  private readonly chat = new ChatPanel({
    openPlayer: (userid) => this.openPlayer(userid),
    say: (message) => this.say(message),
  });
  private readonly announcements = new AnnouncementsView({ say: (message) => this.say(message) });
  private readonly errors = new ErrorsView((message) => this.say(message));
  private readonly sections: Record<SectionId, Section>;
  private readonly home: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly topbar: HTMLElement;
  /** Each page's menu link. */
  private readonly pageLinks = new Map<PageId, HTMLAnchorElement>();
  /** Each view's tab links under its page title: their state badges follow the view. */
  private readonly links = new Map<ViewId, HTMLAnchorElement[]>();
  private view: ViewId = "home";
  private readonly scrolls = new ScrollMemory();
  private newBugs: number | null = null;
  /** The newest new bug reports, for Home. */
  private newBugList: BugReportSummary[] = [];
  /** Whether the owner opened the status strip's problems. */
  private statusOpen: boolean | null = null;
  private readonly homeNeeds = h("div", { class: "two-cols", attrs: { id: "home-needs" } });
  private readonly todayBox = h("div", { class: "metrics", attrs: { "aria-label": "Today so far" } });
  private readonly aroundBox = h("div", { class: "panel", attrs: { id: "home-around" } });
  /** Which problems' "What to do" is open, kept across the minutely refresh. */
  private openFixes: Set<string> | null = null;
  private toastTimer = 0;

  constructor(username: string) {
    const rangeButtons = h(
      "div",
      { class: "segmented", attrs: { role: "group", "aria-label": "How far back the charts go" } },
      ...RANGES.map(([days, label]) =>
        h(
          "button",
          {
            class: "seg",
            attrs: {
              type: "button",
              "aria-pressed": String(days === this.range),
              "data-days": String(days),
            },
            onClick: () => void this.setRange(days),
          },
          label,
        ),
      ),
    );

    this.nav = h(
      "nav",
      { class: "nav", attrs: { id: "views-nav", "aria-label": "Pages" } },
      ...PAGES.map(([id]) => {
        const link = h(
          "a",
          { class: "nav-link", attrs: { href: viewHash(pageHome(id)), "data-page": id } },
          icon(pageIcon(id), 20),
          h("span", { class: "nav-label" }, pageLabel(id)),
          h("span", { class: "nav-state" }),
        );
        link.addEventListener("click", () => this.setMenu(false));
        this.pageLinks.set(id, link);
        return link;
      }),
    );
    this.menuButton = h(
      "button",
      {
        class: "button quiet menu-toggle",
        attrs: { type: "button", "aria-expanded": "false", "aria-controls": "views-nav" },
        onClick: () => this.setMenu(this.menuButton.getAttribute("aria-expanded") !== "true"),
      },
      icon("menu", 18),
      h("span", {}, "Menu"),
    );

    const section = (id: SectionId, ...extra: HTMLElement[]): Section => {
      const page = pageOf(id);
      const views = pageViews(page);
      const body = h("div", { class: "section-body", attrs: { id: `${id}-body` } }, skeleton());
      const state = h("span", { class: "section-state" });
      const subnav =
        views.length > 1
          ? h(
              "nav",
              { class: "subnav", attrs: { "aria-label": `${pageLabel(page)} parts` } },
              ...views.map((view) => {
                const link = h(
                  "a",
                  {
                    class: "subnav-link",
                    attrs: { href: viewHash(view), "data-view": view, ...(view === id ? { "aria-current": "page" } : {}) },
                  },
                  h("span", {}, viewLabel(view)),
                  h("span", { class: "nav-state" }),
                );
                const list = this.links.get(view) ?? [];
                list.push(link);
                this.links.set(view, list);
                return link;
              }),
            )
          : null;
      const element = h(
        "section",
        {
          class: `section view${WIDE_VIEWS.has(id) ? " is-wide" : ""}`,
          attrs: { id, "data-view": id, "data-page": page, "aria-labelledby": `${id}-title`, hidden: "" },
        },
        h(
          "header",
          { class: "page-heading" },
          h("h1", { attrs: { id: `${id}-title` } }, pageLabel(page), state, ...extra),
          pageLede(page) ? h("p", {}, pageLede(page)) : null,
          subnav,
        ),
        body,
      );
      return { element, body, state };
    };
    this.sections = {
      moderation: section("moderation"),
      find: section("find"),
      attacks: section("attacks"),
      moderators: section("moderators"),
      modmail: section("modmail"),
      bugs: section("bugs"),
      shiny: section("shiny"),
      chat: section("chat"),
      announcements: section("announcements"),
      players: section("players", rangeButtons),
      activity: section("activity"),
      health: section("health"),
      errors: section("errors"),
      backups: section("backups"),
    };
    replace(this.sections.moderation.body, this.queue.element);
    replace(this.sections.find.body, this.moderation.element);
    replace(this.sections.bugs.body, this.bugs.element);
    replace(this.sections.attacks.body, this.attacks.element);
    replace(this.sections.moderators.body, this.moderators.element);
    replace(this.sections.modmail.body, this.modMail.element);
    replace(this.sections.chat.body, this.chat.element);
    replace(this.sections.shiny.body, this.shiny.element);
    replace(this.sections.announcements.body, this.announcements.element);
    replace(this.sections.errors.body, this.errors.element);

    this.home = h(
      "section",
      { class: "view home", attrs: { id: "home", "data-view": "home", "aria-labelledby": "home-title", hidden: "" } },
      h(
        "header",
        { class: "page-heading" },
        h("h1", { attrs: { id: "home-title" } }, "Home"),
        h("p", {}, `Signed in as ${username}.`),
      ),
      h("h2", { class: "section-title" }, "What needs you now"),
      this.homeNeeds,
      h("div", { class: "health-summary" }, this.verdict),
      h("div", { class: "home-section" }, h("h2", { class: "section-title" }, "Today so far"), h("div", { class: "panel" }, this.todayBox)),
      h("div", { class: "home-section" }, h("h2", { class: "section-title" }, "Around the backyard"), this.aroundBox),
    );
    this.renderHomeNeeds();
    this.renderToday();
    this.renderAround(null, null);

    this.refreshButton = h(
      "button",
      {
        class: "button quiet refresh",
        attrs: { type: "button" },
        onClick: () => void this.loadAll(),
      },
      icon("refresh", 18),
      h("span", {}, "Refresh"),
    );
    this.topbar = h(
      "header",
      { class: "topbar" },
      h("span", { class: "mobile-brand" }, "BYMR dashboard"),
      h("span", { class: "desktop-meta small" }, `Signed in as ${username}`),
      h("div", { class: "top-actions" }, this.updated, this.refreshButton, themePicker(), this.menuButton),
    );

    document.title = "BYMR dashboard";
    document.body.className = "admin-body v2";
    replace(
      document.body,
      h(
        "div",
        { class: "shell" },
        h(
          "aside",
          { class: "side" },
          h("div", { class: "brand" }, h("strong", {}, "BYMR dashboard"), h("p", {}, "Backyard Monsters Revamped")),
          this.nav,
        ),
        h(
          "div",
          { class: "main-col" },
          this.topbar,
          h(
            "main",
            { class: "page" },
            this.home,
            ...VIEWS.filter(([id]) => id !== "home").map(([id]) => this.sections[id as SectionId].element),
          ),
        ),
      ),
      this.toast,
    );

    // The address names the view: a nav link, "See Server", a Telegram alert, Back.
    window.addEventListener("hashchange", () => this.route());
    window.addEventListener("popstate", () => this.route());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.setMenu(false);
    });
    window.setInterval(() => {
      if (document.visibilityState === "visible") void this.loadHealth();
    }, HEALTH_REFRESH_MS);
    // The game signing in again in another tab ends the token this page
    // started with and saves the new one; take it up straight away.
    window.addEventListener("storage", (event) => {
      if (event.key !== SESSION_STORAGE_KEY) return;
      if (adoptNewerSignIn() || this.signedOut) void this.loadAll();
    });
  }

  async start(): Promise<void> {
    const route = readRoute(location.search, location.hash);
    this.show(route.view, route.params);
    // The errors list loads with the stats, whose daily counts its charts use.
    await Promise.all([
      this.loadHealth(),
      this.loadStats(),
      this.queue.show(route.view === "moderation" ? route.params : {}),
      this.loadAround(),
      this.bugs.show(route.bug, route.view === "bugs" ? route.params : {}),
      this.moderation.refresh(),
      route.view === "attacks" ? this.attacks.show(route.params) : Promise.resolve(),
      this.moderators.refresh(),
      this.modMail.refresh(),
      this.shiny.refresh(),
      this.announcements.refresh(),
    ]);
  }

  /** Shows the view the address names, with what it asks for. */
  private route(): void {
    const route = readRoute(location.search, location.hash);
    this.show(route.view, route.params);
    if (route.view === "bugs") void this.bugs.show(route.bug, route.params);
    if (route.view === "moderation") void this.queue.show(route.params);
    if (route.view === "attacks") void this.attacks.show(route.params);
  }

  /**
   * Shows one view and hides the rest. Leaving a view keeps its scroll
   * position; coming back puts it back.
   */
  private show(view: ViewId, _params: ViewParams): void {
    const before = this.view;
    const changed = before !== view;
    if (changed) this.scrolls.save(before, window.scrollY);
    this.view = view;
    this.home.hidden = view !== "home";
    for (const [id] of VIEWS) {
      if (id !== "home") this.sections[id as SectionId].element.hidden = id !== view;
    }
    const page = pageOf(view);
    for (const [id, link] of this.pageLinks) {
      if (id === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    this.setMenu(false);
    document.title = view === "home" ? "BYMR dashboard" : `${viewLabel(view)} · BYMR dashboard`;
    if (changed) window.scrollTo?.(0, this.scrolls.restore(view));
  }

  /** Opens or closes the phone's menu of the six pages. */
  private setMenu(open: boolean): void {
    this.menuButton.setAttribute("aria-expanded", String(open));
    this.nav.closest(".side")?.classList.toggle("is-open", open);
  }

  /** Puts a state badge (or nothing) on a view's tab links. */
  private setBadge(view: ViewId, make: (() => Node) | null): void {
    for (const link of this.links.get(view) ?? []) {
      const badge = link.querySelector(".nav-state");
      if (!badge) continue;
      if (make) replace(badge, make());
      else replace(badge);
    }
  }

  /** Puts a state badge (or nothing) on a page's menu link. */
  private setPageBadge(page: PageId, make: (() => Node) | null): void {
    const badge = this.pageLinks.get(page)?.querySelector(".nav-state");
    if (!badge) return;
    if (make) replace(badge, make());
    else replace(badge);
  }

  private async loadAll(): Promise<void> {
    this.refreshButton.classList.add("is-busy");
    this.refreshButton.disabled = true;
    await Promise.all([
      this.loadHealth(),
      this.loadStats(),
      this.queue.refresh(),
      this.loadAround(),
      this.bugs.refresh(),
      this.moderation.refresh(),
      this.attacks.refresh(),
      this.moderators.refresh(),
      this.modMail.refresh(),
      this.shiny.refresh(),
    ]);
    this.refreshButton.classList.remove("is-busy");
    this.refreshButton.disabled = false;
    this.say("Up to date");
  }

  /** The players waiting in the Moderation list on its menu link, tab and heading. */
  private renderInboxState(): void {
    const open = this.inboxCounts?.all ?? null;
    const { state } = this.sections.moderation;
    if (open) {
      const text = String(open);
      const badge = () => h("span", { class: "count" }, text, h("span", { class: "sr-only" }, " waiting"));
      this.setBadge("moderation", badge);
      this.setPageBadge("moderation", badge);
      replace(state, h("span", { class: "chip chip-info" }, open === 1 ? "1 player" : `${text} players`));
    } else {
      this.setBadge("moderation", null);
      this.setPageBadge("moderation", null);
      replace(state);
    }
  }

  private say(message: string): void {
    this.toast.textContent = message;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 4000);
  }

  /** Opens a bug report (or the list) in the Bug reports view, as a step Back can undo. */
  private openBug(id: number | null): void {
    // The list stays in the address, so Back and a reload keep it; an alert's
    // `?bug=` is dropped, or it would open that report again.
    const list = this.bugs.currentList;
    history.pushState(null, "", `${location.pathname}${viewHash("bugs", { list, bug: id })}`);
    this.show("bugs", {});
    void this.bugs.show(id, { list });
  }

  /** Shows another bug list (closing the open report), as a step Back can undo. */
  private openBugList(list: string): void {
    history.pushState(null, "", `${location.pathname}${viewHash("bugs", { list })}`);
    this.show("bugs", {});
    void this.bugs.show(null, { list });
  }

  /** Opens a player in the Find a player view (a name clicked in the chat panel, a record's account link). */
  private openPlayer(userid: number): void {
    history.pushState(null, "", `${location.pathname}${viewHash("find")}`);
    this.show("find", {});
    void this.moderation.open(userid);
  }

  private async setRange(days: number): Promise<void> {
    this.range = days;
    for (const button of this.sections.players.element.querySelectorAll<HTMLButtonElement>(
      "[data-days]",
    )) {
      button.setAttribute("aria-pressed", String(button.dataset["days"] === String(days)));
    }
    await this.loadStats();
  }

  private async loadHealth(): Promise<void> {
    let report: AdminHealthReport;
    try {
      const [health, bugs] = await Promise.all([fetchHealth(), fetchBugReports("new").catch(() => null)]);
      report = health;
      this.newBugs = bugs ? bugs.reports.length : null;
      this.newBugList = bugs ? bugs.reports.slice(0, 1) : [];
      this.renderHomeNeeds();
    } catch (err) {
      this.showHealthFailure(err);
      return;
    }
    this.signedOut = false;
    this.renderVerdict(report);
    replace(this.sections.health.body, ...renderHealth(report));
    replace(this.sections.backups.body, ...renderBackups(report));
    this.updated.textContent = `Checked ${dateTime(report.health.generatedAt).split(" ").pop()}`;
  }

  /**
   * Why the health could not be read, in the owner's words. The server
   * refusing this browser's sign-in is not the server being down: it answered.
   */
  private showHealthFailure(err: unknown): void {
    const kind = failureKind(err);
    this.signedOut = kind === "signedOut";
    const tryAgain = h(
      "button",
      {
        class: kind === "signedOut" ? "button" : "button primary",
        attrs: { type: "button" },
        onClick: () => void this.loadAll(),
      },
      "Try again",
    );
    const [title, sub, actions] =
      kind === "signedOut"
        ? [
            "Your dashboard sign-in has run out",
            "The server is up, but it no longer accepts the sign-in saved in this browser. " +
              "The game keeps one sign-in per account, so opening the game or signing in again, " +
              "here or on another device, ends the one this page was using. " +
              "Sign in to the game in this browser and this page picks it up by itself.",
            [
              h(
                "a",
                { class: "button primary", attrs: { href: "/", target: "_blank", rel: "noopener" } },
                "Sign in again",
              ),
              tryAgain,
            ],
          ]
        : kind === "unreachable"
          ? [
              "The server could not be reached",
              "The game server may be down or restarting, or this device may be offline. " +
                "If players also cannot get in, it is down.",
              [tryAgain],
            ]
          : [
              "The server's health could not be read",
              "The server answered, but not with its health report.",
              [tryAgain],
            ];
    this.verdict.className = "verdict verdict-bad";
    replace(
      this.verdict,
      h(
        "div",
        { class: "verdict-head" },
        h("span", { class: "verdict-icon" }, icon("bad", 18)),
        h(
          "div",
          {},
          h("h2", { attrs: { id: "verdict-title" } }, title),
          h("p", { class: "verdict-sub" }, sub),
        ),
      ),
      h(
        "div",
        { class: "verdict-actions" },
        h("div", { class: "verdict-buttons" }, ...actions),
        h("p", { class: "note" }, String(err)),
      ),
    );
  }

  /** Each view's heading and links say whether something there needs a look. */
  private renderStates(items: readonly TopItem[]): void {
    const levels = sectionLevels(items) as Partial<Record<ViewId, Level>>;
    let server: Level | null = null;
    for (const [id] of VIEWS) {
      if (id === "home" || id === "moderation") continue;
      const { state } = this.sections[id];
      const level = HEALTH_MARK_VIEWS.has(id) ? levels[id] : undefined;
      if (level && server !== "bad") server = level;
      if (id === "bugs" && this.newBugs) {
        const text = this.newBugs >= 30 ? "30+" : String(this.newBugs);
        const badge = () => h("span", { class: "count" }, text, h("span", { class: "sr-only" }, " new"));
        this.setBadge(id, badge);
        this.setPageBadge("support", badge);
        replace(state, h("span", { class: "chip chip-info" }, `${text} new`));
        continue;
      }
      if (id === "bugs") this.setPageBadge("support", null);
      if (level) {
        this.setBadge(id, () => mark(level));
        replace(state, h("span", { class: `chip chip-${level}` }, level === "bad" ? "Needs you" : "Check"));
      } else {
        this.setBadge(id, null);
        replace(state);
      }
    }
    this.setPageBadge("server", server ? () => mark(server) : null);
  }

  /**
   * The server's state in one line at the top of Home (owner, 8 Nov 2026: the
   * big box took the page). Problems open on demand below it; the first real
   * problem's "What to do" is open inside.
   */
  private renderVerdict(report: AdminHealthReport): void {
    const items = topItems(report);
    const level: Level = items.some((item) => item.level === "bad")
      ? "bad"
      : items.length
        ? "warn"
        : "ok";
    this.renderStates(items);
    this.verdict.className = `verdict verdict-${level}`;

    // At first only the first real problem shows its fix; after that, what
    // the owner opened stays open when the strip is drawn again.
    const firstBad = items.find((item) => item.level === "bad")?.key;
    const open = this.openFixes ?? new Set(firstBad ? [firstBad] : []);
    this.openFixes = open;
    const shown = Boolean(this.statusOpen);
    const list = items.length
      ? h(
          "ol",
          { class: "issues", attrs: { id: "status-issues", ...(shown ? {} : { hidden: "" }) } },
          ...items.map((item) => this.issue(item, open.has(item.key))),
        )
      : null;
    const toggle = list
      ? h(
          "button",
          {
            class: "button quiet verdict-toggle",
            attrs: { type: "button", "aria-expanded": String(shown), "aria-controls": "status-issues" },
          },
          shown ? "Hide" : "What to do",
          icon("chevron", 16),
        )
      : null;
    toggle?.addEventListener("click", () => {
      this.statusOpen = !this.statusOpen;
      list!.hidden = !this.statusOpen;
      toggle.setAttribute("aria-expanded", String(this.statusOpen));
      replace(toggle, this.statusOpen ? "Hide" : "What to do", icon("chevron", 16));
    });

    replace(
      this.verdict,
      h(
        "div",
        { class: "verdict-head" },
        h("span", { class: "verdict-icon" }, icon(level, 18)),
        h("h2", { attrs: { id: "verdict-title" } }, verdict(items)),
        h(
          "span",
          { class: "verdict-sub" },
          level === "ok" ? "Game server, database, disk and backups look right." : "Checked every minute.",
        ),
        toggle,
        level === "ok"
          ? h("a", { class: "verdict-link", attrs: { href: "#health" } }, "Server", icon("chevron", 16))
          : null,
      ),
      list,
    );
  }

  /** One problem: what, what it means, and (opened for the first real problem) what to do. */
  private issue(item: TopItem, open: boolean): HTMLElement {
    const steps = item.steps.length
      ? h(
          "details",
          { class: "fix", attrs: open ? { open: "" } : {} },
          h("summary", {}, "What to do"),
          h(
            "ol",
            { class: "steps" },
            ...item.steps.map((step) =>
              h(
                "li",
                {},
                h("span", {}, step.text),
                step.command ? this.command(step.command) : null,
              ),
            ),
          ),
          h("p", { class: "note" }, "Type these on the server, in /opt/bymr/server."),
        )
      : null;
    steps?.addEventListener("toggle", () => {
      if (steps.open) this.openFixes?.add(item.key);
      else this.openFixes?.delete(item.key);
    });
    const sectionName = isView(item.section) ? viewLabel(item.section) : "Server";
    return h(
      "li",
      { class: `issue issue-${item.level}` },
      mark(item.level),
      h(
        "div",
        { class: "issue-text" },
        h("strong", { class: "issue-title" }, item.title),
        h("p", { class: "issue-detail" }, item.detail),
        steps,
        h(
          "a",
          { class: "issue-link", attrs: { href: `#${item.section}` } },
          `See ${sectionName}`,
          icon("chevron", 16),
        ),
      ),
    );
  }

  /** A command to type, with a button that copies it. */
  private command(text: string): HTMLElement {
    return h(
      "div",
      { class: "command" },
      h("code", {}, text),
      h(
        "button",
        {
          class: "copy",
          attrs: { type: "button", "aria-label": `Copy: ${text}` },
          onClick: () => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => this.say("Copied"))
              .catch(() => this.say("Could not copy; select it instead"));
          },
        },
        icon("copy", 16),
      ),
    );
  }

  /** Today's numbers, each from the server's own daily counts. */
  private renderToday(): void {
    const o = this.overview;
    const metric = (href: string, value: string, label: string) =>
      h("a", { class: "metric", attrs: { href } }, h("strong", {}, value), h("span", {}, label));
    replace(
      this.todayBox,
      metric("#players", count(o?.players.activeToday), "players today"),
      metric("#players", count(o?.today.newPlayers), "new players"),
      metric("#activity", count(o?.today.attacks), "attacks"),
      metric("#bugs", count(o?.today.bugReports), "bug reports"),
    );
  }

  /**
   * "What needs you now": the players waiting in Moderation (each player once,
   * split by where they came from, the two parts adding up to the total) and
   * the newest new bug report.
   */
  private renderHomeNeeds(): void {
    const counts = this.inboxCounts;
    const total = counts?.all ?? null;
    const bug = this.newBugList[0] ?? null;
    const card = (href: string, iconName: "shield" | "support", title: string, sub: string, line: string | null, link: string) =>
      h(
        "a",
        { class: "panel needs-card", attrs: { href } },
        h("span", { class: "needs-icon" }, icon(iconName, 22)),
        h(
          "span",
          { class: "needs-text" },
          h("h3", {}, title),
          h("p", { class: "small" }, sub),
          line ? h("p", { class: "needs-line" }, line) : null,
          h("span", { class: "text-link" }, link),
        ),
        h("span", { class: "arrow" }, icon("arrow", 20)),
      );
    replace(
      this.homeNeeds,
      card(
        viewHash("moderation"),
        "shield",
        total === null ? "Players to review" : total === 0 ? "Nobody to review" : `${plural(total, "player")} to review`,
        counts ? homeSplitWords(counts) : "Not read yet",
        null,
        "Open Moderation",
      ),
      card(
        bug ? viewHash("bugs", { bug: bug.id }) : viewHash("bugs"),
        "support",
        this.newBugs === null ? "Bug reports" : this.newBugs === 0 ? "No new bug reports" : `${plural(this.newBugs >= 30 ? 30 : this.newBugs, "new bug report")}${this.newBugs >= 30 ? "+" : ""}`,
        bug ? `Newest from ${bug.username ?? "a signed-out player"}, ${ago(bug.createdAt)}` : "Reports from the game’s Help button",
        bug ? `“${bug.preview}”` : null,
        bug ? "Open the report" : "Open Player support",
      ),
    );
  }

  /** Live announcements and the chat moderators, for Home. */
  private async loadAround(): Promise<void> {
    const [announcements, moderators] = await Promise.all([
      fetchAnnouncements().then((a) => a.announcements.filter((x) => x.live)).catch(() => null),
      fetchModerators().then((a) => a.moderators.length).catch(() => null),
    ]);
    this.renderAround(announcements, moderators);
  }

  private renderAround(live: { id: number; title: string; endsAt: string | null }[] | null, moderators: number | null): void {
    const row = (href: string, title: string, line: string) =>
      h("a", { class: "info-row", attrs: { href } }, h("span", {}, h("h3", {}, title), h("p", {}, line)), icon("chevron", 16));
    replace(
      this.aroundBox,
      row(
        "#announcements",
        live === null ? "Announcements" : live.length ? plural(live.length, "live announcement") : "No live announcement",
        live?.length ? live.map((a) => `“${a.title}”${a.endsAt ? ` until ${dateTime(a.endsAt)}` : ""}`).join(" · ") : "Players see nothing new when they open the game.",
      ),
      row(
        "#moderators",
        moderators === null ? "Chat moderators" : plural(moderators, "chat moderator"),
        "Players whose chat lines carry the [Mod] badge.",
      ),
    );
  }

  private async loadStats(): Promise<void> {
    const charts = [this.sections.players.body, this.sections.activity.body];
    for (const body of charts) body.classList.add("is-loading");
    try {
      this.overview = await fetchOverview(this.range);
    } catch (err) {
      this.say(`Player numbers could not be loaded: ${String(err)}`);
      return;
    } finally {
      for (const body of charts) body.classList.remove("is-loading");
    }
    replace(this.sections.players.body, ...renderPlayers(this.overview));
    replace(this.sections.activity.body, ...renderActivity(this.overview));
    // The box at the top shows today's numbers too.
    this.renderToday();
    this.errors.setDays(this.overview.days);
    await this.errors.refresh();
  }
}

/** Opens the dashboard for the owner, or "Not found" for anyone else. */
export const boot = async (): Promise<void> => {
  // Light or dark first, so nothing flashes in the other one.
  applyTheme(readTheme(), false);
  if (!restoreStoredSession()) {
    showNotFound();
    return;
  }
  let username: string;
  try {
    username = (await fetchMe()).username;
  } catch (err) {
    if (err instanceof ApiError || !navigator.onLine) {
      showNotFound();
      return;
    }
    document.body.className = "notfound-body";
    replace(
      document.body,
      h(
        "main",
        { class: "notfound" },
        h("h1", {}, "Could not reach the server"),
        h("p", {}, "Check the connection and try again."),
        h(
          "button",
          { class: "button primary", attrs: { type: "button" }, onClick: () => location.reload() },
          "Try again",
        ),
      ),
    );
    return;
  }
  await new Dashboard(username).start();
};
