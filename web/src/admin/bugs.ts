import {
  TICKET_STATUSES,
  fetchBugReport,
  fetchBugReports,
  fetchReportImage,
  updateTicket,
  type BugFilter,
  type BugReportDetail,
  type BugReportSummary,
  type TicketChange,
  type TicketStatus,
} from "./api";
import { h, replace, type Child } from "./dom";
import { ago, dateTime, statusWord } from "./format";

/**
 * The bug reports section: the list, newest first, with Open / All / Closed,
 * and one report's page with the player's words, the game's details, the
 * screenshot, the ticket status, the owner's notes and what changed when.
 *
 * The open report is in the address (`?bug=<id>`), as the alerts link it, so
 * the phone's back button returns to the list.
 */

const FILTERS: readonly [BugFilter, string][] = [
  ["open", "Open"],
  ["all", "All"],
  ["closed", "Closed"],
];

const pill = (status: TicketStatus): HTMLElement =>
  h("span", { class: `pill pill-${status}` }, statusWord(status));

/** The words for one change in a report's history. */
export const changeText = (change: TicketChange): string => {
  const parts: string[] = [];
  if (change.status) {
    parts.push(
      change.status.from
        ? `Status: ${statusWord(change.status.from)} → ${statusWord(change.status.to)}`
        : `Status: ${statusWord(change.status.to)}`,
    );
  }
  if (change.notes !== null)
    parts.push(change.notes ? `Notes: ${change.notes}` : "Notes cleared");
  return parts.join(" · ") || "Changed";
};

/** Who sent it, as the list and the report show it. */
export const sender = (report: Pick<BugReportSummary, "userid" | "username">): string =>
  report.userid === null ? "Signed out" : `${report.username ?? "?"} (#${report.userid})`;

export interface BugsOptions {
  /** Called when a report is opened or closed, to put it in the address. */
  onRoute(id: number | null): void;
  onError(message: string): void;
}

export class BugsView {
  readonly element = h("div", { class: "bugs" });
  private filter: BugFilter = "open";
  private reports: BugReportSummary[] = [];
  private nextBefore: number | null = null;
  private openId: number | null = null;
  private images: string[] = [];

  constructor(private readonly options: BugsOptions) {}

  /** Shows the list, or report `id`. */
  async show(id: number | null): Promise<void> {
    this.openId = id;
    if (id === null) await this.loadList();
    else await this.loadReport(id);
  }

  /** Reloads whatever is showing (the page's refresh). */
  refresh(): Promise<void> {
    return this.show(this.openId);
  }

  private releaseImages(): void {
    for (const url of this.images) URL.revokeObjectURL(url);
    this.images = [];
  }

  private async loadList(more = false): Promise<void> {
    this.releaseImages();
    try {
      const answer = await fetchBugReports(
        this.filter,
        more ? (this.nextBefore ?? undefined) : undefined,
      );
      this.reports = more ? [...this.reports, ...answer.reports] : answer.reports;
      this.nextBefore = answer.nextBefore;
      this.renderList();
    } catch (err) {
      this.options.onError(`Bug reports could not be loaded: ${String(err)}`);
    }
  }

  private renderList(): void {
    const tabs = h(
      "div",
      { class: "segmented", attrs: { role: "group", "aria-label": "Which bug reports" } },
      ...FILTERS.map(([filter, label]) =>
        h(
          "button",
          {
            class: "seg",
            attrs: { type: "button", "aria-pressed": String(filter === this.filter) },
            onClick: () => {
              this.filter = filter;
              void this.loadList();
            },
          },
          label,
        ),
      ),
    );
    const items = this.reports.length
      ? h(
          "ul",
          { class: "list" },
          ...this.reports.map((report) =>
            h(
              "li",
              {},
              h(
                "button",
                {
                  class: "list-item",
                  attrs: { type: "button" },
                  onClick: () => this.options.onRoute(report.id),
                },
                h(
                  "span",
                  { class: "item-top" },
                  h("strong", {}, `#${report.id}`),
                  pill(report.status),
                  h("span", { class: "muted" }, ago(report.createdAt)),
                ),
                h("span", { class: "item-text" }, report.preview || "(no text)"),
                h(
                  "span",
                  { class: "item-meta" },
                  [
                    sender(report),
                    report.device,
                    report.screen,
                    report.hasScreenshot ? "screenshot" : null,
                    report.hasPicture ? "picture" : null,
                    report.hasNotes ? "notes" : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                ),
              ),
            ),
          ),
        )
      : h(
          "p",
          { class: "muted" },
          this.filter === "open" ? "No open bug reports." : "No bug reports.",
        );
    const more =
      this.nextBefore !== null
        ? h(
            "button",
            {
              class: "button wide",
              attrs: { type: "button" },
              onClick: () => void this.loadList(true),
            },
            "Show older",
          )
        : null;
    replace(this.element, tabs, items, more);
  }

  private async loadReport(id: number): Promise<void> {
    this.releaseImages();
    replace(this.element, h("p", { class: "muted" }, `Loading bug report #${id}…`));
    try {
      const { report } = await fetchBugReport(id);
      this.renderReport(report);
    } catch {
      replace(
        this.element,
        this.backButton(),
        h(
          "p",
          { class: "muted" },
          `There is no bug report #${id} (it may have been deleted after 180 days).`,
        ),
      );
    }
  }

  private backButton(): HTMLElement {
    return h(
      "button",
      {
        class: "button back",
        attrs: { type: "button" },
        onClick: () => this.options.onRoute(null),
      },
      "← All bug reports",
    );
  }

  private renderReport(report: BugReportDetail): void {
    this.releaseImages();
    const statusButtons = h(
      "div",
      { class: "status-grid", attrs: { role: "group", "aria-label": "Ticket status" } },
      ...TICKET_STATUSES.map((status) =>
        h(
          "button",
          {
            class: `status-button status-${status}`,
            attrs: { type: "button", "aria-pressed": String(status === report.status) },
            onClick: () => void this.save(report.id, { status }),
          },
          statusWord(status),
        ),
      ),
    );

    const notes = h("textarea", {
      class: "notes",
      attrs: {
        rows: "4",
        maxlength: "4000",
        "aria-label": "Your notes",
        placeholder: "Your notes (only you see them)",
      },
    });
    notes.value = report.ownerNotes;
    const saveNotes = h(
      "button",
      {
        class: "button primary",
        attrs: { type: "button", disabled: "" },
        onClick: () => void this.save(report.id, { notes: notes.value }),
      },
      "Save notes",
    );
    notes.addEventListener("input", () => {
      saveNotes.toggleAttribute("disabled", notes.value === report.ownerNotes);
    });

    const facts: [string, Child][] = [
      ["Sent", `${dateTime(report.createdAt)} (${ago(report.createdAt)})`],
      ["Player", sender(report)],
      ["Reply to", report.contactEmail],
      ["Game version", report.gameVersion],
      ["Screen", report.screen],
      ["Device", report.device],
      ["Browser", report.browser],
      ["Screen size", report.screenSize],
      ["Emailed", report.emailedAt ? dateTime(report.emailedAt) : "no"],
    ];

    const pictures = h("div", { class: "pictures" });
    const addImage = async (which: "screenshot" | "picture", label: string) => {
      const slot = h(
        "figure",
        { class: "picture" },
        h("figcaption", {}, label),
        h("p", { class: "muted" }, "Loading…"),
      );
      pictures.append(slot);
      try {
        const url = await fetchReportImage(report.id, which);
        this.images.push(url);
        const img = h("img", {
          attrs: { src: url, alt: `${label} of bug report #${report.id}` },
        });
        replace(
          slot,
          h(
            "figcaption",
            {},
            label,
            " · ",
            h(
              "a",
              { attrs: { href: url, target: "_blank", rel: "noopener" } },
              "open full size",
            ),
          ),
          img,
        );
      } catch (err) {
        replace(slot, h("figcaption", {}, label), h("p", { class: "muted" }, String(err)));
      }
    };
    if (report.hasScreenshot) void addImage("screenshot", "Screenshot");
    if (report.hasPicture) void addImage("picture", "Added picture");

    replace(
      this.element,
      this.backButton(),
      h(
        "div",
        { class: "card report" },
        h(
          "div",
          { class: "item-top" },
          h("h3", {}, `Bug report #${report.id}`),
          pill(report.status),
        ),
        h("p", { class: "message" }, report.message || "(no text)"),
        h("h4", {}, "Status"),
        statusButtons,
        h("h4", {}, "Your notes"),
        notes,
        h("div", { class: "actions" }, saveNotes),
      ),
      report.hasScreenshot || report.hasPicture
        ? h("div", { class: "card" }, h("h3", {}, "Pictures"), pictures)
        : null,
      h(
        "div",
        { class: "card" },
        h("h3", {}, "Game details"),
        h(
          "dl",
          { class: "facts" },
          ...facts
            .filter(([, value]) => value)
            .flatMap(([name, value]) => [h("dt", {}, name), h("dd", {}, value)]),
        ),
        ...(report.errors.length
          ? [
              h("h4", {}, "Last game errors"),
              h("ol", { class: "code-list" }, ...report.errors.map((e) => h("li", {}, e))),
            ]
          : [h("p", { class: "muted small" }, "No game errors were sent with it.")]),
        h(
          "details",
          {},
          h("summary", {}, "Browser details"),
          h("p", { class: "code" }, report.userAgent),
        ),
      ),
      h(
        "div",
        { class: "card" },
        h("h3", {}, "History"),
        report.changes.length
          ? h(
              "ol",
              { class: "history" },
              ...[...report.changes]
                .reverse()
                .map((change) =>
                  h(
                    "li",
                    {},
                    h("span", { class: "muted" }, dateTime(change.at)),
                    " ",
                    changeText(change),
                  ),
                ),
            )
          : h("p", { class: "muted" }, "No changes yet."),
      ),
    );
  }

  private async save(
    id: number,
    update: { status?: TicketStatus; notes?: string },
  ): Promise<void> {
    try {
      const { report } = await updateTicket(id, update);
      // Keep the list in step without reloading it.
      this.reports = this.reports.map((r) =>
        r.id === id ? { ...r, status: report.status, hasNotes: report.ownerNotes !== "" } : r,
      );
      if (this.openId === id) this.renderReport(report);
    } catch (err) {
      this.options.onError(`Not saved: ${String(err)}`);
    }
  }
}
