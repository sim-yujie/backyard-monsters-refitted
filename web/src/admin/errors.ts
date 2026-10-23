import { fetchErrors, type DailyStat, type ErrorGroup, type ErrorSource } from "./api";
import { chart } from "./charts";
import { h, replace } from "./dom";
import { ago, count, dateTime } from "./format";
import { card, series } from "./sections";

/**
 * The errors section: the game's errors grouped by kind, from the browser and
 * from the server, with how often, and when first and last seen. Tap one for
 * where it happened and its stack.
 */

const SOURCES: readonly [ErrorSource | "all", string][] = [
  ["all", "Both"],
  ["browser", "Browser"],
  ["server", "Server"],
];

const SORTS: readonly ["last" | "count", string][] = [
  ["last", "Latest"],
  ["count", "Most often"],
];

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
    try {
      const { groups, totals } = await fetchErrors(this.source, this.sort);
      this.render(groups, totals.browser, totals.server);
    } catch (err) {
      this.onError(`Errors could not be loaded: ${String(err)}`);
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
    const summary = h(
      "p",
      { class: "muted" },
      `Kept now (each kind for 30 days after it was last seen): browser ${count(browser.occurrences)} times (${count(browser.kinds)} kinds), server ${count(server.occurrences)} times (${count(server.kinds)} kinds).`,
    );
    const list = groups.length
      ? h(
          "ul",
          { class: "list" },
          ...groups.map((group) =>
            h(
              "li",
              {},
              h(
                "details",
                { class: "list-item error-item" },
                h(
                  "summary",
                  {},
                  h(
                    "span",
                    { class: "item-top" },
                    h(
                      "span",
                      { class: `pill pill-${group.source}` },
                      group.source === "browser" ? "Browser" : "Server",
                    ),
                    h("strong", {}, `${count(group.count)}×`),
                    h("span", { class: "muted" }, `last ${ago(group.lastSeen)}`),
                  ),
                  h("span", { class: "item-text" }, group.message),
                ),
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
        )
      : h("p", { class: "muted" }, "No errors. Nice.");

    replace(
      this.element,
      card(
        "Browser errors per day",
        chart(
          series(this.days, (d) => d.browserErrors),
          { kind: "bar", unit: "browser errors" },
        ),
      ),
      card(
        "Server errors per day",
        chart(
          series(this.days, (d) => d.serverErrors),
          { kind: "bar", unit: "server errors" },
        ),
      ),
      h(
        "div",
        { class: "controls" },
        this.segmented(SOURCES, this.source, (value) => (this.source = value), "Which errors"),
        this.segmented(SORTS, this.sort, (value) => (this.sort = value), "Order"),
      ),
      summary,
      list,
    );
  }
}
