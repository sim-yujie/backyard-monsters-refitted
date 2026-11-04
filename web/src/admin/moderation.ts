import {
  MAX_MODERATION_REASON,
  dismissChatFlags,
  fetchChatFlags,
  fetchChatLog,
  fetchChatReports,
  fetchPlayerModeration,
  moderatePlayer,
  searchPlayers,
  type ChatLogEntry,
  type ChatLogQuery,
  type ChatReportView,
  type FlaggedPlayer,
  type FlagLine,
  type FlagSeverity,
  type FlagSort,
  type ModerationBody,
  type ModerationEntry,
  type ModerationKind,
  type PlayerMatch,
  type PlayerModeration,
} from "./api";
import { h, replace, type Child } from "./dom";
import { ago, dateTime, plural } from "./format";
import { icon } from "./icons";
import { errorWords } from "./shiny";

/**
 * The Moderation section: find a player (or pick a flagged player or a chat
 * report), see their state, history and chat, and warn them, pause their
 * chat, ban them, or lift a ban or pause. Lines the word filter caught are
 * listed one row per player with the player's own words; nothing is done to
 * the player until the owner decides. The chat log can be searched by player
 * or words. Every step is checked on the server, which refuses game team
 * accounts; the page only offers what makes sense. Reports are worked
 * through as Chat cases (cases.ts); the word filter's list, the raw chat
 * reports and the chat log search are folded here, each a tap away.
 *
 * What the player sees: a warning or pause is a pop-up in the game and a
 * mail; a ban signs them out at once, and the sign-in screen shows the
 * reason and when it ends.
 */

/** What the Warn form starts with. */
export const DEFAULT_WARNING = "Please keep chat friendly. Next time it's a ban.";

/** A ban's lengths in days; null is for good. */
export const BAN_LENGTHS: readonly (readonly [number | null, string])[] = [
  [1, "1 day"],
  [3, "3 days"],
  [7, "7 days"],
  [30, "30 days"],
  [null, "For good"],
];

/** A chat pause's lengths in hours. */
export const MUTE_LENGTHS: readonly (readonly [number, string])[] = [
  [1, "1 hour"],
  [24, "1 day"],
  [72, "3 days"],
];

const ACTION_WORDS: Record<ModerationKind, string> = {
  warn: "Warning",
  mute: "Chat paused",
  unmute: "Pause lifted",
  ban: "Banned",
  unban: "Ban lifted",
};

const ACTION_CHIPS: Record<ModerationKind, string> = {
  warn: "chip-warn",
  mute: "chip-warn",
  unmute: "chip-quiet",
  ban: "chip-bad",
  unban: "chip-quiet",
};

/** The log's word for a step. */
export const actionWord = (kind: ModerationKind): string => ACTION_WORDS[kind] ?? kind;

let regionNames: Intl.DisplayNames | null | undefined;
const countryName = (code: string): string => {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};

/** A chat room's key in words: "Map Room 2", "Inferno", "Philippines". */
export const roomLabel = (channel: string): string => {
  const mapRoom = /^chat:mr(\d)-global$/.exec(channel);
  if (mapRoom) return `Map Room ${mapRoom[1]}`;
  if (channel === "chat:inferno-global") return "Inferno";
  if (channel.startsWith("chat:country:")) return countryName(channel.slice("chat:country:".length));
  if (channel.startsWith("chat:alliance:")) return "Alliance";
  return channel;
};

/** "Banned for good", "Banned until 5 Nov 14:00", or null when not banned. */
export const banStatus = (player: Pick<PlayerModeration, "banned" | "banUntil">): string | null => {
  if (!player.banned) return null;
  return player.banUntil ? `Banned until ${dateTime(player.banUntil)}` : "Banned for good";
};

/** The end of a step, as the log shows it, or null when it has none. */
export const untilWords = (entry: Pick<ModerationEntry, "action" | "until">): string | null => {
  if (entry.action === "ban") return entry.until ? `until ${dateTime(entry.until)}` : "for good";
  if (entry.action === "mute" && entry.until) return `until ${dateTime(entry.until)}`;
  return null;
};

/** What the player sees, under each form. */
const PLAYER_SEES: Record<ModerationKind, string> = {
  warn: "They see it in a pop-up in the game, and in their mail.",
  mute: "They can still read chat, but not write in it. They see why in a pop-up and in their mail.",
  ban: "They are signed out at once. When they try to sign in, they see the reason and when the ban ends.",
  unban: "They can sign in again straight away.",
  unmute: "They can write in chat again straight away.",
};

const SUBMIT_WORDS: Record<ModerationKind, string> = {
  warn: "Send warning",
  mute: "Pause chat",
  ban: "Ban…",
  unban: "Lift ban",
  unmute: "Lift pause",
};

export interface ActionFormOptions {
  player: Pick<PlayerModeration, "userid" | "username">;
  kind: ModerationKind;
  /** The chat report it is done from: the step is linked to it. */
  chatReportId?: number | null;
  onDone(player: PlayerModeration): void;
  onCancel(): void;
}

let formCount = 0;

/** A row of length buttons, one pressed at a time. */
const lengthPicker = <T>(
  label: string,
  lengths: readonly (readonly [T, string])[],
  start: number | null,
  onPick: () => void,
): { element: HTMLElement; value(): T | undefined } => {
  let picked = start;
  const buttons = lengths.map(([, words], index) =>
    h(
      "button",
      {
        class: "seg",
        attrs: { type: "button", "aria-pressed": String(index === start) },
        onClick: () => {
          picked = index;
          buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
          onPick();
        },
      },
      words,
    ),
  );
  return {
    element: h(
      "div",
      { class: "field" },
      h("span", { class: "field-label" }, label),
      h("div", { class: "segmented mod-lengths", attrs: { role: "group", "aria-label": label } }, ...buttons),
    ),
    value: () => (picked === null ? undefined : lengths[picked]![0]),
  };
};

/** The form for one step: reason, length, and (for a ban) "are you sure?". */
export const actionForm = (options: ActionFormOptions): HTMLFormElement => {
  const n = ++formCount;
  const { player, kind } = options;
  const needsReason = kind === "warn" || kind === "mute" || kind === "ban";
  const reason = h("textarea", {
    class: "field-input mod-reason",
    attrs: {
      id: `mod-reason-${n}`,
      rows: "3",
      maxlength: String(MAX_MODERATION_REASON),
      placeholder: needsReason ? "Say why, in a sentence" : "Optional",
      "aria-describedby": `mod-reason-count-${n}`,
    },
  });
  if (kind === "warn") reason.value = DEFAULT_WARNING;
  const counter = h("span", { class: "counter", attrs: { id: `mod-reason-count-${n}` } });
  const problem = h("p", { class: "form-error", attrs: { role: "alert", hidden: "" } });
  const say = (text: string | null) => {
    problem.hidden = text === null;
    problem.textContent = text ?? "";
  };
  const changed = () => {
    say(null);
    setConfirming(false);
    counter.textContent = `${reason.value.length} / ${MAX_MODERATION_REASON}`;
  };
  reason.addEventListener("input", changed);

  const ban = kind === "ban" ? lengthPicker("How long", BAN_LENGTHS, null, changed) : null;
  const mute = kind === "mute" ? lengthPicker("How long", MUTE_LENGTHS, 1, changed) : null;

  const submit = h(
    "button",
    { class: kind === "ban" ? "button danger" : "button primary", attrs: { type: "submit" } },
    SUBMIT_WORDS[kind],
  );
  const cancel = h(
    "button",
    { class: "button quiet", attrs: { type: "button" }, onClick: () => options.onCancel() },
    "Cancel",
  );
  const submitRow = h("div", { class: "actions" }, cancel, submit);
  const question = h("p", { class: "confirm-question" });
  const yes = h("button", { class: "button danger", attrs: { type: "button" } }, "Yes, ban");
  const back = h("button", { class: "button quiet", attrs: { type: "button" } }, "Go back");
  const confirm = h(
    "div",
    { class: "confirm", attrs: { hidden: "" } },
    question,
    h("p", { class: "note" }, PLAYER_SEES.ban),
    h("div", { class: "actions" }, back, yes),
  );
  const sees = h("p", { class: "note mod-sees" }, PLAYER_SEES[kind]);
  const setConfirming = (on: boolean) => {
    confirm.hidden = !on;
    submitRow.hidden = on;
    // The question says it again.
    sees.hidden = on;
  };
  changed();

  let busy = false;
  const setBusy = (on: boolean) => {
    busy = on;
    for (const el of [reason, submit, cancel, yes, back]) el.disabled = on;
    if (on) yes.textContent = "Banning…";
    else yes.textContent = "Yes, ban";
  };

  const body = (): ModerationBody => ({
    reason: reason.value.trim(),
    ...(ban && { days: ban.value() ?? null }),
    ...(mute && { hours: mute.value() ?? 1 }),
    ...(options.chatReportId ? { chatReportId: options.chatReportId } : {}),
  });

  const send = async () => {
    setBusy(true);
    try {
      const answer = await moderatePlayer(player.userid, kind, body());
      setBusy(false);
      options.onDone(answer.player);
    } catch (err) {
      setBusy(false);
      setConfirming(false);
      say(`Not done: ${errorWords(err)}`);
    }
  };
  back.addEventListener("click", () => {
    setConfirming(false);
    reason.focus();
  });
  yes.addEventListener("click", () => void send());

  const form = h(
    "form",
    {
      class: `mod-form mod-form-${kind}`,
      attrs: { novalidate: "", "aria-label": `${SUBMIT_WORDS[kind].replace("…", "")}: ${player.username}` },
    },
    ban?.element,
    mute?.element,
    h(
      "div",
      { class: "field" },
      h(
        "span",
        { class: "field-label" },
        h("label", { attrs: { for: reason.id } }, needsReason ? "Reason" : "Note for the log"),
        h("span", { class: "hint" }, needsReason ? " the player sees this" : " only you see this"),
      ),
      reason,
      counter,
    ),
    sees,
    problem,
    submitRow,
    confirm,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    if (needsReason && !reason.value.trim()) {
      say("Write a reason: the player sees it.");
      reason.focus();
      return;
    }
    if (ban) {
      const days = ban.value();
      if (days === undefined) {
        say("Pick how long the ban lasts.");
        return;
      }
      question.textContent =
        days === null ? `Ban ${player.username} for good?` : `Ban ${player.username} for ${plural(days, "day")}?`;
      setConfirming(true);
      yes.focus();
      return;
    }
    void send();
  });
  return form;
};

/** One step in a player's history. */
export const entryRow = (entry: ModerationEntry): HTMLElement => {
  const seen =
    entry.action === "warn" || entry.action === "mute"
      ? entry.seenAt
        ? `seen ${ago(entry.seenAt)}`
        : "not seen yet"
      : null;
  return h(
    "li",
    { class: "mod-entry" },
    h("span", { class: `chip ${ACTION_CHIPS[entry.action] ?? "chip-quiet"}` }, actionWord(entry.action)),
    h(
      "span",
      { class: "row-main" },
      entry.reason ? h("span", { class: "mod-entry-reason" }, entry.reason) : null,
      h(
        "span",
        { class: "row-meta" },
        [
          untilWords(entry),
          `by ${entry.byName ?? `#${entry.by}`}`,
          entry.chatReportId !== null ? `from chat report #${entry.chatReportId}` : null,
          seen,
        ]
          .filter(Boolean)
          .join(" · "),
        " · ",
        h("time", { attrs: { datetime: entry.at, title: dateTime(entry.at) } }, ago(entry.at)),
      ),
    ),
  );
};

/** One chat report: who said what, where, and what was done. */
export const reportRow = (report: ChatReportView, open: (report: ChatReportView) => void): HTMLElement => {
  const reported = report.reported.username ?? `#${report.reported.userid}`;
  const reporter = report.reporter.username ?? `#${report.reporter.userid}`;
  return h(
    "li",
    {},
    h(
      "button",
      {
        class: "row report-row",
        attrs: { type: "button", "data-report": String(report.id) },
        onClick: () => open(report),
      },
      h(
        "span",
        { class: "row-main" },
        h(
          "span",
          { class: "row-top" },
          h("strong", { class: "report-who" }, reported),
          report.reported.banned ? h("span", { class: "chip chip-bad" }, "Banned") : null,
          report.reported.muted ? h("span", { class: "chip chip-warn" }, "Chat paused") : null,
          h(
            "time",
            { class: "row-when", attrs: { datetime: report.at, title: dateTime(report.at) } },
            ago(report.at),
          ),
        ),
        h("span", { class: "chat-quote" }, `“${report.message}”`),
        h(
          "span",
          { class: "row-meta" },
          h(
            "span",
            {
              class: `chip ${report.verified ? "chip-good" : "chip-warn"}`,
              attrs: {
                title: report.verified
                  ? "The words match the chat server's own copy of the line."
                  : "The chat server had no copy of the line to check the words against.",
              },
            },
            report.verified ? "Matched" : "Not matched",
          ),
          " ",
          [
            `reported by ${reporter}`,
            roomLabel(report.channel),
            `said ${dateTime(new Date(report.messageTs).toISOString())}`,
            report.reportsAgainst > 1 ? `${plural(report.reportsAgainst, "report")} against them` : null,
            report.actions.length ? `done: ${report.actions.map(actionWord).join(", ")}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
      icon("chevron", 18),
    ),
  );
};

/** The flagged words in a line, marked; the rest as plain text. */
export const markWords = (message: string, words: readonly string[]): Child[] => {
  const usable = words.filter((word) => word.length > 0);
  if (usable.length === 0) return [message];
  const escaped = usable.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
  const parts: Child[] = [];
  let last = 0;
  for (const match of message.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(message.slice(last, at));
    parts.push(h("mark", { class: "flag-word" }, match[0]));
    last = at + match[0].length;
  }
  if (last < message.length) parts.push(message.slice(last));
  return parts;
};

/** "Slur" or "Swearing", with an icon, so the colour is never the only sign. */
export const severityChip = (severity: FlagSeverity): HTMLElement =>
  severity === "slur"
    ? h("span", { class: "chip chip-bad chip-icon" }, icon("bad", 14), "Slur")
    : h("span", { class: "chip chip-warn chip-icon" }, icon("warn", 14), "Swearing");

/** "Disguised" with what the filter read it as, for a word spelled to get past the filter. */
export const disguisedChip = (words: readonly string[]): HTMLElement =>
  h(
    "span",
    { class: "chip chip-info chip-icon", attrs: { title: `Disguised spelling, read as: ${words.join(", ")}` } },
    icon("mask", 14),
    `Disguised: ${words.join(", ")}`,
  );

/** One flagged line: the player's words with the hits marked, where and when. */
export const flagLineItem = (line: FlagLine, extra?: Child): HTMLElement =>
  h(
    "li",
    { class: "flag-line" },
    h("span", { class: "chat-quote" }, "“", ...markWords(line.message, line.words), "”"),
    line.rule === "disguised" ? disguisedChip(line.words) : null,
    h(
      "span",
      { class: "row-meta" },
      `${roomLabel(line.channel)} · `,
      h("time", { attrs: { datetime: line.at, title: dateTime(line.at) } }, ago(line.at)),
      ` · players saw “${line.shown}”`,
      extra ? " · " : null,
      extra ?? null,
    ),
  );

/** One flagged player: open it to act; dismiss sets the flags aside. */
export const flagRow = (
  player: FlaggedPlayer,
  open: (player: FlaggedPlayer) => void,
  dismiss: (player: FlaggedPlayer) => void,
): HTMLElement => {
  const name = player.username ?? `#${player.userid}`;
  return h(
    "li",
    { class: "flag-item" },
    h(
      "button",
      {
        class: "row report-row flag-row",
        attrs: { type: "button", "data-flagged": String(player.userid) },
        onClick: () => open(player),
      },
      h(
        "span",
        { class: "row-main" },
        h(
          "span",
          { class: "row-top" },
          h("strong", { class: "report-who" }, name),
          severityChip(player.slurs > 0 ? "slur" : "swear"),
          h("span", { class: "chip chip-quiet" }, plural(player.count, "line")),
          player.banned ? h("span", { class: "chip chip-bad" }, "Banned") : null,
          player.muted ? h("span", { class: "chip chip-warn" }, "Chat paused") : null,
          h(
            "time",
            { class: "row-when", attrs: { datetime: player.latestAt, title: dateTime(player.latestAt) } },
            ago(player.latestAt),
          ),
        ),
        h("ul", { class: "flag-lines" }, ...player.lines.map((line) => flagLineItem(line))),
      ),
      icon("chevron", 18),
    ),
    h(
      "button",
      {
        class: "button quiet flag-dismiss",
        attrs: {
          type: "button",
          "data-dismiss": String(player.userid),
          title: "Nothing to do: take this player off the list",
        },
        onClick: () => dismiss(player),
      },
      icon("ok", 16),
      "Dismiss",
    ),
  );
};

/** One chat log line. */
export const chatLogItem = (entry: ChatLogEntry, showName: boolean): HTMLElement =>
  h(
    "li",
    { class: `chatlog-line${entry.flagged ? " is-flagged" : ""}` },
    h(
      "span",
      { class: "row-meta" },
      h("time", { attrs: { datetime: entry.at, title: dateTime(entry.at) } }, dateTime(entry.at)),
      ` · ${roomLabel(entry.channel)}`,
      showName ? " · " : null,
      showName ? h("strong", { class: "chatlog-who" }, entry.username ?? `#${entry.userid}`) : null,
    ),
    h(
      "span",
      { class: "chatlog-text" },
      entry.flagged ? severityChip(entry.flagged) : null,
      entry.flagged ? " " : null,
      entry.message,
    ),
  );

/**
 * A page of the chat log, newest first, with "Show older". `load` replaces
 * what it shows with a new query.
 */
export class ChatLogPanel {
  readonly element = h("div", { class: "chatlog" });
  private query: ChatLogQuery = {};
  private lines: ChatLogEntry[] = [];
  private nextBefore: number | null = null;
  private seq = 0;
  private showName = true;
  private empty = "Nothing in the chat log.";

  async load(query: ChatLogQuery, options: { showName?: boolean; empty?: string } = {}): Promise<void> {
    this.query = query;
    this.showName = options.showName ?? true;
    this.empty = options.empty ?? "Nothing in the chat log.";
    replace(this.element, h("div", { class: "skeleton" }));
    await this.fetch(false);
  }

  private async fetch(more: boolean): Promise<void> {
    const seq = ++this.seq;
    let answer: { lines: ChatLogEntry[]; nextBefore: number | null };
    try {
      answer = await fetchChatLog({ ...this.query, before: more ? (this.nextBefore ?? undefined) : undefined });
    } catch (err) {
      if (seq === this.seq)
        replace(this.element, h("p", { class: "note" }, `The chat log could not be loaded: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.seq) return;
    this.lines = more ? [...this.lines, ...answer.lines] : answer.lines;
    this.nextBefore = answer.nextBefore;
    replace(
      this.element,
      this.lines.length
        ? h("ul", { class: "rows chatlog-lines" }, ...this.lines.map((line) => chatLogItem(line, this.showName)))
        : h("p", { class: "note" }, this.empty),
      this.nextBefore !== null
        ? h(
            "button",
            { class: "button wide quiet", attrs: { type: "button" }, onClick: () => void this.fetch(true) },
            "Show older",
          )
        : null,
    );
  }
}

/** A list folded away under its title, with a count beside it. */
const fold = (title: string, id: string, countBadge: HTMLElement | null, body: HTMLElement): HTMLDetailsElement =>
  h(
    "details",
    { class: "fold", attrs: { id } },
    h("summary", {}, icon("chevron", 16), h("span", {}, title), countBadge),
    body,
  );

export interface ModerationOptions {
  say(message: string): void;
}

/** The Moderation section. */
export class ModerationView {
  readonly element = h("div", { class: "moderation" });
  private readonly search = h("input", {
    class: "field-input",
    attrs: {
      id: "mod-search",
      type: "search",
      autocomplete: "off",
      spellcheck: "false",
      enterkeyhint: "search",
      placeholder: "Name or account number",
    },
  });
  private readonly results = h("div", { class: "results", attrs: { "aria-live": "polite" } });
  private readonly picked = h("div", { class: "picked" });
  private readonly reports = h("div", { class: "group" }, h("div", { class: "skeleton" }));
  private readonly flags = h("div", { class: "group" }, h("div", { class: "skeleton" }));
  private readonly flagCount = h("span", { class: "fold-count" });
  private readonly reportCount = h("span", { class: "fold-count" });
  private reportList: ChatReportView[] = [];
  private nextBefore: number | null = null;
  private flagList: FlaggedPlayer[] = [];
  private flagNextOffset: number | null = null;
  private flagView: FlagSort | "slurs" = "latest";
  private searchTimer = 0;
  private searchSeq = 0;
  private openSeq = 0;
  /** The player on show, the report or flag row they were opened from, and the open form. */
  private current: {
    player: PlayerModeration;
    chatReportId: number | null;
    flag: FlaggedPlayer | null;
    form: ModerationKind | null;
  } | null = null;
  /** The player's own chat, or the room around one of their flagged lines. */
  private readonly cardLog = new ChatLogPanel();
  private readonly cardLogTitle = h("h4", { class: "mod-log-title" }, "Their chat");
  private readonly logSearch = h("input", {
    class: "field-input",
    attrs: {
      id: "chatlog-search",
      type: "search",
      autocomplete: "off",
      spellcheck: "false",
      enterkeyhint: "search",
      placeholder: "Words, or a player's name",
    },
  });
  private logSearchBy: "words" | "player" = "words";
  private readonly searchLog = new ChatLogPanel();

  constructor(private readonly options: ModerationOptions) {
    this.search.addEventListener("input", () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => void this.find(), 250);
    });
    this.search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      window.clearTimeout(this.searchTimer);
      void this.find();
    });
    this.logSearch.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.searchChat();
    });
    replace(
      this.element,
      h(
        "p",
        { class: "lede" },
        "Warn a player, pause their chat, or ban them. Pick a flagged player or a chat report below " +
          "to act on it, or find the player by name.",
      ),
      h(
        "div",
        { class: "group finder" },
        h("label", { class: "field-label", attrs: { for: "mod-search" } }, "Find a player"),
        this.search,
        this.results,
      ),
      this.picked,
      fold("Caught by the word filter", "mod-fold-flags", this.flagCount, this.flags),
      fold("Chat reports, one by one", "mod-fold-reports", this.reportCount, this.reports),
      fold("Chat log", "mod-fold-log", null, this.renderLogSearch()),
    );
  }

  private renderLogSearch(): HTMLElement {
    const by = (value: "words" | "player", label: string) =>
      h(
        "button",
        {
          class: "seg",
          attrs: { type: "button", "aria-pressed": String(this.logSearchBy === value), "data-search-by": value },
          onClick: (event) => {
            this.logSearchBy = value;
            const group = (event.currentTarget as HTMLElement).parentElement;
            group?.querySelectorAll(".seg").forEach((seg) => {
              seg.setAttribute("aria-pressed", String(seg.getAttribute("data-search-by") === value));
            });
            this.logSearch.focus();
          },
        },
        label,
      );
    return h(
      "div",
      { class: "group chatlog-search" },
      h("p", { class: "hint" }, "Every World and country room line of the last 90 days, as the player typed it."),
      h(
        "div",
        { class: "chatlog-find" },
        h("label", { class: "field-label", attrs: { for: "chatlog-search" } }, "Search the chat log"),
        h(
          "div",
          { class: "segmented", attrs: { role: "group", "aria-label": "Search by" } },
          by("words", "Words"),
          by("player", "Player name"),
        ),
        h(
          "div",
          { class: "chatlog-find-row" },
          this.logSearch,
          h("button", { class: "button", attrs: { type: "button" }, onClick: () => void this.searchChat() }, "Search"),
        ),
      ),
      this.searchLog.element,
    );
  }

  private async searchChat(): Promise<void> {
    const text = this.logSearch.value.trim();
    if (!text) {
      replace(this.searchLog.element);
      return;
    }
    await this.searchLog.load(this.logSearchBy === "words" ? { q: text } : { player: text }, {
      empty:
        this.logSearchBy === "words"
          ? `No line with “${text}”.`
          : `No lines from a player called “${text}”. Use the whole name.`,
    });
  }

  /** Loads the reports again, and the player on show unless a form is open. */
  async refresh(): Promise<void> {
    const reload =
      this.current && this.current.form === null
        ? this.open(this.current.player.userid, this.current.chatReportId ?? undefined, false, this.current.flag ?? undefined)
        : Promise.resolve();
    await Promise.all([this.loadFlags(), this.loadReports(), reload]);
  }

  /**
   * Shows a player's state, history, chat and actions; `chatReportId` links
   * what is done to that report, and `flag` shows their flagged lines.
   */
  async open(userid: number, chatReportId?: number, scroll = true, flag?: FlaggedPlayer): Promise<void> {
    const seq = ++this.openSeq;
    if (scroll) replace(this.picked, h("div", { class: "picked-card" }, h("div", { class: "skeleton" })));
    let player: PlayerModeration;
    try {
      player = (await fetchPlayerModeration(userid)).player;
    } catch (err) {
      if (seq === this.openSeq)
        replace(this.picked, h("p", { class: "form-error" }, `Could not load player #${userid}: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.openSeq) return;
    this.current = { player, chatReportId: chatReportId ?? null, flag: flag ?? null, form: null };
    this.renderCard();
    if (scroll) {
      this.showOwnChat(player);
      this.picked.scrollIntoView?.({ block: "start" });
    }
  }

  private showOwnChat(player: PlayerModeration): void {
    this.cardLogTitle.textContent = "Their chat";
    void this.cardLog.load(
      { userid: player.userid },
      { showName: false, empty: "No World or country chat from this player in the log." },
    );
  }

  private showRoom(line: FlagLine): void {
    this.cardLogTitle.textContent = `${roomLabel(line.channel)} chat up to this line`;
    void this.cardLog.load({ channel: line.channel, until: Date.parse(line.at) + 1000 }, { showName: true });
  }

  private async dismiss(flag: FlaggedPlayer): Promise<void> {
    const name = flag.username ?? `#${flag.userid}`;
    try {
      await dismissChatFlags(flag.userid, flag.lastId);
    } catch (err) {
      this.options.say(`Could not dismiss ${name}: ${errorWords(err)}`);
      return;
    }
    this.options.say(`Dismissed: ${name}`);
    if (this.current?.flag?.userid === flag.userid) this.current.flag = null;
    this.renderCard();
    await this.loadFlags();
  }

  private async find(): Promise<void> {
    const query = this.search.value.trim();
    const seq = ++this.searchSeq;
    if (!query) {
      replace(this.results);
      return;
    }
    let players: PlayerMatch[];
    try {
      players = (await searchPlayers(query)).players;
    } catch (err) {
      if (seq === this.searchSeq)
        replace(this.results, h("p", { class: "note" }, `Could not search: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.searchSeq) return;
    replace(
      this.results,
      players.length
        ? h(
            "ul",
            { class: "rows" },
            ...players.map((player) =>
              h(
                "li",
                {},
                h(
                  "button",
                  {
                    class: "row player-row",
                    attrs: { type: "button" },
                    onClick: () => {
                      replace(this.results);
                      this.search.value = "";
                      void this.open(player.userid);
                    },
                  },
                  h(
                    "span",
                    { class: "row-main" },
                    h("span", { class: "row-title" }, player.username),
                    h(
                      "span",
                      { class: "row-meta" },
                      [
                        `#${player.userid}`,
                        player.bot ? "bot" : null,
                        player.formerName ? `was called ${player.formerName}` : null,
                        player.lastSeenAt ? `last played ${ago(player.lastSeenAt)}` : "never played",
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
        : h("p", { class: "note" }, `No player called “${query}”. Try part of the name, or the account number.`),
    );
  }

  private setForm(kind: ModerationKind | null): void {
    if (!this.current) return;
    this.current.form = kind;
    this.renderCard();
    this.picked.querySelector<HTMLElement>(".mod-form textarea")?.focus();
  }

  private renderCard(): void {
    const current = this.current;
    if (!current) {
      replace(this.picked);
      return;
    }
    const { player, chatReportId, flag, form } = current;
    const fromReport = chatReportId ? this.reportList.find((r) => r.id === chatReportId) : undefined;
    const banned = banStatus(player);
    const chips: Child[] = [
      banned ? h("span", { class: "chip chip-bad" }, banned) : null,
      player.banned && player.banReason ? h("span", { class: "hint" }, `Reason: ${player.banReason}`) : null,
      player.muteUntil
        ? h("span", { class: "chip chip-warn" }, `Chat paused until ${dateTime(player.muteUntil)}`)
        : null,
      player.gameTeam ? h("span", { class: "chip chip-good" }, "Game team") : null,
      !banned && !player.muteUntil && !player.gameTeam
        ? h("span", { class: "chip chip-quiet" }, "No ban or pause")
        : null,
      h(
        "span",
        { class: "chip chip-quiet" },
        player.reportsAgainst ? `${plural(player.reportsAgainst, "chat report")} against them` : "No chat reports",
      ),
    ];

    const kinds: ModerationKind[] = [];
    if (!player.gameTeam) kinds.push("warn", "mute", "ban");
    if (player.muteUntil) kinds.push("unmute");
    if (player.banned) kinds.push("unban");
    const label: Record<ModerationKind, string> = {
      warn: "Warn",
      mute: "Pause chat",
      ban: player.banned ? "Change ban" : "Ban",
      unmute: "Lift pause",
      unban: "Lift ban",
    };
    const buttons = kinds.map((kind) =>
      h(
        "button",
        {
          class: `button ${kind === "ban" ? "mod-ban" : "quiet"}`,
          attrs: { type: "button", "aria-expanded": String(form === kind), "data-kind": kind },
          onClick: () => this.setForm(form === kind ? null : kind),
        },
        label[kind],
      ),
    );

    const formEl =
      form === null
        ? null
        : actionForm({
            player,
            kind: form,
            chatReportId,
            onCancel: () => this.setForm(null),
            onDone: (after) => {
              this.options.say(`${actionWord(form)}: ${after.username}`);
              this.current = { player: after, chatReportId, flag, form: null };
              this.renderCard();
              void this.loadReports();
              // Acting on a flagged player takes their flags off the list.
              if (flag) void this.dismiss(flag);
            },
          });

    replace(
      this.picked,
      h(
        "div",
        { class: "picked-card mod-card" },
        h(
          "div",
          { class: "picked-head" },
          h(
            "div",
            { class: "row-main" },
            h("strong", { class: "mod-name" }, `${player.username} (#${player.userid})`),
            h(
              "span",
              { class: "row-meta" },
              player.lastSeenAt ? `Last played ${ago(player.lastSeenAt)}` : "Never played",
              chatReportId ? ` · from chat report #${chatReportId}` : "",
              flag ? " · caught by the word filter" : "",
            ),
          ),
          h(
            "button",
            {
              class: "button quiet",
              attrs: { type: "button" },
              onClick: () => {
                this.current = null;
                this.renderCard();
                this.search.focus();
              },
            },
            "Close",
          ),
        ),
        fromReport
          ? h(
              "blockquote",
              { class: "mod-quote" },
              h("span", { class: "hint" }, `Reported line, ${roomLabel(fromReport.channel)}:`),
              h("span", { class: "chat-quote" }, `“${fromReport.message}”`),
            )
          : null,
        flag
          ? h(
              "div",
              { class: "mod-quote flag-quote" },
              h(
                "span",
                { class: "hint" },
                `Caught by the word filter: ${plural(flag.count, "line")}` +
                  (flag.count > flag.lines.length ? `, newest ${flag.lines.length} shown` : "") +
                  ". Acting on the player dismisses them.",
              ),
              h(
                "ul",
                { class: "flag-lines" },
                ...flag.lines.map((line) =>
                  flagLineItem(
                    line,
                    h(
                      "button",
                      { class: "link-button", attrs: { type: "button" }, onClick: () => this.showRoom(line) },
                      "See the room",
                    ),
                  ),
                ),
              ),
              h(
                "div",
                { class: "mod-actions" },
                h(
                  "button",
                  {
                    class: "button quiet",
                    attrs: { type: "button", "data-dismiss": String(flag.userid) },
                    onClick: () => void this.dismiss(flag),
                  },
                  icon("ok", 16),
                  "Dismiss: nothing to do",
                ),
              ),
            )
          : null,
        h("div", { class: "mod-status" }, ...chips),
        player.gameTeam
          ? h("p", { class: "note" }, "A game team account cannot be warned, paused or banned.")
          : null,
        buttons.length ? h("div", { class: "mod-actions" }, ...buttons) : null,
        formEl,
        h("h4", { class: "mod-log-title" }, "History"),
        player.log.length
          ? h("ul", { class: "rows mod-log" }, ...player.log.map(entryRow))
          : h("p", { class: "note" }, "Nothing done to this player yet."),
        h(
          "div",
          { class: "log-head" },
          this.cardLogTitle,
          h(
            "button",
            { class: "link-button", attrs: { type: "button" }, onClick: () => this.showOwnChat(player) },
            "Their lines",
          ),
        ),
        this.cardLog.element,
      ),
    );
  }

  private async loadFlags(more = false): Promise<void> {
    let answer: { players: FlaggedPlayer[]; nextOffset: number | null };
    try {
      answer = await fetchChatFlags({
        sort: this.flagView === "latest" ? "latest" : "serious",
        slursOnly: this.flagView === "slurs",
        offset: more ? (this.flagNextOffset ?? undefined) : undefined,
      });
    } catch (err) {
      replace(this.flags, h("p", { class: "note" }, `The flagged players could not be loaded: ${errorWords(err)}`));
      return;
    }
    this.flagList = more ? [...this.flagList, ...answer.players] : answer.players;
    this.flagNextOffset = answer.nextOffset;
    const view = (value: FlagSort | "slurs", label: string) =>
      h(
        "button",
        {
          class: "seg",
          attrs: { type: "button", "aria-pressed": String(this.flagView === value), "data-flag-view": value },
          onClick: () => {
            if (this.flagView === value) return;
            this.flagView = value;
            void this.loadFlags();
          },
        },
        label,
      );
    const open = (flagged: FlaggedPlayer) => void this.open(flagged.userid, undefined, true, flagged);
    const dismiss = (flagged: FlaggedPlayer) => void this.dismiss(flagged);
    this.flagCount.textContent = this.flagList.length
      ? `${this.flagList.length}${this.flagNextOffset !== null ? "+" : ""}`
      : "";
    replace(
      this.flags,
      h("p", { class: "hint" }, "One row per player, with their own words. Players saw these words starred out."),
      h(
        "div",
        { class: "segmented flag-views", attrs: { role: "group", "aria-label": "Which flagged players" } },
        view("latest", "Newest"),
        view("serious", "Slurs first"),
        view("slurs", "Slurs only"),
      ),
      this.flagList.length
        ? h("ul", { class: "rows report-list flag-list" }, ...this.flagList.map((p) => flagRow(p, open, dismiss)))
        : h(
            "div",
            { class: "empty" },
            h("strong", {}, this.flagView === "slurs" ? "No slurs caught" : "Nothing caught"),
            h("p", {}, "When the word filter catches a line in chat, the player shows up here."),
          ),
      this.flagNextOffset !== null
        ? h(
            "button",
            { class: "button wide quiet", attrs: { type: "button" }, onClick: () => void this.loadFlags(true) },
            "Show more",
          )
        : null,
    );
  }

  private async loadReports(more = false): Promise<void> {
    try {
      const answer = await fetchChatReports(more ? (this.nextBefore ?? undefined) : undefined);
      this.reportList = more ? [...this.reportList, ...answer.reports] : answer.reports;
      this.nextBefore = answer.nextBefore;
    } catch (err) {
      replace(this.reports, h("p", { class: "note" }, `The reports could not be loaded: ${errorWords(err)}`));
      return;
    }
    const open = (report: ChatReportView) => void this.open(report.reported.userid, report.id);
    this.reportCount.textContent = this.reportList.length
      ? `${this.reportList.length}${this.nextBefore !== null ? "+" : ""}`
      : "";
    replace(
      this.reports,
      h("p", { class: "hint" }, "Every report on its own, newest first; Chat cases above groups them. Pick one to act on the player."),
      this.reportList.length
        ? h("ul", { class: "rows report-list" }, ...this.reportList.map((report) => reportRow(report, open)))
        : h(
            "div",
            { class: "empty" },
            h("strong", {}, "No chat reports"),
            h("p", {}, "When a player reports a chat line, it shows up here."),
          ),
      this.nextBefore !== null
        ? h(
            "button",
            {
              class: "button wide quiet",
              attrs: { type: "button" },
              onClick: () => void this.loadReports(true),
            },
            "Show older",
          )
        : null,
    );
  }
}
