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
  fetchOverview,
  type AdminHealthReport,
  type DashboardSection,
  type StatsOverview,
} from "./api";
import { AnnouncementsView } from "./announcements";
import { BugsView } from "./bugs";
import { CasesView } from "./cases";
import { PhotosView } from "./photos";
import { ChatPanel } from "./chat";
import { h, replace } from "./dom";
import { ErrorsView } from "./errors";
import { ModerationView } from "./moderation";
import { ModeratorsView } from "./moderators";
import { count, dateTime } from "./format";
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

/**
 * The owner's dashboard at /admin (docs/design/admin-dashboard-api.md). It
 * uses the game's sign-in from this browser. Anyone but the owner, signed in
 * or not, sees only "Not found", the same as any unknown page: the server
 * answers them 404 and the page shows nothing more.
 *
 * Phone first: the owner opens it from a Telegram alert, which links a
 * section (`#health`, `#backups`, `#errors`, `#bugs`) or a report (`?bug=<id>`).
 * The Shiny section (`#shiny`) gives Shiny to a player and lists every gift.
 * The Announcements section (`#announcements`) writes the pop-ups players
 * see in the game.
 * The Weekend events section (`#weekend`) swaps, skips, runs now or switches
 * off the weekend boost (`weekend.ts`).
 * Chat cases (`#cases`) come first: every report of a player's chat lines
 * as one case, with a copy of the room and one-step warn / pause, Shiny for
 * the reporters, or dismiss. The Moderation section (`#moderation`) warns,
 * pauses chat for, or bans any player, and keeps the raw lists (word filter,
 * reports, chat log) folded; the Chat section (`#chat`) chats as the game team.
 * The top answers "is anything wrong, and what do I do?" in one sentence,
 * then each problem with its fix; the sections below are ordered by how often
 * they need the owner (chat cases and bug reports first, server internals
 * last). Sections the owner rarely opens start folded (their heading opens
 * them; the choice is remembered in this browser), and a link to a section
 * (a Telegram alert's `#health`, a nav link) always opens it.
 *
 * On a phone the section links are one row that stays at the top and scrolls
 * sideways; on a computer they are a sidebar. Either way they never cover a
 * section's heading, and each link carries its section's state (a count of
 * new bug reports, a mark when something there needs a look).
 */

const SECTIONS = [
  ["cases", "Chat cases"],
  ["photos", "Photo reports"],
  ["bugs", "Bug reports"],
  ["moderation", "Moderation"],
  ["moderators", "Moderators"],
  ["chat", "Chat"],
  ["shiny", "Shiny"],
  ["announcements", "Announcements"],
  ["weekend", "Weekend events"],
  ["players", "Players"],
  ["activity", "Activity"],
  ["errors", "Errors"],
  ["health", "Server"],
  ["backups", "Backups"],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

/** Sections folded until the owner opens them: rarely needed, or told about at the top. */
export const FOLDED_AT_FIRST: ReadonlySet<SectionId> = new Set<SectionId>([
  "announcements",
  "players",
  "activity",
  "health",
  "backups",
]);

const FOLD_KEY = "bymr.admin.folds";

/** The sections the owner opened or folded in this browser: id -> open. */
export const readFolds = (): Partial<Record<SectionId, boolean>> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const folds: Partial<Record<SectionId, boolean>> = {};
    for (const [id] of SECTIONS) {
      const value = (raw as Record<string, unknown>)[id];
      if (typeof value === "boolean") folds[id] = value;
    }
    return folds;
  } catch {
    return {};
  }
};

const saveFolds = (folds: Partial<Record<SectionId, boolean>>): void => {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
  } catch {
    // A private window: folds are not remembered, nothing else changes.
  }
};

const RANGES = [
  [30, "30 days"],
  [90, "90 days"],
  [365, "1 year"],
] as const;

/** Health is checked again this often while the page is open and showing. */
const HEALTH_REFRESH_MS = 60_000;

export interface Route {
  bug: number | null;
  section: SectionId | null;
}

/** What the address asks for: a bug report (`?bug=12`) and a section (`#errors`). */
export const readRoute = (search: string, hash: string): Route => {
  const bug = Number(new URLSearchParams(search).get("bug"));
  const name = hash.replace(/^#/, "");
  const section = SECTIONS.find(([id]) => id === name)?.[0] ?? null;
  return {
    bug: Number.isSafeInteger(bug) && bug > 0 ? bug : null,
    section: section ?? (bug > 0 ? "bugs" : null),
  };
};

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
  link: HTMLAnchorElement;
  toggle: HTMLButtonElement;
}

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
    onError: (message) => this.say(message),
    onSay: (message) => this.say(message),
    onAward: () => void this.shiny.refresh(),
  });
  private readonly shiny = new ShinyView({
    openReport: (id) => this.openBug(id),
    say: (message) => this.say(message),
  });
  private readonly moderation = new ModerationView({ say: (message) => this.say(message) });
  private readonly weekend = new WeekendView({ say: (message) => this.say(message) });
  private readonly moderators = new ModeratorsView({ say: (message) => this.say(message) });
  private readonly cases = new CasesView({
    say: (message) => this.say(message),
    onCount: (open) => {
      this.openCases = open;
      this.renderCaseState();
      this.renderToday();
    },
    openPlayer: (userid) => this.openPlayer(userid),
    onChanged: () => void this.moderation.refresh(),
  });
  /** Open chat cases, or null before they are read. */
  private openCases: number | null = null;
  private readonly photos = new PhotosView({
    say: (message) => this.say(message),
    onCount: (open) => {
      this.openPhotos = open;
      this.renderPhotoState();
    },
    openPlayer: (userid) => this.openPlayer(userid),
  });
  /** Players with open photo reports, or null before they are read. */
  private openPhotos: number | null = null;
  private readonly folds = readFolds();
  private readonly chat = new ChatPanel({
    openPlayer: (userid) => this.openPlayer(userid),
    say: (message) => this.say(message),
  });
  private readonly announcements = new AnnouncementsView({ say: (message) => this.say(message) });
  private readonly errors = new ErrorsView((message) => this.say(message));
  private readonly sections: Record<SectionId, Section>;
  private readonly nav: HTMLElement;
  private newBugs: number | null = null;
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

    const links = new Map<SectionId, HTMLAnchorElement>();
    this.nav = h(
      "nav",
      { class: "nav", attrs: { "aria-label": "Sections" } },
      h(
        "ul",
        {},
        ...SECTIONS.map(([id, label]) => {
          const link = h(
            "a",
            { class: "nav-link", attrs: { href: `#${id}` } },
            h("span", { class: "nav-label" }, label),
            h("span", { class: "nav-state" }),
          );
          links.set(id, link);
          return h("li", {}, link);
        }),
      ),
    );

    const section = (id: SectionId, title: string, ...extra: HTMLElement[]): Section => {
      const body = h("div", { class: "section-body", attrs: { id: `${id}-body` } }, skeleton());
      const state = h("span", { class: "section-state" });
      // The heading is the fold's button: one tap opens or folds the section.
      const toggle = h(
        "button",
        {
          class: "section-toggle",
          attrs: { type: "button", "aria-controls": `${id}-body`, "aria-expanded": "true" },
          onClick: () => this.setOpen(id, toggle.getAttribute("aria-expanded") !== "true", true),
        },
        icon("chevron", 18),
        h("span", {}, title),
      );
      const element = h(
        "section",
        { class: "section", attrs: { id, "aria-labelledby": `${id}-title` } },
        h(
          "header",
          { class: "section-head" },
          h("h2", { attrs: { id: `${id}-title` } }, toggle),
          state,
          ...extra,
        ),
        body,
      );
      return { element, body, state, link: links.get(id)!, toggle };
    };
    this.sections = {
      cases: section("cases", "Chat cases"),
      photos: section("photos", "Photo reports"),
      bugs: section("bugs", "Bug reports"),
      moderation: section("moderation", "Moderation"),
      moderators: section("moderators", "Chat moderators"),
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
    replace(this.sections.cases.body, this.cases.element);
    replace(this.sections.photos.body, this.photos.element);
    replace(this.sections.bugs.body, this.bugs.element);
    replace(this.sections.moderation.body, this.moderation.element);
    replace(this.sections.moderators.body, this.moderators.element);
    replace(this.sections.chat.body, this.chat.element);
    replace(this.sections.shiny.body, this.shiny.element);
    replace(this.sections.announcements.body, this.announcements.element);
    replace(this.sections.weekend.body, this.weekend.element);
    replace(this.sections.errors.body, this.errors.element);

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
          this.nav,
        ),
        h(
          "main",
          { class: "page" },
          this.verdict,
          ...SECTIONS.map(([id]) => this.sections[id].element),
        ),
      ),
      this.toast,
    );

    for (const [id] of SECTIONS) {
      this.setOpen(id, this.folds[id] ?? !FOLDED_AT_FIRST.has(id), false);
    }
    // A link to a section opens it: the nav, "See Server", a Telegram alert.
    window.addEventListener("hashchange", () => this.openNamed(location.hash));
    document.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href^='#']");
      if (link) this.openNamed(link.getAttribute("href") ?? "");
    });

    window.addEventListener("popstate", () => {
      const route = readRoute(location.search, location.hash);
      void this.bugs.show(route.bug);
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
    this.watchScroll();
  }

  async start(): Promise<void> {
    const route = readRoute(location.search, location.hash);
    if (route.section) this.setOpen(route.section, true, false);
    // The errors list loads with the stats, whose daily counts its charts use.
    await Promise.all([
      this.loadHealth(),
      this.loadStats(),
      this.cases.refresh(),
      this.photos.refresh(),
      this.bugs.show(route.bug),
      this.moderation.refresh(),
      this.moderators.refresh(),
      this.shiny.refresh(),
      this.announcements.refresh(),
      this.weekend.refresh(),
    ]);
    // The sections grew as they loaded; go to the one the link named.
    if (route.section) this.sections[route.section].element.scrollIntoView();
  }

  /** Marks the link of the section being read, and keeps it in view in the phone's row. */
  private watchScroll(): void {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const current = SECTIONS.find(([id]) => visible.has(id))?.[0];
        for (const [id] of SECTIONS) {
          const link = this.sections[id].link;
          if (id === current) {
            link.setAttribute("aria-current", "true");
            const row = this.nav;
            if (row.scrollWidth > row.clientWidth) {
              const left = link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2;
              row.scrollTo({ left, behavior: "smooth" });
            }
          } else {
            link.removeAttribute("aria-current");
          }
        }
      },
      // A section counts as "being read" while it crosses the upper third.
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const [id] of SECTIONS) observer.observe(this.sections[id].element);
  }

  private async loadAll(): Promise<void> {
    this.refreshButton.classList.add("is-busy");
    this.refreshButton.disabled = true;
    await Promise.all([
      this.loadHealth(),
      this.loadStats(),
      this.cases.refresh(),
      this.photos.refresh(),
      this.bugs.refresh(),
      this.moderation.refresh(),
      this.moderators.refresh(),
      this.shiny.refresh(),
      this.weekend.refresh(),
    ]);
    this.refreshButton.classList.remove("is-busy");
    this.refreshButton.disabled = false;
    this.say("Up to date");
  }

  /** Opens or folds a section; `remember` keeps the owner's choice in this browser. */
  private setOpen(id: SectionId, open: boolean, remember: boolean): void {
    const { body, toggle, element } = this.sections[id];
    const was = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(open));
    element.classList.toggle("is-folded", !open);
    body.hidden = !open;
    if (remember) {
      this.folds[id] = open;
      saveFolds(this.folds);
    }
    // Charts drawn while folded had no width: draw them again.
    if (open && !was && (id === "players" || id === "activity") && this.overview) {
      replace(this.sections.players.body, ...renderPlayers(this.overview));
      replace(this.sections.activity.body, ...renderActivity(this.overview));
    }
  }

  /** Opens the section a link names (`#health`), without remembering it. */
  private openNamed(href: string): void {
    const id = SECTIONS.find(([name]) => `#${name}` === href)?.[0];
    if (id) this.setOpen(id, true, false);
  }

  /** The players with open photo reports on the link and the heading. */
  private renderPhotoState(): void {
    const { state, link } = this.sections.photos;
    const badge = link.querySelector(".nav-state")!;
    if (this.openPhotos) {
      const text = String(this.openPhotos);
      replace(badge, h("span", { class: "count" }, text, h("span", { class: "sr-only" }, " open")));
      replace(state, h("span", { class: "chip chip-info" }, `${text} open`));
    } else {
      replace(badge);
      replace(state);
    }
  }

  /** The open chat cases on the link and the heading. */
  private renderCaseState(): void {
    const { state, link } = this.sections.cases;
    const badge = link.querySelector(".nav-state")!;
    if (this.openCases) {
      const text = String(this.openCases);
      replace(badge, h("span", { class: "count" }, text, h("span", { class: "sr-only" }, " open")));
      replace(state, h("span", { class: "chip chip-info" }, `${text} open`));
    } else {
      replace(badge);
      replace(state);
    }
  }

  private say(message: string): void {
    this.toast.textContent = message;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 4000);
  }

  private openBug(id: number | null): void {
    const url =
      id === null ? `${location.pathname}#bugs` : `${location.pathname}?bug=${id}#bugs`;
    history.pushState(null, "", url);
    void this.bugs.show(id).then(() => this.sections.bugs.element.scrollIntoView());
  }

  /** Opens a player in the Moderation section (a name clicked in the chat panel). */
  private openPlayer(userid: number): void {
    this.setOpen("moderation", true, false);
    this.sections.moderation.element.scrollIntoView();
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
      const [health, bugs] = await Promise.all([
        fetchHealth(),
        fetchBugReports("new").catch(() => null),
      ]);
      report = health;
      this.newBugs = bugs ? bugs.reports.length : null;
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
        h("span", { class: "verdict-icon" }, icon("bad", 28)),
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

  /** Each section's heading and link say whether something there needs a look. */
  private renderStates(items: readonly TopItem[]): void {
    const levels = sectionLevels(items);
    for (const [id] of SECTIONS) {
      if (id === "cases" || id === "photos") continue;
      const { state, link } = this.sections[id];
      const level =
        id === "players" ||
        id === "activity" ||
        id === "shiny" ||
        id === "announcements" ||
        id === "weekend" ||
        id === "moderation" ||
        id === "moderators" ||
        id === "chat"
          ? undefined
          : levels[id];
      const badge = link.querySelector(".nav-state")!;
      if (id === "bugs" && this.newBugs) {
        const text = this.newBugs >= 30 ? "30+" : String(this.newBugs);
        replace(badge, h("span", { class: "count" }, text, h("span", { class: "sr-only" }, " new")));
        replace(state, h("span", { class: "chip chip-info" }, `${text} new`));
        continue;
      }
      if (level) {
        // A problem in a folded section opens it.
        this.setOpen(id, true, false);
        replace(badge, mark(level));
        replace(
          state,
          h("span", { class: `chip chip-${level}` }, level === "bad" ? "Needs you" : "Check"),
        );
      } else {
        replace(badge);
        replace(state);
      }
    }
  }

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
    // the owner opened stays open when the box is drawn again.
    const firstBad = items.find((item) => item.level === "bad")?.key;
    const open = this.openFixes ?? new Set(firstBad ? [firstBad] : []);
    const list = items.length
      ? h("ol", { class: "issues" }, ...items.map((item) => this.issue(item, open.has(item.key))))
      : null;
    this.openFixes = open;
    this.renderToday();

    replace(
      this.verdict,
      h(
        "div",
        { class: "verdict-head" },
        h("span", { class: "verdict-icon" }, icon(level, 28)),
        h(
          "div",
          {},
          h("h2", { attrs: { id: "verdict-title" } }, verdict(items)),
          h(
            "p",
            { class: "verdict-sub" },
            level === "ok"
              ? "The game server, database, disk and backups all look right."
              : "Checked every minute; this box empties by itself once fixed.",
          ),
        ),
      ),
      list,
      this.todayBox,
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
    const sectionName = SECTIONS.find(([id]) => id === item.section)?.[1] ?? "Server";
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

  /** Today in four taps: open chat cases, new bug reports, players, errors. */
  private renderToday(): void {
    const today = this.overview?.today ?? null;
    const errorsToday =
      today && (today.browserErrors !== null || today.serverErrors !== null)
        ? (today.browserErrors ?? 0) + (today.serverErrors ?? 0)
        : null;
    const link = (href: string, value: string, label: string) =>
      h(
        "a",
        { class: "today-link", attrs: { href } },
        h("span", { class: "today-value" }, value),
        h("span", { class: "today-label" }, label),
      );
    replace(
      this.todayBox,
      link(
        "#cases",
        this.openCases === null ? "–" : String(this.openCases),
        this.openCases === 1 ? "open chat case" : "open chat cases",
      ),
      link(
        "#bugs",
        this.newBugs === null ? "–" : this.newBugs >= 30 ? "30+" : String(this.newBugs),
        this.newBugs === 1 ? "new bug report" : "new bug reports",
      ),
      link("#players", count(this.overview?.players.activeToday), "played today"),
      link("#errors", count(errorsToday), errorsToday === 1 ? "error today" : "errors today"),
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
