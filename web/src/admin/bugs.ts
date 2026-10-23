import {
  MAX_REPLY,
  TICKET_STATUSES,
  fetchBugReport,
  fetchBugReports,
  fetchReportImage,
  replyToReport,
  updateTicket,
  type BugFilter,
  type BugReportDetail,
  type BugReportSummary,
  type SupportMessage,
  type TicketChange,
  type TicketStatus,
} from "./api";
import { h, replace, type Child } from "./dom";
import { ago, count, dateTime, statusWord } from "./format";
import { icon } from "./icons";
import { technical } from "./sections";
import { awardForm, awardRow, errorWords } from "./shiny";

/**
 * The bug reports section: the list, newest first, with Open / All / Closed,
 * and one report's page with the player's words, the game's details, the
 * screenshot, the ticket status, the owner's notes and what changed when.
 *
 * The player can be written to in the game's mail (as "The game team") and
 * their answers show here; Shiny can be given from the report, and the mail
 * about it goes into the same conversation.
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
  h("span", { class: `pill pill-${status}` }, h("span", { class: "pill-dot" }), statusWord(status));

/** What each status means, under its button. */
const STATUS_HINTS: Record<TicketStatus, string> = {
  new: "Not looked at yet",
  working: "Being looked into",
  fixed: "Done; closes it",
  wontfix: "Not a bug, or not worth it; closes it",
};

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

/** The conversation with the report's player, oldest first. */
export const threadView = (thread: readonly SupportMessage[], playerName: string): HTMLElement =>
  thread.length
    ? h(
        "ol",
        { class: "thread", attrs: { "aria-label": "Messages with the player" } },
        ...thread.map((message) =>
          h(
            "li",
            { class: `bubble bubble-${message.from}` },
            h(
              "span",
              { class: "bubble-who" },
              message.from === "team" ? "You, as The game team" : playerName,
              " · ",
              h(
                "time",
                { attrs: { datetime: message.at, title: dateTime(message.at) } },
                ago(message.at),
              ),
              message.unread ? h("span", { class: "chip chip-info" }, "New") : null,
            ),
            h("span", { class: "bubble-text" }, message.text),
          ),
        ),
      )
    : h(
        "p",
        { class: "note" },
        "No messages yet. What you write reaches the player in the game's Mail, from The game team, and they can answer it.",
      );

/** Who sent it, as the list and the report show it. */
export const sender = (report: Pick<BugReportSummary, "userid" | "username">): string =>
  report.userid === null ? "Signed out" : `${report.username ?? "?"} (#${report.userid})`;

export interface BugsOptions {
  /** Called when a report is opened or closed, to put it in the address. */
  onRoute(id: number | null): void;
  onError(message: string): void;
  /** A short "done" message (the page's toast). */
  onSay(message: string): void;
  /** Shiny was given from a report: the Shiny section's log is out of date. */
  onAward(): void;
}

/** What the owner has typed on a report but not sent, kept when the page is drawn again. */
interface Draft {
  id: number;
  reply: string;
  award: { amount: string; reason: string };
}

export class BugsView {
  readonly element = h("div", { class: "bugs" });
  private filter: BugFilter = "open";
  private reports: BugReportSummary[] = [];
  private nextBefore: number | null = null;
  private openId: number | null = null;
  private images: string[] = [];
  private draft: Draft | null = null;

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
          { class: "rows" },
          ...this.reports.map((report) =>
            h(
              "li",
              {},
              h(
                "button",
                {
                  class: "row bug-row",
                  attrs: { type: "button" },
                  onClick: () => this.options.onRoute(report.id),
                },
                h(
                  "span",
                  { class: "row-main" },
                  h(
                    "span",
                    { class: "row-top" },
                    pill(report.status),
                    report.unreadReplies > 0
                      ? h(
                          "span",
                          { class: "chip chip-info" },
                          report.unreadReplies === 1
                            ? "New reply"
                            : `${count(report.unreadReplies)} new replies`,
                        )
                      : null,
                    h("span", { class: "row-when" }, ago(report.createdAt)),
                  ),
                  h("span", { class: "row-title" }, report.preview || "(no text)"),
                  h(
                    "span",
                    { class: "row-meta" },
                    [
                      `#${report.id}`,
                      sender(report),
                      report.device,
                      report.screen ? `${report.screen} screen` : null,
                      report.hasScreenshot || report.hasPicture ? "has a picture" : null,
                      report.hasNotes ? "has your notes" : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  ),
                ),
                icon("chevron", 18),
              ),
            ),
          ),
        )
      : h(
          "div",
          { class: "empty" },
          h(
            "strong",
            {},
            this.filter === "open"
              ? "No open bug reports"
              : this.filter === "closed"
                ? "No closed bug reports"
                : "No bug reports yet",
          ),
          h(
            "p",
            {},
            this.filter === "open"
              ? "Nothing is waiting for you. New ones from players show up here."
              : "When players send one from the game, it shows up here.",
          ),
        );
    const more =
      this.nextBefore !== null
        ? h(
            "button",
            {
              class: "button wide quiet",
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
    replace(
      this.element,
      h("div", { class: "skeleton", attrs: { "aria-label": `Loading bug report #${id}` } }),
    );
    try {
      const { report } = await fetchBugReport(id);
      // Opening it read the player's answers.
      this.reports = this.reports.map((r) => (r.id === id ? { ...r, unreadReplies: 0 } : r));
      this.renderReport(report);
    } catch {
      replace(
        this.element,
        this.backButton(),
        h(
          "div",
          { class: "empty" },
          h("strong", {}, `No bug report #${id}`),
          h("p", {}, "It may have been deleted: reports are kept for 180 days."),
        ),
      );
    }
  }

  private backButton(): HTMLElement {
    return h(
      "button",
      {
        class: "button quiet back",
        attrs: { type: "button" },
        onClick: () => this.options.onRoute(null),
      },
      icon("back", 18),
      "All bug reports",
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
            onClick: (event) => {
              if (status === report.status) return;
              (event.currentTarget as HTMLElement).classList.add("is-saving");
              void this.save(report.id, { status });
            },
          },
          h("span", { class: "status-name" }, h("span", { class: "pill-dot" }), statusWord(status)),
          h("span", { class: "status-hint" }, STATUS_HINTS[status]),
        ),
      ),
    );

    const notes = h("textarea", {
      class: "notes",
      attrs: {
        rows: "4",
        maxlength: "4000",
        id: "owner-notes",
        placeholder: "What you found, what to do next…",
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

    if (this.draft?.id !== report.id)
      this.draft = { id: report.id, reply: "", award: { amount: "", reason: "" } };
    const draft = this.draft;

    const facts: [string, Child][] = [
      ["Sent", `${dateTime(report.createdAt)} (${ago(report.createdAt)})`],
      ["Player", sender(report)],
      ["Reply to", report.contactEmail],
      ["Where in the game", report.screen],
      ["Device", report.device],
      ["Browser", report.browser],
      ["Screen size", report.screenSize],
      ["Game version", report.gameVersion],
      ["Also emailed to you", report.emailedAt ? dateTime(report.emailedAt) : "no"],
    ];

    const pictures = h("div", { class: "pictures" });
    const addImage = async (which: "screenshot" | "picture", label: string) => {
      const slot = h(
        "figure",
        { class: "picture" },
        h("div", { class: "picture-frame skeleton" }),
        h("figcaption", {}, label),
      );
      pictures.append(slot);
      try {
        const url = await fetchReportImage(report.id, which);
        this.images.push(url);
        replace(
          slot,
          h(
            "a",
            {
              class: "picture-frame",
              attrs: { href: url, target: "_blank", rel: "noopener", title: "Open full size" },
            },
            h("img", { attrs: { src: url, alt: `${label} of bug report #${report.id}` } }),
          ),
          h("figcaption", {}, label, h("span", { class: "hint" }, " · tap to open full size")),
        );
      } catch (err) {
        replace(slot, h("figcaption", {}, label), h("p", { class: "note" }, String(err)));
      }
    };
    if (report.hasScreenshot) void addImage("screenshot", "Screenshot");
    if (report.hasPicture) void addImage("picture", "Added picture");

    replace(
      this.element,
      this.backButton(),
      h(
        "article",
        { class: "report" },
        h(
          "header",
          { class: "report-head" },
          h("h3", {}, `Bug report #${report.id}`),
          pill(report.status),
        ),
        h(
          "p",
          { class: "report-from" },
          [sender(report), report.device, report.screen ? `${report.screen} screen` : null, ago(report.createdAt)]
            .filter(Boolean)
            .join(" · "),
        ),
        h("blockquote", { class: "message" }, report.message || "(no text)"),
        report.hasScreenshot || report.hasPicture ? pictures : null,
        h("div", { class: "report-block" }, h("h4", {}, "Status"), statusButtons),
        this.conversation(report, draft),
        this.shinyBlock(report, draft),
        h(
          "div",
          { class: "report-block" },
          h(
            "h4",
            {},
            h("label", { attrs: { for: "owner-notes" } }, "Your notes"),
            h("span", { class: "hint" }, " only you see them"),
          ),
          notes,
          h("div", { class: "actions" }, saveNotes),
        ),
        h(
          "div",
          { class: "report-block" },
          h("h4", {}, "About the player's game"),
          h(
            "dl",
            { class: "facts" },
            ...facts
              .filter(([, value]) => value)
              .flatMap(([name, value]) => [h("dt", {}, name), h("dd", {}, value)]),
          ),
          technical(
            `Technical details${report.errors.length ? ` (${report.errors.length} game errors)` : ""}`,
            report.errors.length
              ? h("ol", { class: "code-list" }, ...report.errors.map((e) => h("li", {}, e)))
              : h("p", { class: "note" }, "No game errors were sent with it."),
            h("p", { class: "code" }, report.userAgent),
          ),
        ),
        h(
          "div",
          { class: "report-block" },
          h("h4", {}, "History"),
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
                      h("span", { class: "history-when" }, dateTime(change.at)),
                      h("span", {}, changeText(change)),
                    ),
                  ),
              )
            : h("p", { class: "note" }, "No changes yet."),
        ),
      ),
    );
  }

  /** The messages with the player, and the box to write the next one. */
  private conversation(report: BugReportDetail, draft: Draft): HTMLElement {
    const name = report.username ?? "The player";
    const title = h("h4", {}, "Messages with the player");
    if (report.cannotReply) {
      const why =
        report.cannotReply === "signedOut"
          ? h(
              "p",
              { class: "note" },
              "Sent while signed out, so there is no game account to write to.",
              ...(report.contactEmail
                ? [
                    " Reply by email: ",
                    h("a", { attrs: { href: `mailto:${report.contactEmail}` } }, report.contactEmail),
                  ]
                : []),
            )
          : h("p", { class: "note" }, "The player's account is gone, so they cannot get messages.");
      return h(
        "div",
        { class: "report-block" },
        title,
        report.thread.length ? threadView(report.thread, name) : null,
        why,
      );
    }
    const box = h("textarea", {
      class: "notes reply-box",
      attrs: {
        id: "reply-text",
        rows: "3",
        maxlength: String(MAX_REPLY),
        placeholder: `Write to ${name}…`,
        "aria-describedby": "reply-count",
      },
    });
    box.value = draft.reply;
    const counter = h("span", { class: "counter", attrs: { id: "reply-count" } });
    const send = h("button", { class: "button primary", attrs: { type: "button" } }, "Send");
    const sync = () => {
      counter.textContent = `${box.value.length} / ${MAX_REPLY}`;
      send.disabled = box.value.trim() === "";
    };
    sync();
    box.addEventListener("input", () => {
      draft.reply = box.value;
      sync();
    });
    send.addEventListener("click", () => {
      const text = box.value.trim();
      if (!text) return;
      send.disabled = true;
      box.disabled = true;
      send.textContent = "Sending…";
      void replyToReport(report.id, text)
        .then(({ report: updated }) => {
          draft.reply = "";
          this.options.onSay(`Sent to ${name}'s Mail in the game`);
          if (this.openId === report.id) this.renderReport(updated);
        })
        .catch((err: unknown) => {
          box.disabled = false;
          send.textContent = "Send";
          sync();
          this.options.onError(`Not sent: ${errorWords(err)}`);
        });
    });
    return h(
      "div",
      { class: "report-block" },
      title,
      threadView(report.thread, name),
      h(
        "label",
        { class: "sr-only", attrs: { for: "reply-text" } },
        `Your message to ${name}`,
      ),
      box,
      h(
        "div",
        { class: "actions split" },
        h("span", { class: "hint" }, counter, " · they see it from The game team"),
        send,
      ),
    );
  }

  /** Shiny given from this report, and the form to give more. */
  private shinyBlock(report: BugReportDetail, draft: Draft): HTMLElement | null {
    if (report.userid === null || report.cannotReply === "noPlayer") return null;
    const player = { userid: report.userid, username: report.username ?? `#${report.userid}` };
    return h(
      "div",
      { class: "report-block" },
      h("h4", {}, "Give Shiny", h("span", { class: "hint" }, " the mail about it joins the messages above")),
      report.awards.length
        ? h(
            "ul",
            { class: "rows award-log" },
            ...report.awards.map((award) => awardRow(award, undefined, false)),
          )
        : null,
      awardForm({
        player,
        bugReportId: report.id,
        draft: draft.award,
        onDraft: (award) => (draft.award = award),
        onGiven: (award, already, updated) => {
          this.options.onSay(
            already
              ? "That gift was already given"
              : `Gave ${count(award.amount)} Shiny to ${award.username}`,
          );
          this.options.onAward();
          if (updated && this.openId === report.id) this.renderReport(updated);
        },
      }),
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
