import "./admin.css";
import { restoreStoredSession } from "@/api/auth";
import { ApiError } from "@/api/http";
import { SESSION_STORAGE_KEY } from "@/config";
import {
  adoptNewerSignIn,
  failureKind,
  fetchBugReports,
  fetchHealth,
  fetchMe,
  fetchInbox,
  fetchOverview,
  type AdminHealthReport,
  type BugReportSummary,
  type InboxPlayer,
  type DashboardSection,
  type InboxList,
  type StatsOverview,
} from "./api";
import { AnnouncementsView } from "./announcements";
import { BugsView } from "./bugs";
import { CasesView } from "./cases";
import { PhotosView } from "./photos";
import { ChatPanel } from "./chat";
import { h, replace } from "./dom";
import { ErrorsView } from "./errors";
import { InboxView, inboxLabel } from "./inbox";
import { ModerationView } from "./moderation";
import { ModeratorsView } from "./moderators";
import { ModMailSection } from "./modmail";
import { ago, count, dateTime } from "./format";
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
import { ShinyView } from "./shiny";
import { WeekendView } from "./weekend";
import { applyTheme, readTheme, themePicker } from "./theme";
import {
  PHONE_TABS,
  ScrollMemory,
  VIEWS,
  phoneTab,
  isView,
  readRoute,
  viewGroups,
  viewHash,
  viewLabel,
  type ViewId,
  type ViewParams,
} from "./views";

/**
 * The owner's dashboard at /admin (docs/design/admin-dashboard-api.md). It
 * uses the game's sign-in from this browser. Anyone but the owner, signed in
 * or not, sees only "Not found", the same as any unknown page: the server
 * answers them 404 and the page shows nothing more.
 *
 * Each main task is its own view (`views.ts`, owner 8 Nov 2026): Home first,
 * then the moderation views, the player-facing tools, and monitoring last.
 * A computer lists them down the left; a phone has four tabs (Home,
 * Moderation, Bugs, More) at the top. The address names the view (`#errors`,
 * `#bugs?list=working`), so the browser's Back goes to the view before and a
 * Telegram alert can link one (`#health`, `#backups`, `#errors`, `#bugs`, or a
 * report: `?bug=<id>`). Views stay in the page while hidden: a search typed,
 * a filter picked or a report opened is still there on coming back, and each
 * view keeps its scroll position. Each nav link carries its view's state (a
 * count of open cases or new bug reports, a mark when something there needs
 * a look).
 */

/** The phone tabs' own names. */
const TAB_WORDS: Readonly<Partial<Record<ViewId | "more", string>>> & { more: string } = {
  home: "Home",
  inbox: "Moderation",
  bugs: "Bugs",
  more: "More",
};

/** Views whose nav link never shows the server's health marks. */
const NO_HEALTH_MARK: ReadonlySet<ViewId> = new Set<ViewId>([
  "home",
  "inbox",
  "cases",
  "photos",
  "players",
  "activity",
  "shiny",
  "announcements",
  "weekend",
  "moderation",
  "moderators",
  "modmail",
  "chat",
]);

/** Views with a list and an opened item side by side: they get a wider page. */
const WIDE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(["inbox", "bugs"]);

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

/** A number and its words, linking to where they come from. */
const homeLink = (href: string, value: string, label: string): HTMLElement =>
  h(
    "a",
    { class: "today-link", attrs: { href } },
    h("span", { class: "today-value" }, value),
    h("span", { class: "today-label" }, label),
  );

/** One row on a Home card: who, how long ago, and a line about it. */
const homeRow = (href: string, who: string, at: string, line: string): HTMLElement =>
  h(
    "li",
    {},
    h(
      "a",
      { class: "row home-row", attrs: { href } },
      h(
        "span",
        { class: "row-main" },
        h(
          "span",
          { class: "row-top" },
          h("strong", {}, who),
          h("time", { class: "row-when", attrs: { datetime: at, title: dateTime(at) } }, ago(at)),
        ),
        h("span", { class: "row-meta home-line" }, line),
      ),
      icon("chevron", 16),
    ),
  );

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
  private readonly moderation = new ModerationView({
    say: (message) => this.say(message),
    onChanged: () => {
      void this.inbox.refresh();
      void this.loadHomeInbox();
    },
  });
  private readonly weekend = new WeekendView({ say: (message) => this.say(message) });
  private readonly moderators = new ModeratorsView({ say: (message) => this.say(message) });
  private readonly modMail = new ModMailSection({
    say: (message) => this.say(message),
    onViewChange: () => undefined,
  });
  private readonly cases = new CasesView({
    say: (message) => this.say(message),
    onCount: (open) => {
      this.openCases = open;
      this.renderCaseState();
      this.renderToday();
    },
    openPlayer: (userid) => this.openPlayer(userid),
    onChanged: () => {
      void this.moderation.refresh();
      void this.inbox.refresh();
      void this.loadHomeInbox();
    },
  });
  private readonly inbox = new InboxView({
    say: (message) => this.say(message),
    onCount: (counts) => {
      this.inboxCounts = counts;
      this.renderInboxState();
      this.renderHomeInbox();
    },
    onChanged: () => {
      void this.cases.refresh();
      void this.moderation.refresh();
      void this.loadHomeInbox();
    },
    openAward: (caseId) => {
      history.pushState(null, "", `${location.pathname}${viewHash("cases")}`);
      this.show("cases", {});
      void this.cases.openAward(caseId);
    },
    openPlayer: (userid) => this.openPlayer(userid),
    navigate: ({ source, player }) => {
      location.hash = viewHash("inbox", { source: source === "all" ? null : source, player });
    },
  });
  /** Players in the moderation inbox, by source, or null before they are read. */
  private inboxCounts: InboxList["counts"] | null = null;
  /** Open chat cases, or null before they are read. */
  private openCases: number | null = null;
  private readonly photos = new PhotosView({
    say: (message) => this.say(message),
    onCount: (open) => {
      this.openPhotos = open;
      this.renderPhotoState();
      this.renderHomeInbox();
    },
    openPlayer: (userid) => this.openPlayer(userid),
  });
  /** Players with open photo reports, or null before they are read. */
  private openPhotos: number | null = null;
  private readonly chat = new ChatPanel({
    openPlayer: (userid) => this.openPlayer(userid),
    say: (message) => this.say(message),
  });
  private readonly announcements = new AnnouncementsView({ say: (message) => this.say(message) });
  private readonly errors = new ErrorsView((message) => this.say(message));
  private readonly sections: Record<SectionId, Section>;
  private readonly home: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly moreButton: HTMLButtonElement;
  /** Every nav link and phone tab of each view: their state badges follow the view. */
  private readonly links = new Map<ViewId, HTMLAnchorElement[]>();
  private view: ViewId = "home";
  private readonly scrolls = new ScrollMemory();
  private newBugs: number | null = null;
  /** The newest new bug reports, for Home. */
  private newBugList: BugReportSummary[] = [];
  private workingBugs: number | null = null;
  /** The first players in the inbox, for Home; null before they are read. */
  private homeInboxRows: InboxPlayer[] | null = null;
  /** Whether the owner opened the status strip's problems. */
  private statusOpen: boolean | null = null;
  private readonly homeInbox = h("section", { class: "home-card", attrs: { id: "home-inbox", "aria-labelledby": "home-inbox-title" } });
  private readonly homeBugs = h("section", { class: "home-card", attrs: { id: "home-bugs", "aria-labelledby": "home-bugs-title" } });
  private readonly todayBox = h("div", { class: "today", attrs: { "aria-label": "Today so far" } });
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

    const addLink = (id: ViewId, link: HTMLAnchorElement) => {
      const list = this.links.get(id) ?? [];
      list.push(link);
      this.links.set(id, list);
    };
    this.nav = h(
      "nav",
      { class: "nav", attrs: { id: "views-nav", "aria-label": "Views" } },
      ...viewGroups().map(({ title, views }) =>
        h(
          "div",
          { class: "nav-group" },
          title ? h("h2", { class: "nav-title" }, title) : null,
          h(
            "ul",
            {},
            ...views.map((id) => {
              const link = h(
                "a",
                { class: "nav-link", attrs: { href: viewHash(id), "data-view": id } },
                h("span", { class: "nav-label" }, viewLabel(id)),
                h("span", { class: "nav-state" }),
              );
              link.addEventListener("click", () => this.setMenu(false));
              addLink(id, link);
              return h("li", {}, link);
            }),
          ),
        ),
      ),
    );
    this.moreButton = h(
      "button",
      {
        class: "tab tab-more",
        attrs: { type: "button", "aria-expanded": "false", "aria-controls": "views-nav" },
        onClick: () => this.setMenu(this.moreButton.getAttribute("aria-expanded") !== "true"),
      },
      icon("menu", 18),
      h("span", { class: "tab-label" }, TAB_WORDS.more),
    );
    this.tabs = h(
      "nav",
      { class: "tabs", attrs: { "aria-label": "Main views" } },
      ...PHONE_TABS.map((id) => {
        const tab = h(
          "a",
          { class: "tab", attrs: { href: viewHash(id), "data-view": id } },
          h("span", { class: "tab-label" }, TAB_WORDS[id] ?? viewLabel(id)),
          h("span", { class: "nav-state" }),
        );
        tab.addEventListener("click", () => this.setMenu(false));
        addLink(id, tab);
        return tab;
      }),
      this.moreButton,
    );

    const section = (id: SectionId, title: string, ...extra: HTMLElement[]): Section => {
      const body = h("div", { class: "section-body", attrs: { id: `${id}-body` } }, skeleton());
      const state = h("span", { class: "section-state" });
      const element = h(
        "section",
        {
          class: `section view${WIDE_VIEWS.has(id) ? " is-wide" : ""}`,
          attrs: { id, "data-view": id, "aria-labelledby": `${id}-title`, hidden: "" },
        },
        h(
          "header",
          { class: "section-head" },
          h("h2", { attrs: { id: `${id}-title` } }, title),
          state,
          ...extra,
        ),
        body,
      );
      return { element, body, state };
    };
    this.sections = {
      inbox: section("inbox", "Moderation inbox"),
      cases: section("cases", "Chat cases"),
      photos: section("photos", "Photo reports"),
      bugs: section("bugs", "Bug reports"),
      moderation: section("moderation", "Moderation"),
      moderators: section("moderators", "Chat moderators"),
      modmail: section("modmail", "Moderator mail"),
      chat: section("chat", "Chat as the game team"),
      shiny: section("shiny", "Give Shiny"),
      announcements: section("announcements", "Announcements"),
      weekend: section("weekend", "Weekend events"),
      players: section("players", "Players", rangeButtons),
      activity: section("activity", "Activity"),
      errors: section("errors", "Errors"),
      health: section("health", "Server"),
      backups: section("backups", "Backups"),
    };
    replace(this.sections.inbox.body, this.inbox.element);
    replace(this.sections.cases.body, this.cases.element);
    replace(this.sections.photos.body, this.photos.element);
    replace(this.sections.bugs.body, this.bugs.element);
    replace(this.sections.moderation.body, this.moderation.element);
    replace(this.sections.moderators.body, this.moderators.element);
    replace(this.sections.modmail.body, this.modMail.element);
    replace(this.sections.chat.body, this.chat.element);
    replace(this.sections.shiny.body, this.shiny.element);
    replace(this.sections.announcements.body, this.announcements.element);
    replace(this.sections.weekend.body, this.weekend.element);
    replace(this.sections.errors.body, this.errors.element);

    this.home = h(
      "section",
      { class: "view home", attrs: { id: "home", "data-view": "home", "aria-label": "Home", hidden: "" } },
      this.verdict,
      h("h2", { class: "home-title" }, "Needs you"),
      h("div", { class: "home-cards" }, this.homeInbox, this.homeBugs),
      h("h2", { class: "home-title" }, "Today"),
      this.todayBox,
    );
    this.renderHomeInbox();
    this.renderHomeBugs();
    this.renderToday();

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

    document.title = "BYMR dashboard";
    document.body.className = "admin-body";
    replace(
      document.body,
      h(
        "div",
        { class: "shell" },
        h(
          "div",
          { class: "side" },
          h(
            "header",
            { class: "top" },
            h(
              "div",
              { class: "brand" },
              h("h1", {}, "BYMR dashboard"),
              h("span", { class: "signed-in" }, `Signed in as ${username}`),
            ),
            h("div", { class: "top-actions" }, this.updated, this.refreshButton),
            themePicker(),
          ),
          this.tabs,
          this.nav,
        ),
        h(
          "main",
          { class: "page" },
          this.home,
          ...VIEWS.filter(([id]) => id !== "home").map(([id]) => this.sections[id as SectionId].element),
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
      route.view === "inbox" ? this.inbox.show(route.params) : this.inbox.refresh(),
      this.loadHomeInbox(),
      this.cases.refresh(),
      this.photos.refresh(),
      this.bugs.show(route.bug, route.view === "bugs" ? route.params : {}),
      this.moderation.refresh(),
      this.moderators.refresh(),
      this.modMail.refresh(),
      this.shiny.refresh(),
      this.announcements.refresh(),
      this.weekend.refresh(),
    ]);
  }

  /** Shows the view the address names, with what it asks for. */
  private route(): void {
    const route = readRoute(location.search, location.hash);
    this.show(route.view, route.params);
    if (route.view === "bugs") void this.bugs.show(route.bug, route.params);
    if (route.view === "inbox") void this.inbox.show(route.params);
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
    for (const [id, links] of this.links) {
      for (const link of links) {
        if (id === view) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
    }
    // On a phone, More is marked (with the view's name) for a view under it.
    const underMore = phoneTab(view) === "more";
    this.moreButton.classList.toggle("is-current", underMore);
    replace(
      this.moreButton.querySelector(".tab-label")!,
      underMore ? viewLabel(view) : TAB_WORDS.more,
    );
    this.setMenu(false);
    document.title = view === "home" ? "BYMR dashboard" : `${viewLabel(view)} · BYMR dashboard`;
    if (changed) window.scrollTo?.(0, this.scrolls.restore(view));
  }

  /** Opens or closes the phone's list of every view (under More). */
  private setMenu(open: boolean): void {
    this.moreButton.setAttribute("aria-expanded", String(open));
    this.nav.classList.toggle("is-open", open);
  }

  /** Puts a state badge (or nothing) on every link to a view. */
  private setBadge(view: ViewId, make: (() => Node) | null): void {
    for (const link of this.links.get(view) ?? []) {
      const badge = link.querySelector(".nav-state");
      if (!badge) continue;
      if (make) replace(badge, make());
      else replace(badge);
    }
  }

  private async loadAll(): Promise<void> {
    this.refreshButton.classList.add("is-busy");
    this.refreshButton.disabled = true;
    await Promise.all([
      this.loadHealth(),
      this.loadStats(),
      this.inbox.refresh(),
      this.loadHomeInbox(),
      this.cases.refresh(),
      this.photos.refresh(),
      this.bugs.refresh(),
      this.moderation.refresh(),
      this.moderators.refresh(),
      this.modMail.refresh(),
      this.shiny.refresh(),
      this.weekend.refresh(),
    ]);
    this.refreshButton.classList.remove("is-busy");
    this.refreshButton.disabled = false;
    this.say("Up to date");
  }

  /** A count of open items on a view's links and heading, or nothing. */
  private renderCount(view: "cases" | "photos", open: number | null): void {
    const { state } = this.sections[view];
    if (open) {
      const text = String(open);
      this.setBadge(view, () => h("span", { class: "count" }, text, h("span", { class: "sr-only" }, " open")));
      replace(state, h("span", { class: "chip chip-info" }, `${text} open`));
    } else {
      this.setBadge(view, null);
      replace(state);
    }
  }

  /** The players waiting in the moderation inbox on its links and heading. */
  private renderInboxState(): void {
    const open = this.inboxCounts?.all ?? null;
    const { state } = this.sections.inbox;
    if (open) {
      const text = String(open);
      this.setBadge("inbox", () => h("span", { class: "count" }, text, h("span", { class: "sr-only" }, " waiting")));
      replace(state, h("span", { class: "chip chip-info" }, open === 1 ? "1 player" : `${text} players`));
    } else {
      this.setBadge("inbox", null);
      replace(state);
    }
  }

  /** The players with open photo reports on the link and the heading. */
  private renderPhotoState(): void {
    this.renderCount("photos", this.openPhotos);
  }

  /** The open chat cases on the link and the heading. */
  private renderCaseState(): void {
    this.renderCount("cases", this.openCases);
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

  /** Opens a player in the Find a player view (a name clicked in the chat panel or a case). */
  private openPlayer(userid: number): void {
    history.pushState(null, "", `${location.pathname}${viewHash("moderation")}`);
    this.show("moderation", {});
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
      const [health, bugs, working] = await Promise.all([
        fetchHealth(),
        fetchBugReports("new").catch(() => null),
        fetchBugReports("working").catch(() => null),
      ]);
      report = health;
      this.newBugs = bugs ? bugs.reports.length : null;
      this.newBugList = bugs ? bugs.reports.slice(0, 3) : [];
      this.workingBugs = working ? working.reports.length : null;
      this.renderHomeBugs();
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
    for (const [id] of VIEWS) {
      if (id === "home" || id === "inbox" || id === "cases" || id === "photos") continue;
      const { state } = this.sections[id];
      const level = NO_HEALTH_MARK.has(id) ? undefined : levels[id];
      if (id === "bugs" && this.newBugs) {
        const text = this.newBugs >= 30 ? "30+" : String(this.newBugs);
        this.setBadge(id, () => h("span", { class: "count" }, text, h("span", { class: "sr-only" }, " new")));
        replace(state, h("span", { class: "chip chip-info" }, `${text} new`));
        continue;
      }
      if (level) {
        this.setBadge(id, () => mark(level));
        replace(
          state,
          h("span", { class: `chip chip-${level}` }, level === "bad" ? "Needs you" : "Check"),
        );
      } else {
        this.setBadge(id, null);
        replace(state);
      }
    }
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

  /** Today's numbers: players, errors, photo reports. */
  private renderToday(): void {
    const today = this.overview?.today ?? null;
    const errorsToday =
      today && (today.browserErrors !== null || today.serverErrors !== null)
        ? (today.browserErrors ?? 0) + (today.serverErrors ?? 0)
        : null;
    replace(
      this.todayBox,
      homeLink("#players", count(this.overview?.players.activeToday), "played today"),
      homeLink("#errors", count(errorsToday), errorsToday === 1 ? "error today" : "errors today"),
      homeLink(
        "#photos",
        this.openPhotos === null ? "–" : String(this.openPhotos),
        this.openPhotos === 1 ? "photo report" : "photo reports",
      ),
    );
  }

  /** The first players in the inbox, for Home. */
  private async loadHomeInbox(): Promise<void> {
    try {
      this.homeInboxRows = (await fetchInbox()).players.slice(0, 5);
    } catch {
      this.homeInboxRows = null;
    }
    this.renderHomeInbox();
  }

  /** Home's moderation card: who is waiting, each a tap from their evidence. */
  private renderHomeInbox(): void {
    const counts = this.inboxCounts;
    const rows = this.homeInboxRows;
    const total = counts?.all ?? null;
    replace(
      this.homeInbox,
      h(
        "header",
        { class: "home-card-head" },
        h("h3", { attrs: { id: "home-inbox-title" } }, "Moderation"),
        h("a", { class: "home-more", attrs: { href: viewHash("inbox") } }, "Open inbox", icon("chevron", 16)),
      ),
      h(
        "div",
        { class: "today home-numbers" },
        homeLink(viewHash("inbox"), total === null ? "–" : String(total), total === 1 ? "player waiting" : "players waiting"),
        homeLink(viewHash("inbox", { source: "reports" }), counts ? String(counts.reports) : "–", "player reports"),
        homeLink(viewHash("inbox", { source: "filter" }), counts ? String(counts.filter) : "–", "word filter"),
      ),
      rows === null
        ? null
        : rows.length
          ? h(
              "ul",
              { class: "rows home-rows" },
              ...rows.map((player) =>
                homeRow(
                  viewHash("inbox", { player: player.userid }),
                  player.username ?? `#${player.userid}`,
                  player.oldestAt,
                  inboxLabel(player),
                ),
              ),
            )
          : h("p", { class: "note" }, "Nobody is waiting."),
    );
  }

  /** Home's bug card: new and in progress, and the newest few. */
  private renderHomeBugs(): void {
    const many = (n: number | null) => (n === null ? "–" : n >= 30 ? "30+" : String(n));
    replace(
      this.homeBugs,
      h(
        "header",
        { class: "home-card-head" },
        h("h3", { attrs: { id: "home-bugs-title" } }, "Bug reports"),
        h("a", { class: "home-more", attrs: { href: viewHash("bugs") } }, "All reports", icon("chevron", 16)),
      ),
      h(
        "div",
        { class: "today home-numbers" },
        homeLink(viewHash("bugs", { list: "new" }), many(this.newBugs), "new"),
        homeLink(viewHash("bugs", { list: "working" }), many(this.workingBugs), "being worked on"),
      ),
      this.newBugList.length
        ? h(
            "ul",
            { class: "rows home-rows" },
            ...this.newBugList.map((report) =>
              homeRow(viewHash("bugs", { bug: report.id }), report.username ?? "Signed out", report.createdAt, report.preview),
            ),
          )
        : this.newBugs === 0
          ? h("p", { class: "note" }, "No new reports.")
          : null,
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
