import {
  fetchErrors,
  type DailyStat,
  type ErrorGroup,
  type ErrorReporter,
  type ErrorSource,
  type ErrorTotals,
} from "./api";
import { h, replace } from "./dom";
import { ago, count, dateTime, plural } from "./format";
import { icon } from "./icons";
import { chartCard, series, total } from "./sections";

/**
 * The errors section: the game's errors grouped by kind, from players'
 * browsers and from the server, with how often, and when first and last seen.
 * Tap one for where it happened, who hit it (name, account number and
 * address: shown here only, never anywhere players see) and its stack.
 *
 * The grouped list comes first (owner, 8 Nov 2026: what matters is which
 * error, how often, when last); the daily charts are folded below it.
 */

const SOURCES: readonly [ErrorSource | "all", string][] = [
  ["all", "All"],
  ["browser", "Players' browsers"],
  ["server", "Game server"],
];

const SORTS: readonly ["last" | "count", string][] = [
  ["last", "Newest"],
  ["count", "Most often"],
];

const SOURCE_WORD: Record<ErrorSource, string> = { browser: "Browser", server: "Server" };

/** One sender: `Name #12 · 203.0.113.7 · 2 h ago`, or `Signed out · address · when`. */
const reporterLine = (reporter: ErrorReporter): string =>
  [
    reporter.userid === null ? "Signed out" : `${reporter.username || "?"} #${reporter.userid}`,
    reporter.ip || null,
    ago(reporter.lastSeen),
  ]
    .filter(Boolean)
    .join(" · ");

export class ErrorsView {
  readonly element = h("div", { class: "errors" });
  private source: ErrorSource | "all" = "all";
  private sort: "last" | "count" = "last";
  private days: readonly DailyStat[] = [];
  /** Whether the owner opened the charts, kept across refreshes. */
  private chartsOpen = false;

  constructor(
    private readonly onError: (message: string) => void,
    /** Told the totals each time the list loads (Server health's Recorded errors card). */
    private readonly onTotals: (totals: ErrorTotals) => void = () => {},
  ) {}

  /** The daily counts for the charts (from the stats overview). */
  setDays(days: readonly DailyStat[]): void {
    this.days = days;
  }

  async refresh(): Promise<void> {
    this.element.classList.add("is-loading");
    try {
      const { groups, totals } = await fetchErrors(this.source, this.sort);
      this.render(groups, totals.browser, totals.server);
      this.onTotals(totals);
    } catch (err) {
      this.onError(`Errors could not be loaded: ${String(err)}`);
    } finally {
      this.element.classList.remove("is-loading");
    }
  }

  private segmented<T extends string>(
    options: readonly [T, string][],
    current: T,
    pick: (value: T) => void,
    label: string,
  ) {
    return h(
      "div",
      { class: "segmented", attrs: { role: "group", "aria-label": label } },
      ...options.map(([value, text]) =>
        h(
          "button",
          {
            class: "seg",
            attrs: { type: "button", "aria-pressed": String(value === current) },
            onClick: () => {
              pick(value);
              void this.refresh();
            },
          },
          text,
        ),
      ),
    );
  }

  private render(
    groups: ErrorGroup[],
    browser: { kinds: number; occurrences: number },
    server: { kinds: number; occurrences: number },
  ): void {
    const inBrowsers = series(this.days, (d) => d.browserErrors);
    const onServer = series(this.days, (d) => d.serverErrors);
    const sum = (points: typeof inBrowsers) => {
      const n = total(points);
      return n === null ? null : `${count(n)} ${n === 1 ? "error" : "errors"} in the last ${this.days.length} days`;
    };
    const list = groups.length
      ? h(
          "ul",
          { class: "rows" },
          ...groups.map((group) =>
            h(
              "li",
              {},
              h(
                "details",
                { class: "row error-row" },
                h(
                  "summary",
                  {},
                  h("span", { class: "row-count" }, `${count(group.count)}×`),
                  h(
                    "span",
                    { class: "row-main" },
                    h(
                      "span",
                      { class: "row-title code-ish" },
                      group.thirdParty
                        ? h(
                            "span",
                            {
                              class: "chip chip-warn",
                              attrs: { title: "Its stack names none of the game's code" },
                            },
                            "Third-party",
                          )
                        : null,
                      group.thirdParty ? " " : null,
                      group.message,
                    ),
                    h(
                      "span",
                      { class: "row-meta" },
                      [
                        SOURCE_WORD[group.source],
                        `last seen ${ago(group.lastSeen)}`,
                        group.userids.length ? plural(group.userids.length, "player") : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    ),
                  ),
                  icon("chevron", 16),
                ),
                h(
                  "div",
                  { class: "row-more" },
                  h(
                    "dl",
                    { class: "facts" },
                    h("dt", {}, "Where"),
                    h("dd", {}, group.place || "–"),
                    h("dt", {}, "First seen"),
                    h("dd", {}, dateTime(group.firstSeen)),
                    h("dt", {}, "Last seen"),
                    h("dd", {}, dateTime(group.lastSeen)),
                    group.gameVersion ? h("dt", {}, "Version") : null,
                    group.gameVersion ? h("dd", {}, group.gameVersion) : null,
                    group.screen ? h("dt", {}, "Screen") : null,
                    group.screen ? h("dd", {}, group.screen) : null,
                    group.reporters.length ? h("dt", {}, "Who") : null,
                    group.reporters.length
                      ? h(
                          "dd",
                          { class: "reporters" },
                          ...group.reporters.map((r) => h("div", {}, reporterLine(r))),
                        )
                      : null,
                    !group.reporters.length && group.userids.length
                      ? h("dt", {}, "Players")
                      : null,
                    !group.reporters.length && group.userids.length
                      ? h("dd", {}, group.userids.map((id) => `#${id}`).join(", "))
                      : null,
                  ),
                  group.stack ? h("pre", { class: "code" }, group.stack) : null,
                ),
              ),
            ),
          ),
        )
      : h(
          "div",
          { class: "empty" },
          h("strong", {}, "No errors"),
          h(
            "p",
            {},
            this.source === "all"
              ? "Nothing has gone wrong in the last 30 days."
              : "None of this kind in the last 30 days.",
          ),
        );

    const charts = h(
      "details",
      { class: "fold error-charts", attrs: this.chartsOpen ? { open: "" } : {} },
      h(
        "summary",
        {},
        icon("chevron", 16),
        h("span", {}, "Errors per day"),
        h("span", { class: "fold-count" }, `${this.days.length} days`),
      ),
      h(
        "div",
        { class: "charts" },
        chartCard("In players' browsers", sum(inBrowsers), inBrowsers, {
          kind: "bar",
          unit: "browser errors",
        }),
        chartCard("On the game server", sum(onServer), onServer, {
          kind: "bar",
          unit: "server errors",
        }),
      ),
    );
    charts.addEventListener("toggle", () => (this.chartsOpen = charts.open));

    replace(
      this.element,
      h(
        "div",
        { class: "toolbar" },
        this.segmented(SOURCES, this.source, (value) => (this.source = value), "Which errors"),
        this.segmented(SORTS, this.sort, (value) => (this.sort = value), "Order"),
      ),
      list,
      h(
        "p",
        { class: "note" },
        `Distinct error groups in the list above, kept 30 days after last seen: ${plural(browser.kinds, "group")} from browsers and ${plural(server.kinds, "group")} from the server (${plural(browser.occurrences + server.occurrences, "occurrence")} between them). The charts count every occurrence per day, so their totals are higher. A few are normal; a sudden rise is worth a look.`,
      ),
      charts,
    );
  }
}
