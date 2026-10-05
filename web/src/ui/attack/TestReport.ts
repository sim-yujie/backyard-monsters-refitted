import type { TestReport } from "@/game/baiter/testReport";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import "@/ui/styles/baiter.css";

/**
 * The report of a Baiter test (#22, WP4, `docs/design/baiter-simulator.md`
 * §7): Summary, Towers and Attackers tabs over the rows `testReport.ts`
 * builds, in the same large centre window as the test's setup (#308), the
 * yard dimmed behind it; a full-screen sheet on a phone. Like the attack's
 * end screen it has no Escape or scrim close: the test is over and there is
 * nothing behind it to go back to.
 *
 * Tapping a tower's row shows that tower: the window steps aside, the scrim
 * lifts, and a small bar at the foot names the tower with **Back to report**
 * (or Escape) to bring the window back.
 */

export type TestReportTab = "summary" | "towers" | "attackers";

export interface TestReportOptions {
  readonly report: TestReport;
  /**
   * A tower, bunker or trap row was tapped: centre the camera on it and ring
   * it. Without it the rows are plain (the report reopened in the yard, which
   * may have changed since).
   */
  readonly onBuilding?: (id: number) => void;
  /** The player came back to the report from a tower {@link onBuilding} showed. */
  readonly onLeaveBuilding?: () => void;
  /** Test again and Change army show only when given: a replay offers neither. */
  readonly onAgain?: () => void;
  readonly onChangeArmy?: () => void;
  readonly onBack: () => void;
  /** "Back to yard" unless named otherwise. */
  readonly backLabel?: string;
  /** Watch the test again; the button shows only when given (WP5). */
  readonly onReplay?: () => void;
  /** "Watch replay" unless named otherwise. */
  readonly replayLabel?: string;
}

const TABS: readonly [TestReportTab, string][] = [
  ["summary", "Summary"],
  ["towers", "Towers"],
  ["attackers", "Attackers"],
];

const amount = (value: number): string => formatAmount(value);

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

/** A table of rows, in a box that scrolls sideways when the panel is narrower than it. */
const table = (caption: string, headings: readonly string[], rows: readonly HTMLTableRowElement[]): HTMLElement => {
  const wrap = element("div", "test-report__scroll");
  const grid = element("table", "test-report__table");
  const title = element("caption", "test-report__caption", caption);
  const head = element("thead", "");
  const headRow = element("tr", "");
  for (const heading of headings) {
    const cell = element("th", "", heading);
    cell.scope = "col";
    headRow.append(cell);
  }
  head.append(headRow);
  const body = element("tbody", "");
  body.append(...rows);
  grid.append(title, head, body);
  wrap.append(grid);
  return wrap;
};

/** One row; its first cell is a button when the row names a building on the yard. */
const row = (cells: readonly string[], onTap?: (from: HTMLElement) => void, muted = false): HTMLTableRowElement => {
  const tr = element("tr", muted ? "test-report__row test-report__row--muted" : "test-report__row");
  cells.forEach((text, index) => {
    const cell = element(index === 0 ? "th" : "td", "");
    if (index === 0) (cell as HTMLTableCellElement).scope = "row";
    if (index === 0 && onTap) {
      const show = button(text, "test-report__show", () => onTap(show));
      cell.append(show);
      tr.classList.add("test-report__row--tap");
      tr.addEventListener("click", (event) => {
        if (!(event.target instanceof HTMLButtonElement)) onTap(show);
      });
    } else {
      cell.textContent = text;
    }
    tr.append(cell);
  });
  return tr;
};

export class TestReportPanel {
  readonly element: HTMLElement;
  private readonly panel: Panel;
  private readonly tabs = new Map<TestReportTab, HTMLButtonElement>();
  private readonly views = new Map<TestReportTab, HTMLElement>();
  /** The bar that stands in for the window while a tower is shown. */
  private readonly peekBar: HTMLElement;
  private readonly peekText: HTMLElement;
  /** The row button that showed the tower, for focus on the way back. */
  private peekFrom: HTMLElement | null = null;

  constructor(private readonly options: TestReportOptions) {
    this.element = element("div", "popup-backdrop test-report__backdrop");

    this.panel = new Panel({ title: "Test report", closable: false, className: "test-report baiter-window" });
    this.panel.element.setAttribute("role", "dialog");
    this.panel.element.setAttribute("aria-modal", "true");

    const tablist = element("div", "test-report__tabs");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Test report");
    this.views.set("summary", this.summaryView());
    this.views.set("towers", this.towersView());
    this.views.set("attackers", this.attackersView());
    for (const [name, label] of TABS) {
      const tab = button(label, "btn btn--ghost test-report__tab", () => this.select(name));
      tab.id = `test-report-tab-${name}`;
      tab.setAttribute("role", "tab");
      const view = this.views.get(name)!;
      view.id = `test-report-${name}`;
      view.setAttribute("role", "tabpanel");
      view.setAttribute("aria-labelledby", tab.id);
      tab.setAttribute("aria-controls", view.id);
      this.tabs.set(name, tab);
      tablist.append(tab);
    }
    tablist.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const names = TABS.map(([name]) => name);
      const current = names.findIndex((name) => this.tabs.get(name)?.getAttribute("aria-selected") === "true");
      const next = names[(current + (event.key === "ArrowRight" ? 1 : names.length - 1)) % names.length];
      if (!next) return;
      event.preventDefault();
      this.select(next);
      this.tabs.get(next)?.focus();
    });

    const actions = element("div", "test-report__actions");
    const { onReplay, onAgain, onChangeArmy } = options;
    if (onReplay) {
      actions.append(button(options.replayLabel ?? "Watch replay", "btn btn--ghost test-report__replay", onReplay));
    }
    if (onAgain) actions.append(button("Test again", "btn btn--ghost test-report__again", onAgain));
    if (onChangeArmy) actions.append(button("Change army", "btn btn--ghost test-report__change", onChangeArmy));
    actions.append(button(options.backLabel ?? "Back to yard", "btn btn--primary test-report__back", () => options.onBack()));

    this.panel.setContent(tablist, ...this.views.values(), actions);

    this.peekBar = element("div", "test-report__peek");
    this.peekBar.hidden = true;
    this.peekBar.setAttribute("role", "status");
    this.peekText = element("p", "test-report__peek-text");
    this.peekBar.append(
      this.peekText,
      button("Back to report", "btn btn--primary test-report__peek-back", () => this.unpeek()),
    );
    this.peekBar.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.unpeek();
    });

    this.element.append(this.panel.element, this.peekBar);
    this.select("summary");
  }

  /** Whether a tower is being shown, with the window stepped aside. */
  get peeking(): boolean {
    return !this.peekBar.hidden;
  }

  /** Shows one tab. */
  select(tab: TestReportTab): void {
    for (const [name, view] of this.views) view.hidden = name !== tab;
    for (const [name, control] of this.tabs) {
      control.setAttribute("aria-selected", String(name === tab));
      control.tabIndex = name === tab ? 0 : -1;
    }
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    this.element.querySelector<HTMLButtonElement>(".test-report__back")?.focus();
    return this;
  }

  close(): void {
    this.panel.close();
    this.element.remove();
  }

  /** Steps the window aside for the yard, a bar naming what is shown. */
  private peek(name: string, from: HTMLElement): void {
    this.peekFrom = from;
    this.peekText.textContent = `Showing ${name}`;
    this.peekBar.hidden = false;
    this.element.classList.add("test-report__backdrop--peek");
    this.peekBar.querySelector<HTMLButtonElement>(".test-report__peek-back")?.focus();
  }

  /** Brings the window back from a shown tower. */
  private unpeek(): void {
    if (!this.peeking) return;
    this.peekBar.hidden = true;
    this.element.classList.remove("test-report__backdrop--peek");
    this.options.onLeaveBuilding?.();
    this.peekFrom?.focus();
    this.peekFrom = null;
  }

  private summaryView(): HTMLElement {
    const { report } = this.options;
    const view = element("div", "test-report__view");
    const headline = element("p", "test-report__result", report.resultLine);

    const facts = element("dl", "test-report__facts");
    const fact = (label: string, value: string): void => {
      facts.append(element("dt", "", label), element("dd", "", value));
    };
    fact("Damage", `${Math.floor(report.damagePercent)}%`);
    fact("Buildings destroyed", `${amount(report.buildingsDestroyed)} of ${amount(report.buildingsTotal)}`);
    fact("Time", report.time);
    fact("Attackers beaten", `${amount(report.attackersBeaten)} of ${amount(report.attackersSent)}`);
    for (const champion of report.champions) {
      fact(
        champion.name,
        champion.survived
          ? `Survived with ${amount(champion.health)} health`
          : champion.fellAt
            ? `Fell at ${champion.fellAt}`
            : "Fell",
      );
    }

    view.append(headline, facts);
    if (report.hint) view.append(element("p", "test-report__hint", report.hint));
    view.append(
      element("p", "test-report__note", "Nothing was saved: your yard, its traps and your resources are as they were."),
    );
    return view;
  }

  private towersView(): HTMLElement {
    const { report, onBuilding } = this.options;
    const tap = (id: number, name: string): ((from: HTMLElement) => void) | undefined =>
      onBuilding
        ? (from) => {
            this.peek(name, from);
            onBuilding(id);
          }
        : undefined;
    const view = element("div", "test-report__view");
    if (report.towers.length === 0) {
      view.append(element("p", "test-report__empty", "Your yard has no towers."));
    } else {
      view.append(
        table(
          onBuilding ? "Towers, most damage first. Tap one to see it on your yard." : "Towers, most damage first.",
          ["Tower", "Damage", "Kills", "Shots", "First shot", "Fate"],
          report.towers.map((tower) =>
            row(
              [tower.name, amount(tower.damage), amount(tower.kills), amount(tower.shots), tower.firstShot, tower.fate],
              tap(tower.id, tower.name),
              !tower.fired,
            ),
          ),
        ),
      );
    }
    if (report.traps.length > 0) {
      view.append(
        table(
          "Traps",
          ["Trap", "Went off", "Damage", "Kills"],
          report.traps.map((trap) =>
            row([trap.name, trap.at, amount(trap.damage), amount(trap.kills)], tap(trap.id, trap.name)),
          ),
        ),
      );
    }
    if (report.bunkers.length > 0) {
      view.append(
        table(
          "Bunkers",
          ["Bunker", "Held", "Sent out", "Damage", "Kills", "Lost", "Fate"],
          report.bunkers.map((bunker) =>
            row(
              [
                bunker.name,
                amount(bunker.held),
                amount(bunker.sent),
                amount(bunker.damage),
                amount(bunker.kills),
                amount(bunker.lost),
                bunker.fate,
              ],
              tap(bunker.id, bunker.name),
            ),
          ),
        ),
      );
    }
    const caged = report.cagedChampion;
    if (caged) {
      view.append(
        table("Caged champion", ["Champion", "Damage", "Kills", "Health left"], [
          row(["Your champion", amount(caged.damage), amount(caged.kills), amount(caged.health)]),
        ]),
      );
    }
    return view;
  }

  private attackersView(): HTMLElement {
    const { report } = this.options;
    const view = element("div", "test-report__view");
    if (report.attackers.length === 0) {
      view.append(element("p", "test-report__empty", "Nothing was dropped."));
      return view;
    }
    view.append(
      table(
        "Attackers",
        ["Monster", "Sent / lost", "Building damage"],
        report.attackers.map((attacker) =>
          row([
            attacker.name,
            `${amount(attacker.sent)}${attacker.spawned > 0 ? ` (+${amount(attacker.spawned)} born)` : ""} / ${amount(attacker.lost)}`,
            amount(attacker.buildingDamage),
          ]),
        ),
      ),
    );
    return view;
  }
}
