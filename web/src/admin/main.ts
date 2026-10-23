import "./admin.css";
import { restoreStoredSession } from "@/api/auth";
import { ApiError } from "@/api/http";
import {
  fetchBugReports,
  fetchHealth,
  fetchMe,
  fetchOverview,
  type AdminHealthReport,
  type StatsOverview,
} from "./api";
import { BugsView } from "./bugs";
import { h, replace } from "./dom";
import { ErrorsView } from "./errors";
import { dateTime } from "./format";
import { topItems } from "./problems";
import { renderActivity, renderBackups, renderHealth, renderPlayers } from "./sections";

/**
 * The owner's dashboard at /admin (docs/design/admin-dashboard-api.md). It
 * uses the game's sign-in from this browser. Anyone but the owner, signed in
 * or not, sees only "Not found", the same as any unknown page: the server
 * answers them 404 and the page shows nothing more.
 *
 * Phone first: the owner opens it from a Telegram alert, which links a
 * section (`#health`, `#backups`, `#errors`, `#bugs`) or a report (`?bug=<id>`).
 */

const SECTIONS = [
  ["health", "Health"],
  ["backups", "Backups"],
  ["players", "Players"],
  ["activity", "Activity"],
  ["bugs", "Bug reports"],
  ["errors", "Errors"],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

const RANGES = [30, 90, 365] as const;

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

const section = (id: SectionId, title: string, ...extra: HTMLElement[]) => {
  const body = h("div", { class: "section-body" }, h("p", { class: "muted" }, "Loading…"));
  const element = h(
    "section",
    { class: "section", attrs: { id, "aria-labelledby": `${id}-title` } },
    h(
      "div",
      { class: "section-head" },
      h("h2", { attrs: { id: `${id}-title` } }, title),
      ...extra,
    ),
    body,
  );
  return { element, body };
};

class Dashboard {
  private range: number = RANGES[0];
  private overview: StatsOverview | null = null;
  private readonly toast = h("div", { class: "toast", attrs: { role: "status", hidden: "" } });
  private readonly status = h(
    "div",
    { class: "status-card" },
    h("p", { class: "muted" }, "Checking…"),
  );
  private readonly updated = h("span", { class: "muted small" });
  private readonly bugs = new BugsView({
    onRoute: (id) => this.openBug(id),
    onError: (message) => this.say(message),
  });
  private readonly errors = new ErrorsView((message) => this.say(message));
  private readonly sections: Record<SectionId, { element: HTMLElement; body: HTMLElement }>;
  private toastTimer = 0;

  constructor(username: string) {
    const rangeButtons = h(
      "div",
      { class: "segmented small-seg", attrs: { role: "group", "aria-label": "How many days" } },
      ...RANGES.map((days) =>
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
          `${days} d`,
        ),
      ),
    );
    this.sections = {
      health: section("health", "Server health"),
      backups: section("backups", "Backups"),
      players: section("players", "Players", rangeButtons),
      activity: section("activity", "Activity"),
      bugs: section("bugs", "Bug reports"),
      errors: section("errors", "Errors"),
    };
    replace(this.sections.bugs.body, this.bugs.element);
    replace(this.sections.errors.body, this.errors.element);

    const refresh = h(
      "button",
      { class: "button", attrs: { type: "button" }, onClick: () => void this.loadAll() },
      "Refresh",
    );
    const header = h(
      "header",
      { class: "top" },
      h(
        "div",
        { class: "top-row" },
        h(
          "div",
          {},
          h("h1", {}, "BYMR dashboard"),
          h("span", { class: "muted small" }, `Signed in as ${username}`),
        ),
        refresh,
      ),
      h(
        "nav",
        { class: "nav", attrs: { "aria-label": "Sections" } },
        ...SECTIONS.map(([id, label]) =>
          h("a", { class: "chip", attrs: { href: `#${id}` } }, label),
        ),
      ),
    );

    document.title = "BYMR dashboard";
    document.body.className = "admin-body";
    replace(
      document.body,
      header,
      h(
        "main",
        { class: "page" },
        h(
          "section",
          { class: "section", attrs: { id: "problems", "aria-label": "Problems" } },
          this.status,
          this.updated,
        ),
        ...SECTIONS.map(([id]) => this.sections[id].element),
      ),
      this.toast,
    );

    window.addEventListener("popstate", () => {
      const route = readRoute(location.search, location.hash);
      void this.bugs.show(route.bug);
    });
    window.setInterval(() => {
      if (document.visibilityState === "visible") void this.loadHealth();
    }, HEALTH_REFRESH_MS);
  }

  async start(): Promise<void> {
    const route = readRoute(location.search, location.hash);
    // The errors list loads with the stats, whose daily counts its charts use.
    await Promise.all([this.loadHealth(), this.loadStats(), this.bugs.show(route.bug)]);
    // The sections grew as they loaded; go to the one the link named.
    if (route.section) this.sections[route.section].element.scrollIntoView();
  }

  private async loadAll(): Promise<void> {
    await Promise.all([this.loadHealth(), this.loadStats(), this.bugs.refresh()]);
    this.say("Up to date");
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
    let newBugs: number | null = null;
    try {
      const [health, bugs] = await Promise.all([
        fetchHealth(),
        fetchBugReports("new").catch(() => null),
      ]);
      report = health;
      newBugs = bugs ? bugs.reports.length : null;
    } catch (err) {
      replace(
        this.status,
        h(
          "div",
          { class: "status status-bad" },
          h("strong", {}, "The server's health could not be read"),
          h("p", {}, String(err)),
        ),
      );
      return;
    }
    this.renderStatus(report, newBugs);
    replace(this.sections.health.body, ...renderHealth(report));
    replace(this.sections.backups.body, ...renderBackups(report));
    this.updated.textContent = `Checked ${dateTime(report.health.generatedAt)}`;
  }

  private renderStatus(report: AdminHealthReport, newBugs: number | null): void {
    const items = topItems(report);
    const bad = items.some((item) => item.level === "bad");
    const head = items.length
      ? h(
          "strong",
          {},
          bad
            ? `${items.length} thing${items.length === 1 ? "" : "s"} to look at`
            : "Worth a look",
        )
      : h("strong", {}, "Nothing wrong right now");
    const list = items.length
      ? h(
          "ul",
          { class: "problems" },
          ...items.map((item) =>
            h(
              "li",
              {},
              h(
                "a",
                { class: `problem problem-${item.level}`, attrs: { href: `#${item.section}` } },
                h(
                  "span",
                  { class: "problem-badge" },
                  item.level === "bad" ? "Problem" : "Check",
                ),
                h("span", { class: "problem-title" }, item.title),
                h("span", { class: "problem-detail" }, item.detail),
              ),
            ),
          ),
        )
      : null;
    const bugs =
      newBugs === null
        ? null
        : h(
            "a",
            { class: "status-line", attrs: { href: "#bugs" } },
            newBugs
              ? `${newBugs >= 30 ? "30+" : newBugs} new bug report${newBugs === 1 ? "" : "s"} waiting`
              : "No new bug reports",
          );
    replace(
      this.status,
      h(
        "div",
        { class: `status ${bad ? "status-bad" : items.length ? "status-warn" : "status-ok"}` },
        head,
        list,
        bugs,
      ),
    );
  }

  private async loadStats(): Promise<void> {
    try {
      this.overview = await fetchOverview(this.range);
    } catch (err) {
      this.say(`Player numbers could not be loaded: ${String(err)}`);
      return;
    }
    replace(this.sections.players.body, ...renderPlayers(this.overview));
    replace(this.sections.activity.body, ...renderActivity(this.overview));
    this.errors.setDays(this.overview.days);
    await this.errors.refresh();
  }
}

/** Opens the dashboard for the owner, or "Not found" for anyone else. */
export const boot = async (): Promise<void> => {
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
    replace(
      document.body,
      h(
        "main",
        { class: "notfound" },
        h("h1", {}, "Could not reach the server"),
        h("p", {}, "Check the connection and try again."),
        h(
          "button",
          { class: "button", attrs: { type: "button" }, onClick: () => location.reload() },
          "Try again",
        ),
      ),
    );
    return;
  }
  await new Dashboard(username).start();
};
