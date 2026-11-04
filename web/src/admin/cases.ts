import {
  MAX_MODERATION_REASON,
  MAX_SHINY_AWARD,
  actOnCase,
  awardCaseReporters,
  fetchChatCases,
  type CaseHistory,
  type CaseList,
  type CaseMessage,
  type CaseReporter,
  type ChatCaseView,
  type SnapshotLine,
} from "./api";
import { h, replace, type Child } from "./dom";
import { ago, count, dateTime, plural } from "./format";
import { icon, type IconName } from "./icons";
import { DEFAULT_WARNING, roomLabel, severityChip } from "./moderation";
import { errorWords } from "./shiny";

/**
 * Chat cases, the top of the Moderation work (server
 * `services/admin/chatCases.ts`): every report of the same line, and every
 * reported line of a player not yet acted on, is one case. A case shows the
 * line, a text copy of the room around it, who reported it, and the player's
 * record, with three steps, each asked once more before it is done:
 * warn (and pause their chat), give the reporters Shiny, or dismiss.
 * Closed cases are folded away below.
 */

/** The step picker: a warning alone, or a warning with chat paused this many hours. */
export const CASE_STEPS: readonly (readonly [number | null, string])[] = [
  [null, "Warn only"],
  [1, "1 h"],
  [24, "24 h"],
  [72, "3 d"],
  [168, "7 d"],
];

/** The mail each rewarded reporter gets (the server's default reason). */
const AWARD_MAIL = "Thank you for reporting a chat message that broke the rules.";

/** "1 hour", "1 day", "3 days". */
export const lengthWords = (hours: number): string =>
  hours >= 24 && hours % 24 === 0 ? plural(hours / 24, "day") : plural(hours, "hour");

/** "Warn" or "Warn + pause 3 days". */
export const stepWords = (hours: number | null): string =>
  hours === null ? "Warn" : `Warn + pause ${lengthWords(hours)}`;

/** What was done to a closed case, in a word or three. */
export const outcomeWords = (closed: NonNullable<ChatCaseView["closed"]>): string =>
  closed.outcome === "dismiss"
    ? "Dismissed"
    : closed.outcome === "warn"
      ? "Warned"
      : `Warned + paused ${closed.hours === null ? "" : lengthWords(closed.hours)}`.trim();

/** Earlier warnings, pauses and bans. */
export const earlierSteps = (history: CaseHistory): number =>
  history.warnings + history.mutes + history.bans;

/** The player's record before this case: "1 warning, 2 lines caught by the filter". */
export const historyWords = (history: CaseHistory): string => {
  const parts = [
    history.warnings ? plural(history.warnings, "warning") : null,
    history.mutes ? plural(history.mutes, "chat pause") : null,
    history.bans ? plural(history.bans, "ban") : null,
    history.flags
      ? `${plural(history.flags, "line")} caught by the filter`
      : null,
    history.cases ? plural(history.cases, "earlier case") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Clean record";
};

/** The picker's step to start with: the server's suggestion. */
export const suggestedStep = (suggest: ChatCaseView["suggest"]): number => {
  if (suggest.action === "warn" || suggest.hours === null) return 0;
  const hours = suggest.hours;
  const exact = CASE_STEPS.findIndex(([h]) => h === hours);
  if (exact >= 0) return exact;
  const longer = CASE_STEPS.findIndex(([h]) => h !== null && h > hours);
  return longer >= 0 ? longer : CASE_STEPS.length - 1;
};

/** The Shiny a reporter is offered by default: more for the first. */
export const defaultAward = (reporter: CaseReporter, award: { each: number; first: number }): number =>
  reporter.first ? award.first : award.each;

const nameOf = (userid: number, username: string | null): string => username ?? `#${userid}`;

/** "14:02" for a time in ms, in the viewer's time zone. */
const clock = (ms: number): string => dateTime(new Date(ms).toISOString()).split(" ").pop() ?? "";

/** An icon with a number, and the words for a screen reader and a hover. */
const stat = (name: IconName, value: number, words: string, extra = ""): HTMLElement =>
  h(
    "span",
    { class: `case-stat${extra}`, attrs: { title: `${value} ${words}` } },
    icon(name, 14),
    String(value),
    h("span", { class: "sr-only" }, ` ${words}`),
  );

/** One line of the room copy; the reported line is marked. */
const snapshotLine = (line: SnapshotLine, offender: number): HTMLElement =>
  h(
    "li",
    {
      class: `snap-line${line.reported ? " is-reported" : ""}${line.userid === offender ? " is-them" : ""}`,
    },
    h("time", { class: "snap-time", attrs: { datetime: new Date(line.at).toISOString() } }, clock(line.at)),
    h("strong", { class: "snap-who" }, nameOf(line.userid, line.name)),
    h(
      "span",
      { class: "snap-text" },
      line.reported ? h("span", { class: "snap-mark" }, icon("flag", 13), h("span", { class: "sr-only" }, "Reported: ")) : null,
      line.flagged ? severityChip(line.flagged) : null,
      line.flagged ? " " : null,
      line.text,
    ),
  );

const SOURCE_WORDS: Record<CaseMessage["snapshot"]["source"], string> = {
  log: "Copied from the chat log when it was reported: their own words.",
  room: "Copied from the room when it was reported: as players saw it, starred out.",
  none: "No copy of the room was found.",
};

/** One reported line and the room around it. */
const messageBlock = (message: CaseMessage, offender: number): HTMLElement => {
  const lines = message.snapshot.lines;
  const marked = lines.some((line) => line.reported);
  return h(
    "div",
    { class: "case-line", attrs: { "data-message": String(message.id) } },
    h(
      "p",
      { class: "row-meta case-line-meta" },
      `${roomLabel(message.channel)} · `,
      h(
        "time",
        { attrs: { datetime: new Date(message.ts).toISOString() } },
        dateTime(new Date(message.ts).toISOString()),
      ),
      " · ",
      stat("flag", message.reporters.length, message.reporters.length === 1 ? "report" : "reports"),
      message.verified
        ? null
        : h(
            "span",
            {
              class: "chip chip-warn",
              attrs: { title: "The chat server had no copy of the line to check the words against." },
            },
            "Not matched",
          ),
    ),
    marked ? null : h("p", { class: "chat-quote" }, `“${message.message}”`),
    lines.length
      ? h("ol", { class: "snap", attrs: { "aria-label": "The room around the line" } }, ...lines.map((l) => snapshotLine(l, offender)))
      : null,
    h("p", { class: "note" }, SOURCE_WORDS[lines.length ? message.snapshot.source : "none"]),
  );
};

const reporterItem = (reporter: CaseReporter): HTMLElement =>
  h(
    "li",
    { class: "case-reporter" },
    h("span", {}, nameOf(reporter.userid, reporter.username)),
    reporter.first ? h("span", { class: "chip chip-info", attrs: { title: "Reported first" } }, "1st") : null,
    reporter.late ? h("span", { class: "chip chip-quiet", attrs: { title: "Reported after the case was closed" } }, "late") : null,
    reporter.award
      ? h(
          "span",
          { class: "chip chip-good chip-icon", attrs: { title: `Given ${dateTime(reporter.award.at)}` } },
          icon("gift", 13),
          `+${count(reporter.award.amount)}`,
        )
      : null,
  );

interface PanelSpec {
  fields: Child[];
  /** The button that leads to the question. */
  next: string;
  /** Why it cannot go on yet, or null. */
  check(): string | null;
  question(): string;
  sees(): string;
  yes: string;
  busy: string;
  danger?: boolean;
  send(): Promise<void>;
  cancel(): void;
}

/** A small form: its fields, then "are you sure?" in place of its button. */
const panel = (spec: PanelSpec): { element: HTMLFormElement; changed(): void } => {
  const problem = h("p", { class: "form-error", attrs: { role: "alert", hidden: "" } });
  const say = (text: string | null) => {
    problem.hidden = text === null;
    problem.textContent = text ?? "";
  };
  const next = h("button", { class: "button primary", attrs: { type: "submit" } }, spec.next);
  const cancel = h("button", { class: "button quiet", attrs: { type: "button" }, onClick: () => spec.cancel() }, "Cancel");
  const submitRow = h("div", { class: "actions" }, cancel, next);
  const question = h("p", { class: "confirm-question" });
  const yes = h("button", { class: spec.danger ? "button danger" : "button primary", attrs: { type: "button" } }, spec.yes);
  const back = h("button", { class: "button quiet", attrs: { type: "button" } }, "Go back");
  const seesNote = h("p", { class: "note" });
  const confirm = h(
    "div",
    { class: "confirm", attrs: { hidden: "" } },
    question,
    seesNote,
    h("div", { class: "actions" }, back, yes),
  );
  const setConfirming = (on: boolean) => {
    confirm.hidden = !on;
    submitRow.hidden = on;
  };
  const form = h("form", { class: "case-form", attrs: { novalidate: "" } }, ...spec.fields, problem, submitRow, confirm);
  const controls = () => [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>("input, button, textarea")];
  let busy = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    const why = spec.check();
    if (why) {
      say(why);
      return;
    }
    say(null);
    question.textContent = spec.question();
    seesNote.textContent = spec.sees();
    setConfirming(true);
    yes.focus();
  });
  back.addEventListener("click", () => setConfirming(false));
  yes.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    const was = controls().map((el) => el.disabled);
    for (const el of controls()) el.disabled = true;
    yes.textContent = spec.busy;
    void spec
      .send()
      .catch((err: unknown) => {
        controls().forEach((el, i) => (el.disabled = was[i] ?? false));
        yes.textContent = spec.yes;
        setConfirming(false);
        say(`Not done: ${errorWords(err)}`);
      })
      .finally(() => {
        busy = false;
      });
  });
  return {
    element: form,
    changed: () => {
      say(null);
      setConfirming(false);
    },
  };
};

type PanelKind = "act" | "award" | "dismiss";

export interface CasesOptions {
  say(message: string): void;
  /** The number of open cases, or null when it could not be read. */
  onCount(open: number | null): void;
  /** Opens the player in the Moderation section. */
  openPlayer(userid: number): void;
  /** A case was acted on: the player's state changed elsewhere too. */
  onChanged(): void;
}

/** The Chat cases section. */
export class CasesView {
  readonly element = h("div", { class: "cases" });
  private readonly openList = h("div", { class: "group" }, h("div", { class: "skeleton" }));
  private readonly closedBody = h("div", { class: "group" });
  private readonly closedFold: HTMLDetailsElement;
  private openCases: ChatCaseView[] = [];
  private openNext: number | null = null;
  private closedCases: ChatCaseView[] = [];
  private closedNext: number | null = null;
  private closedLoaded = false;
  private award = { each: 25, first: 50 };
  /** Cases whose card is open, kept across a refresh. */
  private readonly expanded = new Set<number>();
  /** Cases closed here, kept in the open list until their reporters are seen to. */
  private readonly kept = new Map<number, ChatCaseView>();
  /** The form open in each card. */
  private readonly panels = new Map<number, PanelKind>();
  private readonly items = new Map<number, HTMLElement>();
  private seq = 0;

  constructor(private readonly options: CasesOptions) {
    this.closedFold = h(
      "details",
      { class: "fold cases-closed" },
      h("summary", {}, icon("chevron", 16), h("span", {}, "Closed cases")),
      this.closedBody,
    );
    this.closedFold.addEventListener("toggle", () => {
      if (this.closedFold.open && !this.closedLoaded) void this.loadClosed();
    });
    replace(this.element, this.openList, this.closedFold);
  }

  /** Loads the open cases again (and the closed ones, if they are on show). */
  async refresh(): Promise<void> {
    await Promise.all([this.loadOpen(), this.closedFold.open ? this.loadClosed() : Promise.resolve()]);
  }

  private async loadOpen(more = false): Promise<void> {
    const seq = ++this.seq;
    let answer: CaseList;
    try {
      answer = await fetchChatCases("open", more ? (this.openNext ?? undefined) : undefined);
    } catch (err) {
      if (seq !== this.seq) return;
      this.options.onCount(null);
      replace(this.openList, h("p", { class: "note" }, `The chat cases could not be loaded: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.seq) return;
    this.award = answer.award;
    this.openCases = more ? [...this.openCases, ...answer.cases] : answer.cases;
    this.openNext = answer.nextOffset;
    this.options.onCount(answer.open);
    this.renderOpen(answer.open);
  }

  private async loadClosed(more = false): Promise<void> {
    if (!more && !this.closedLoaded) replace(this.closedBody, h("div", { class: "skeleton" }));
    let answer: CaseList;
    try {
      answer = await fetchChatCases("closed", more ? (this.closedNext ?? undefined) : undefined);
    } catch (err) {
      replace(this.closedBody, h("p", { class: "note" }, `The closed cases could not be loaded: ${errorWords(err)}`));
      return;
    }
    this.closedLoaded = true;
    this.award = answer.award;
    this.closedCases = more ? [...this.closedCases, ...answer.cases] : answer.cases;
    this.closedNext = answer.nextOffset;
    replace(
      this.closedBody,
      this.closedCases.length
        ? h("ul", { class: "rows case-list" }, ...this.closedCases.map((view) => this.item(view)))
        : h("p", { class: "note" }, "No closed cases yet."),
      this.closedNext !== null
        ? h(
            "button",
            { class: "button wide quiet", attrs: { type: "button" }, onClick: () => void this.loadClosed(true) },
            "Show older",
          )
        : null,
    );
  }

  private renderOpen(open: number): void {
    const ids = new Set(this.openCases.map((view) => view.id));
    const kept = [...this.kept.values()].filter((view) => !ids.has(view.id));
    const shown = [...kept, ...this.openCases];
    replace(
      this.openList,
      h(
        "div",
        { class: "log-head" },
        h("h3", {}, "Open cases ", h("span", { class: "case-count" }, String(open))),
        h("span", { class: "hint" }, "One case per player: every report of their lines, and the room around each."),
      ),
      shown.length
        ? h("ul", { class: "rows case-list" }, ...shown.map((view) => this.item(view)))
        : h(
            "div",
            { class: "empty" },
            h("strong", {}, "No open cases"),
            h("p", {}, "When a player reports a chat line, it shows up here."),
          ),
      this.openNext !== null
        ? h(
            "button",
            { class: "button wide quiet", attrs: { type: "button" }, onClick: () => void this.loadOpen(true) },
            "Show more",
          )
        : null,
    );
  }

  /** Draws a case again in place, after a step. */
  private redraw(view: ChatCaseView): void {
    const old = this.items.get(view.id);
    for (const list of [this.openCases, this.closedCases]) {
      const at = list.findIndex((c) => c.id === view.id);
      if (at >= 0) list[at] = view;
    }
    if (this.kept.has(view.id)) this.kept.set(view.id, view);
    if (old?.isConnected) old.replaceWith(this.item(view));
  }

  /** One case: a compact row that opens into its card. */
  private item(view: ChatCaseView): HTMLElement {
    const name = nameOf(view.reported.userid, view.reported.username);
    const earlier = earlierSteps(view.history);
    const first = view.messages[0];
    const details = h(
      "details",
      { class: "case", attrs: { "data-case": String(view.id), ...(this.expanded.has(view.id) ? { open: "" } : {}) } },
      h(
        "summary",
        { class: "row case-row" },
        h(
          "span",
          { class: "row-main" },
          h(
            "span",
            { class: "row-top" },
            h("strong", { class: "report-who" }, name),
            view.reported.banned ? h("span", { class: "chip chip-bad" }, "Banned") : null,
            view.reported.muted ? h("span", { class: "chip chip-warn" }, "Paused") : null,
            view.closed
              ? h("span", { class: `chip ${view.closed.outcome === "dismiss" ? "chip-quiet" : "chip-good"}` }, outcomeWords(view.closed))
              : null,
            h(
              "time",
              { class: "row-when", attrs: { datetime: view.lastReportAt, title: dateTime(view.lastReportAt) } },
              ago(view.lastReportAt),
            ),
          ),
          first
            ? h(
                "span",
                { class: "chat-quote case-quote" },
                `“${first.message}”`,
                view.messages.length > 1 ? h("span", { class: "hint" }, ` +${view.messages.length - 1} more`) : null,
              )
            : null,
          h(
            "span",
            { class: "case-stats" },
            stat("chat", view.messages.length, view.messages.length === 1 ? "line reported" : "lines reported"),
            stat("flag", view.reports, view.reports === 1 ? "report" : "reports"),
            earlier ? stat("history", earlier, "earlier warnings, pauses or bans", " is-warn") : null,
            view.history.flags ? stat("warn", view.history.flags, "lines caught by the word filter", " is-warn") : null,
            first ? h("span", { class: "case-room" }, roomLabel(first.channel)) : null,
          ),
        ),
        icon("chevron", 18),
      ),
      this.card(view),
    );
    details.addEventListener("toggle", () => {
      if (details.open) this.expanded.add(view.id);
      else this.expanded.delete(view.id);
    });
    const li = h("li", {}, details);
    this.items.set(view.id, li);
    return li;
  }

  private card(view: ChatCaseView): HTMLElement {
    const name = nameOf(view.reported.userid, view.reported.username);
    const waiting = view.reporters.filter((r) => r.award === null);
    const panelKind = this.panels.get(view.id) ?? null;
    const panelBox = h("div", { class: "case-panel" });
    const open = (kind: PanelKind | null) => {
      if (kind === null) this.panels.delete(view.id);
      else this.panels.set(view.id, kind);
      for (const button of buttons.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
        button.setAttribute("aria-expanded", String(button.dataset["panel"] === kind));
      }
      replace(panelBox, kind ? this.panelFor(kind, view, cancel) : null);
      panelBox.querySelector<HTMLElement>("textarea, input, button")?.focus();
    };
    const button = (kind: PanelKind, iconName: IconName, words: string, cls = "button") =>
      h(
        "button",
        {
          class: cls,
          attrs: { type: "button", "data-panel": kind, "aria-expanded": String(panelKind === kind) },
          onClick: () => open(this.panels.get(view.id) === kind ? null : kind),
        },
        icon(iconName, 16),
        words,
      );
    const buttons = h(
      "div",
      { class: "case-actions" },
      view.status === "open" ? button("act", "warn", "Warn + pause", "button primary") : null,
      waiting.length ? button("award", "gift", `Award ${waiting.length}`) : null,
      view.status === "open" ? button("dismiss", "x", "Dismiss", "button quiet") : null,
    );
    /** Cancel: a case closed here leaves the open list once its reporters are seen to. */
    const cancel = () => {
      open(null);
      if (this.kept.delete(view.id)) void this.loadOpen();
    };
    if (panelKind) replace(panelBox, this.panelFor(panelKind, view, cancel));
    const suggestion = view.suggest.action === "warn" ? stepWords(null) : stepWords(view.suggest.hours);
    return h(
      "div",
      { class: "case-card" },
      ...view.messages.map((message) => messageBlock(message, view.reported.userid)),
      h(
        "div",
        { class: "case-who" },
        h("h4", {}, `Reported by ${view.reporters.length}`),
        h("ul", { class: "case-reporters" }, ...view.reporters.map(reporterItem)),
      ),
      h(
        "p",
        { class: "case-history" },
        icon("history", 16),
        h("span", {}, `Before: ${historyWords(view.history)}. `),
        h(
          "button",
          {
            class: "link-button",
            attrs: { type: "button" },
            onClick: () => this.options.openPlayer(view.reported.userid),
          },
          `Open ${name}`,
        ),
      ),
      view.closed
        ? h(
            "p",
            { class: "case-done" },
            h("span", { class: `chip ${view.closed.outcome === "dismiss" ? "chip-quiet" : "chip-good"}` }, outcomeWords(view.closed)),
            ` by ${view.closed.byName ?? `#${view.closed.by}`}, ${dateTime(view.closed.at)}`,
            view.closed.note ? ` · “${view.closed.note}”` : null,
          )
        : h("p", { class: "case-suggest" }, h("strong", {}, "Suggested: "), suggestion),
      view.reported.gameTeam ? h("p", { class: "note" }, "A game team account: it cannot be warned or paused.") : null,
      buttons.childElementCount ? buttons : null,
      panelBox,
    );
  }

  private panelFor(kind: PanelKind, view: ChatCaseView, close: () => void): HTMLElement {
    if (kind === "act") return this.actPanel(view, close);
    if (kind === "award") return this.awardPanel(view, close);
    return this.dismissPanel(view, close);
  }

  /** Warn, or warn and pause chat: the picker starts on the suggestion. */
  private actPanel(view: ChatCaseView, close: () => void): HTMLElement {
    const name = nameOf(view.reported.userid, view.reported.username);
    let picked = suggestedStep(view.suggest);
    const reason = h("textarea", {
      class: "field-input",
      attrs: { rows: "2", maxlength: String(MAX_MODERATION_REASON), "aria-label": "Reason, the player sees this" },
    });
    reason.value = DEFAULT_WARNING;
    const segs = CASE_STEPS.map(([, words], index) =>
      h(
        "button",
        {
          class: "seg",
          attrs: { type: "button", "aria-pressed": String(index === picked), "data-step": String(index) },
          onClick: () => {
            picked = index;
            segs.forEach((seg, i) => seg.setAttribute("aria-pressed", String(i === index)));
            form.changed();
          },
        },
        words,
      ),
    );
    const hours = () => CASE_STEPS[picked]![0];
    const form = panel({
      fields: [
        h(
          "div",
          { class: "field" },
          h("span", { class: "field-label" }, "Pause chat for"),
          h("div", { class: "segmented case-steps", attrs: { role: "group", "aria-label": "Pause chat for" } }, ...segs),
        ),
        h(
          "div",
          { class: "field" },
          h("span", { class: "field-label" }, "Reason", h("span", { class: "hint" }, " the player sees this")),
          reason,
        ),
      ],
      next: "Next",
      check: () => (reason.value.trim() ? null : "Write a reason: the player sees it."),
      question: () => {
        const length = hours();
        return length === null ? `Warn ${name}?` : `Warn ${name} and pause their chat for ${lengthWords(length)}?`;
      },
      sees: () =>
        hours() === null
          ? "They see the reason in a pop-up in the game and in their mail."
          : "They can still read chat, not write. They see the reason in a pop-up and in their mail.",
      yes: "Yes, do it",
      busy: "Working…",
      send: async () => {
        const length = hours();
        const text = reason.value.trim();
        const answer = await actOnCase(
          view.id,
          length === null ? { action: "warn", reason: text } : { action: "mute", reason: text, hours: length },
        );
        this.closedHere(answer.case, length === null ? `${name} warned` : `${name} warned, chat paused`);
      },
      cancel: close,
    });
    reason.addEventListener("input", () => form.changed());
    return form.element;
  }

  /** Give each ticked reporter Shiny; those already given are shown, not given again. */
  private awardPanel(view: ChatCaseView, close: () => void): HTMLElement {
    const rows = view.reporters.map((reporter) => {
      const done = reporter.award !== null;
      const tick = h("input", {
        attrs: { type: "checkbox", "aria-label": `Give Shiny to ${nameOf(reporter.userid, reporter.username)}` },
      });
      tick.checked = true;
      tick.disabled = done;
      const amount = h("input", {
        class: "field-input case-amount",
        attrs: {
          type: "number",
          inputmode: "numeric",
          min: "1",
          max: String(MAX_SHINY_AWARD),
          "aria-label": `Shiny for ${nameOf(reporter.userid, reporter.username)}`,
        },
      });
      amount.value = String(done ? reporter.award!.amount : defaultAward(reporter, this.award));
      amount.disabled = done;
      return { reporter, done, tick, amount };
    });
    const total = h("p", { class: "case-total" });
    const picked = () => rows.filter((row) => !row.done && row.tick.checked);
    const sum = () => picked().reduce((all, row) => all + (Number(row.amount.value) || 0), 0);
    const update = () => {
      const n = picked().length;
      replace(total, icon("gift", 16), n ? `${count(sum())} Shiny to ${plural(n, "player")}` : "Nobody ticked");
      form.changed();
    };
    const form = panel({
      fields: [
        h(
          "ul",
          { class: "case-award-list" },
          ...rows.map((row) =>
            h(
              "li",
              { class: `case-award${row.done ? " is-done" : ""}` },
              h(
                "label",
                { class: "case-award-who" },
                row.tick,
                h("span", {}, nameOf(row.reporter.userid, row.reporter.username)),
                row.reporter.first ? h("span", { class: "chip chip-info" }, "1st") : null,
                row.reporter.late ? h("span", { class: "chip chip-quiet" }, "late") : null,
                row.done ? h("span", { class: "chip chip-good" }, "given") : null,
              ),
              row.amount,
            ),
          ),
        ),
        total,
        h("p", { class: "note" }, "Untick anyone who did not report in good faith. Nobody is given twice for a case."),
      ],
      next: "Next",
      check: () => {
        if (!picked().length) return "Tick at least one reporter.";
        for (const row of picked()) {
          const value = Number(row.amount.value);
          if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SHINY_AWARD)
            return `Give a whole number of Shiny from 1 to ${count(MAX_SHINY_AWARD)}.`;
        }
        return null;
      },
      question: () => `Give ${count(sum())} Shiny to ${plural(picked().length, "reporter")}?`,
      sees: () => `Each gets the Shiny in the game and a mail: “${AWARD_MAIL}”`,
      yes: "Yes, give",
      busy: "Giving…",
      send: async () => {
        const answer = await awardCaseReporters(
          view.id,
          picked().map((row) => ({ userid: row.reporter.userid, amount: Number(row.amount.value) })),
        );
        this.panels.delete(view.id);
        this.kept.delete(view.id);
        const given = answer.given.reduce((all, g) => all + g.amount, 0);
        this.options.say(
          [
            answer.given.length ? `Gave ${count(given)} Shiny to ${plural(answer.given.length, "reporter")}` : null,
            answer.already.length ? `${answer.already.length} already given` : null,
            answer.failed.length ? `${answer.failed.length} could not be given (no yard)` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Nothing given",
        );
        this.redraw(answer.case);
      },
      cancel: close,
    });
    for (const row of rows) {
      row.tick.addEventListener("change", update);
      row.amount.addEventListener("input", update);
    }
    update();
    return form.element;
  }

  /** Close the case with nothing done; the note is only for the log. */
  private dismissPanel(view: ChatCaseView, close: () => void): HTMLElement {
    const note = h("textarea", {
      class: "field-input",
      attrs: { rows: "2", maxlength: String(MAX_MODERATION_REASON), placeholder: "Optional", "aria-label": "Note, only you see this" },
    });
    const form = panel({
      fields: [
        h(
          "div",
          { class: "field" },
          h("span", { class: "field-label" }, "Note", h("span", { class: "hint" }, " only you see this")),
          note,
        ),
      ],
      next: "Dismiss…",
      check: () => null,
      question: () => `Close this case with nothing done to ${nameOf(view.reported.userid, view.reported.username)}?`,
      sees: () => "The player is not told. You can still give the reporters Shiny afterwards.",
      yes: "Yes, dismiss",
      busy: "Closing…",
      send: async () => {
        const text = note.value.trim();
        const answer = await actOnCase(view.id, { action: "dismiss", ...(text ? { note: text } : {}) });
        this.closedHere(answer.case, "Case dismissed");
      },
      cancel: close,
    });
    note.addEventListener("input", () => form.changed());
    return form.element;
  }

  /**
   * A case closed here stays on show, with the award step open when its
   * reporters have not had Shiny yet; it leaves the open list on the next
   * refresh after that.
   */
  private closedHere(view: ChatCaseView, said: string): void {
    const awardNext = view.closed?.outcome !== "dismiss" && view.reporters.some((r) => r.award === null);
    if (awardNext) {
      this.panels.set(view.id, "award");
      this.kept.set(view.id, view);
      this.expanded.add(view.id);
    } else {
      this.panels.delete(view.id);
    }
    this.openCases = this.openCases.filter((c) => c.id !== view.id);
    this.options.say(awardNext ? `${said}. Now the reporters?` : said);
    this.redraw(view);
    this.options.onChanged();
    void this.loadOpen();
  }
}
