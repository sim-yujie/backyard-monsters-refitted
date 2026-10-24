import { fetchErrors, type DailyStat, type ErrorGroup, type ErrorSource } from "./api";
import { h, replace } from "./dom";
import { ago, count, dateTime, plural } from "./format";
import { icon } from "./icons";
import { chartCard, series, total } from "./sections";

/**
 * The errors section: the game's errors grouped by kind, from players'
 * browsers and from the server, with how often, and when first and last seen.
 * Tap one for where it happened and its stack.
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

export class ErrorsView {
  readonly element = h("div", { class: "errors" });
  private source: ErrorSource | "all" = "all";
  private sort: "last" | "count" = "last";
  private days: readonly DailyStat[] = [];

  constructor(private readonly onError: (message: string) => void) {}

  /** The daily counts for the charts (from the stats overview). */
  setDays(days: readonly DailyStat[]): void {
    this.days = days;
  }

  async refresh(): Promise<void> {
    this.element.classList.add("is-loading");
    try {
      const { groups, totals } = await fetchErrors(this.source, this.sort);
      this.render(groups, totals.browser, totals.server);
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
      return n === null ? null : `${count(n)} in ${this.days.length} days`;
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
                    h("span", { class: "row-title code-ish" }, group.message),
                    h(
                      "span",
                      { class: "row-meta" },
                      [
                        SOURCE_WORD[group.source],
                        `last ${ago(group.lastSeen)}`,
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
                    group.userids.length ? h("dt", {}, "Players") : null,
                    group.userids.length
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

    replace(
      this.element,
      h(
        "p",
        { class: "lede" },
        "Errors are things that went wrong in the game. A few are normal; a sudden rise is worth a look.",
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
      h(
        "div",
        { class: "toolbar" },
        this.segmented(SOURCES, this.source, (value) => (this.source = value), "Which errors"),
        this.segmented(SORTS, this.sort, (value) => (this.sort = value), "Order"),
      ),
      h(
        "p",
        { class: "note" },
        `Kept for 30 days after last seen: ${plural(browser.kinds, "kind")} from browsers (${plural(browser.occurrences, "time")}), ${plural(server.kinds, "kind")} from the server (${plural(server.occurrences, "time")}).`,
      ),
      list,
    );
  }
}
