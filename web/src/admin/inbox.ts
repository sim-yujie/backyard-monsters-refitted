import { ApiError } from "@/api/http";
import {
  MAX_MODERATION_REASON,
  actOnInboxPlayer,
  fetchChatCase,
  fetchChatFlags,
  fetchInbox,
  fetchPlayerModeration,
  type ChatCaseView,
  type ClosedItems,
  type FlaggedPlayer,
  type InboxActionBody,
  type InboxList,
  type InboxPlayer,
  type InboxSource,
  type PlayerModeration,
} from "./api";
import { CASE_STEPS, messageBlock, nameOf, panel, reporterItem, suggestedStep } from "./cases";
import { h, replace } from "./dom";
import { ago, dateTime, plural } from "./format";
import { icon } from "./icons";
import { BAN_LENGTHS, DEFAULT_WARNING, entryRow, flagLineItem, severityChip } from "./moderation";
import { errorWords } from "./shiny";
import type { ViewParams } from "./views";

/**
 * The moderation inbox (owner, 8 Nov 2026; Codex's review): one row per
 * player with everything open against them, from every source (their open
 * chat case and the lines the word filter caught), instead of three lists
 * that each had to be cleared. A player opens beside the list on a computer
 * (full screen on a phone, with Back to the list) with all the evidence, and
 * one step (warn, warn and pause, ban, dismiss) closes everything that was
 * shown. The buttons say the real step: "Warn + pause 24 h".
 *
 * The address keeps what is on show (`#inbox?source=filter&player=12`), so
 * Back closes the player and a Home row can open one.
 */

export const SOURCES: readonly (readonly [InboxSource, string])[] = [
  ["all", "All"],
  ["reports", "Player reports"],
  ["filter", "Word filter"],
];

const isSource = (raw: string | undefined): raw is InboxSource => SOURCES.some(([id]) => id === raw);

const wholeId = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return raw && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** "24 h", "3 d": the picker's own short words. */
export const shortLength = (hours: number): string =>
  CASE_STEPS.find(([h]) => h === hours)?.[1] ?? (hours % 24 === 0 ? `${hours / 24} d` : `${hours} h`);

/** The button's words for a step: "Warn" or "Warn + pause 24 h". */
export const stepLabel = (hours: number | null): string =>
  hours === null ? "Warn" : `Warn + pause ${shortLength(hours)}`;

/** A ban's length on its button: "Ban 7 days", "Ban for good". */
export const banLabel = (days: number | null): string => (days === null ? "Ban for good" : `Ban ${plural(days, "day")}`);

/** The suggested step's hours (null: a warning alone). */
const suggestedHours = (player: InboxPlayer): number | null => CASE_STEPS[suggestedStep(player.suggest)]![0];

/** A row's plain counts: "2 reported messages · 4 reports · 4 unique reporters · 3 word-filter lines · 1 previous action". */
export const inboxLabel = (player: InboxPlayer): string =>
  [
    player.reportedMessages ? plural(player.reportedMessages, "reported message") : null,
    player.reports ? plural(player.reports, "report") : null,
    player.uniqueReporters ? plural(player.uniqueReporters, "unique reporter") : null,
    player.filterLines ? plural(player.filterLines, "word-filter line") : null,
    player.previousActions ? plural(player.previousActions, "previous action") : null,
  ]
    .filter(Boolean)
    .join(" · ");

/** What one step closed: "1 chat case (4 reports), 3 word-filter lines". */
export const closedWords = (closed: ClosedItems): string => {
  const parts = [
    closed.caseId !== null ? `1 chat case (${plural(closed.reports, "report")})` : null,
    closed.filterLines ? plural(closed.filterLines, "word-filter line") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing";
};

/** What the owner did, for the result note. */
const doneWords = (name: string, body: InboxActionBody): string => {
  if (body.action === "warn") return `${name} warned`;
  if (body.action === "mute") return `${name} warned, chat paused ${shortLength(body.hours)}`;
  if (body.action === "ban") return body.days === null ? `${name} banned for good` : `${name} banned for ${plural(body.days, "day")}`;
  return `Dismissed for ${name}`;
};

/** The server's reason for refusing a step (409), or null. */
const refusal = (err: unknown): string | null => {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { reason?: unknown } | null | undefined;
  return typeof body?.reason === "string" ? body.reason : null;
};

/** Everything shown about one opened player. */
interface Opened {
  row: InboxPlayer | null;
  chatCase: ChatCaseView | null;
  flags: FlaggedPlayer | null;
  record: PlayerModeration | null;
  /** The last step's result, shown above the evidence. */
  result: HTMLElement | null;
}

export interface InboxOptions {
  say(message: string): void;
  /** The players in each source, or null when they could not be read. */
  onCount(counts: InboxList["counts"] | null): void;
  /** A step closed items: the other lists changed too. */
  onChanged(): void;
  /** Opens a closed case at its award step, for reporters still waiting for Shiny. */
  openAward(caseId: number): void;
  /** Opens the player in Find a player (their whole record and every tool). */
  openPlayer(userid: number): void;
  /** Moves the address to what should be on show; the dashboard calls {@link InboxView.show} back. */
  navigate(params: { source: InboxSource; player: number | null }): void;
}

type PanelKind = "act" | "ban" | "dismiss";

/** The Moderation inbox view. */
export class InboxView {
  readonly element = h("div", { class: "inbox" });
  private readonly filters: HTMLElement;
  private readonly listBox = h("div", { class: "inbox-list" }, h("div", { class: "skeleton" }));
  private readonly detailBox = h("div", { class: "inbox-detail", attrs: { hidden: "", "aria-live": "polite" } });
  private source: InboxSource = "all";
  private players: InboxPlayer[] = [];
  private next: number | null = null;
  private counts: InboxList["counts"] | null = null;
  private loaded = false;
  private openId: number | null = null;
  private opened: Opened | null = null;
  private panelKind: PanelKind | null = null;
  /** Where the list was scrolled on a phone before a player opened full screen. */
  private listY = 0;
  private seq = 0;
  private openSeq = 0;

  constructor(private readonly options: InboxOptions) {
    this.filters = h(
      "div",
      { class: "segmented inbox-sources", attrs: { role: "group", "aria-label": "Where it came from" } },
      ...SOURCES.map(([id, words]) =>
        h(
          "button",
          {
            class: "seg",
            attrs: { type: "button", "data-source": id, "aria-pressed": String(id === this.source) },
            onClick: () => this.options.navigate({ source: id, player: this.openId }),
          },
          h("span", {}, words),
          h("span", { class: "seg-count" }),
        ),
      ),
    );
    replace(
      this.element,
      h("div", { class: "inbox-side" }, this.filters, this.listBox),
      this.detailBox,
    );
  }

  /** Shows what the address asks for: a source, and a player opened or not. */
  async show(params: ViewParams): Promise<void> {
    const source = isSource(params["source"]) ? params["source"] : "all";
    const player = wholeId(params["player"]);
    const work: Promise<void>[] = [];
    if (source !== this.source || !this.loaded) {
      this.source = source;
      this.markSource();
      work.push(this.loadList());
    }
    if (player !== this.openId) work.push(player === null ? Promise.resolve(this.closePlayer()) : this.openPlayer(player));
    await Promise.all(work);
  }

  /** Reads the list again, and the opened player. */
  async refresh(): Promise<void> {
    await Promise.all([this.loadList(), this.openId !== null ? this.loadPlayer(this.openId, false) : Promise.resolve()]);
  }

  private markSource(): void {
    for (const seg of this.filters.querySelectorAll<HTMLButtonElement>("[data-source]")) {
      seg.setAttribute("aria-pressed", String(seg.dataset["source"] === this.source));
    }
  }

  private renderCounts(): void {
    for (const seg of this.filters.querySelectorAll<HTMLButtonElement>("[data-source]")) {
      const n = this.counts?.[seg.dataset["source"] as InboxSource];
      replace(seg.querySelector(".seg-count")!, n === undefined ? null : ` · ${n}`);
    }
  }

  private async loadList(more = false): Promise<void> {
    const seq = ++this.seq;
    let answer: InboxList;
    try {
      answer = await fetchInbox({ source: this.source, offset: more ? (this.next ?? undefined) : undefined });
    } catch (err) {
      if (seq !== this.seq) return;
      this.options.onCount(null);
      replace(this.listBox, h("p", { class: "note" }, `The inbox could not be loaded: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.seq) return;
    this.loaded = true;
    this.players = more ? [...this.players, ...answer.players] : answer.players;
    this.next = answer.nextOffset;
    this.counts = answer.counts;
    this.options.onCount(answer.counts);
    this.renderCounts();
    this.renderList();
  }

  private renderList(): void {
    replace(
      this.listBox,
      this.players.length
        ? h("ul", { class: "rows inbox-rows" }, ...this.players.map((player) => this.row(player)))
        : h(
            "div",
            { class: "empty" },
            h("strong", {}, "Nothing to look at"),
            h(
              "p",
              {},
              this.source === "filter"
                ? "Lines the word filter catches show up here."
                : this.source === "reports"
                  ? "When a player reports a chat line, the player who said it shows up here."
                  : "Reported players and lines the word filter catches show up here, one row per player.",
            ),
          ),
      this.next !== null
        ? h(
            "button",
            { class: "button wide quiet", attrs: { type: "button" }, onClick: () => void this.loadList(true) },
            "Show more",
          )
        : null,
    );
  }

  /** One player: name, plain counts, how long it has waited, and a line to go on. */
  private row(player: InboxPlayer): HTMLElement {
    const name = nameOf(player.userid, player.username);
    return h(
      "li",
      {},
      h(
        "button",
        {
          class: "row inbox-row",
          attrs: {
            type: "button",
            "data-player": String(player.userid),
            ...(player.userid === this.openId ? { "aria-current": "true" } : {}),
          },
          onClick: () => this.options.navigate({ source: this.source, player: player.userid }),
        },
        h(
          "span",
          { class: "row-main" },
          h(
            "span",
            { class: "row-top" },
            h("strong", { class: "report-who" }, name),
            player.slurs ? severityChip("slur") : null,
            player.banned ? h("span", { class: "chip chip-bad" }, "Banned") : null,
            player.muted ? h("span", { class: "chip chip-warn" }, "Paused") : null,
            h(
              "time",
              { class: "row-when", attrs: { datetime: player.oldestAt, title: `Waiting since ${dateTime(player.oldestAt)}` } },
              ago(player.oldestAt).replace(" ago", ""),
            ),
          ),
          player.preview
            ? h(
                "span",
                { class: "chat-quote inbox-quote" },
                h(
                  "span",
                  { class: "inbox-source", attrs: { title: player.preview.source === "report" ? "Reported by players" : "Caught by the word filter" } },
                  icon(player.preview.source === "report" ? "flag" : "warn", 13),
                ),
                `“${player.preview.text}”`,
              )
            : null,
          h("span", { class: "row-meta inbox-counts", attrs: { title: inboxLabel(player) } }, inboxLabel(player)),
        ),
        icon("chevron", 18),
      ),
    );
  }

  private markRows(): void {
    for (const row of this.listBox.querySelectorAll<HTMLButtonElement>("[data-player]")) {
      if (row.dataset["player"] === String(this.openId)) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
  }

  private async openPlayer(userid: number): Promise<void> {
    const phone = window.matchMedia?.("(max-width: 1023px)").matches ?? false;
    if (this.openId === null && phone) this.listY = window.scrollY;
    this.openId = userid;
    this.opened = null;
    this.panelKind = null;
    this.element.classList.add("has-open");
    this.detailBox.hidden = false;
    replace(this.detailBox, h("div", { class: "skeleton-group" }, h("div", { class: "skeleton" }), h("div", { class: "skeleton" })));
    this.markRows();
    if (phone) window.scrollTo?.(0, 0);
    await this.loadPlayer(userid, true);
  }

  private closePlayer(): void {
    const wasOpen = this.openId !== null;
    this.openId = null;
    this.opened = null;
    this.panelKind = null;
    this.element.classList.remove("has-open");
    this.detailBox.hidden = true;
    replace(this.detailBox);
    this.markRows();
    const phone = window.matchMedia?.("(max-width: 1023px)").matches ?? false;
    if (wasOpen && phone) window.scrollTo?.(0, this.listY);
  }

  /** Reads everything about a player: their row, the case, the filter lines, the record. */
  private async loadPlayer(userid: number, fresh: boolean, result: HTMLElement | null = null): Promise<void> {
    const seq = ++this.openSeq;
    let row: InboxPlayer | null;
    try {
      row = (await fetchInbox({ userid })).players[0] ?? null;
    } catch (err) {
      if (seq !== this.openSeq) return;
      replace(this.detailBox, this.backButton(), h("p", { class: "note" }, `This player could not be loaded: ${errorWords(err)}`));
      return;
    }
    const [chatCase, flags, record] = await Promise.all([
      row?.caseId ? fetchChatCase(row.caseId).then((a) => a.case).catch(() => null) : Promise.resolve(null),
      row?.filterLines ? fetchChatFlags({ userid }).then((a) => a.players[0] ?? null).catch(() => null) : Promise.resolve(null),
      fetchPlayerModeration(userid).then((a) => a.player).catch(() => null),
    ]);
    if (seq !== this.openSeq || this.openId !== userid) return;
    if (fresh) this.panelKind = null;
    this.opened = { row, chatCase, flags, record, result: result ?? this.opened?.result ?? null };
    this.renderPlayer();
  }

  private backButton(): HTMLElement {
    return h(
      "button",
      {
        class: "button quiet inbox-back",
        attrs: { type: "button" },
        onClick: () => this.options.navigate({ source: this.source, player: null }),
      },
      icon("back", 16),
      "Back to list",
    );
  }

  private renderPlayer(): void {
    const opened = this.opened;
    const userid = this.openId;
    if (!opened || userid === null) return;
    const { row, chatCase, flags, record } = opened;
    const name = row ? nameOf(row.userid, row.username) : record ? record.username : `#${userid}`;
    const head = h(
      "header",
      { class: "inbox-head" },
      h("h3", {}, name),
      row?.banned || record?.banned ? h("span", { class: "chip chip-bad" }, "Banned") : null,
      row?.muted || record?.muteUntil ? h("span", { class: "chip chip-warn" }, "Paused") : null,
      h(
        "button",
        { class: "link-button inbox-record", attrs: { type: "button" }, onClick: () => this.options.openPlayer(userid) },
        "Full record",
      ),
    );
    if (!row) {
      replace(
        this.detailBox,
        this.backButton(),
        head,
        opened.result,
        h("p", { class: "note" }, "Nothing is open against this player now."),
        this.recordBlock(record),
      );
      return;
    }
    const evidence: (HTMLElement | null)[] = [];
    if (chatCase) {
      evidence.push(
        h(
          "section",
          { class: "inbox-block" },
          h("h4", {}, icon("flag", 16), plural(chatCase.messages.length, "reported message")),
          ...chatCase.messages.map((message) => messageBlock(message, chatCase.reported.userid)),
          h(
            "div",
            { class: "case-who" },
            h("h4", {}, `Reported by ${plural(row.uniqueReporters, "player")}`),
            h("ul", { class: "case-reporters" }, ...chatCase.reporters.map(reporterItem)),
          ),
        ),
      );
    } else if (row.caseId !== null) {
      evidence.push(h("p", { class: "note" }, "The reported messages could not be loaded."));
    }
    if (row.filterLines) {
      const lines = flags?.lines ?? [];
      evidence.push(
        h(
          "section",
          { class: "inbox-block" },
          h("h4", {}, icon("warn", 16), plural(row.filterLines, "word-filter line")),
          lines.length
            ? h("ul", { class: "flag-lines" }, ...lines.map((line) => flagLineItem(line, severityChip(line.severity))))
            : h("p", { class: "note" }, "The lines could not be loaded."),
          lines.length && lines.length < row.filterLines
            ? h("p", { class: "note" }, `The newest ${lines.length} are shown; acting closes all ${row.filterLines}.`)
            : null,
        ),
      );
    }
    replace(
      this.detailBox,
      this.backButton(),
      head,
      opened.result,
      h("p", { class: "row-meta inbox-counts" }, inboxLabel(row), ` · waiting since ${dateTime(row.oldestAt)}`),
      ...evidence,
      this.recordBlock(record),
      this.actions(row, name),
    );
  }

  /** Earlier warnings, pauses and bans. */
  private recordBlock(record: PlayerModeration | null): HTMLElement {
    const steps = record?.log ?? [];
    return h(
      "section",
      { class: "inbox-block" },
      h("h4", {}, icon("history", 16), steps.length ? plural(steps.length, "previous action") : "No previous actions"),
      steps.length ? h("ul", { class: "rows mod-log" }, ...steps.slice(0, 5).map(entryRow)) : null,
      steps.length > 5 ? h("p", { class: "note" }, `${steps.length - 5} older in the full record.`) : null,
    );
  }

  /** The steps, each with its real length on the button, asked once more before it is sent. */
  private actions(row: InboxPlayer, name: string): HTMLElement {
    if (row.gameTeam) return h("p", { class: "note" }, "A game team account: it cannot be warned, paused or banned.");
    const box = h("div", { class: "case-panel" });
    const hours = suggestedHours(row);
    const button = (kind: PanelKind, words: string, cls: string, iconName: "warn" | "bad" | "x") =>
      h(
        "button",
        {
          class: cls,
          attrs: { type: "button", "data-panel": kind, "aria-expanded": String(this.panelKind === kind) },
          onClick: () => open(this.panelKind === kind ? null : kind),
        },
        icon(iconName, 16),
        words,
      );
    const buttons = h(
      "div",
      { class: "case-actions" },
      button("act", stepLabel(hours), "button primary", "warn"),
      button("ban", "Ban…", "button", "bad"),
      button("dismiss", "Dismiss", "button quiet", "x"),
    );
    const open = (kind: PanelKind | null) => {
      this.panelKind = kind;
      for (const b of buttons.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
        b.setAttribute("aria-expanded", String(b.dataset["panel"] === kind));
      }
      replace(box, kind ? this.panelFor(kind, row, name, () => open(null)) : null);
      box.querySelector<HTMLElement>("textarea, input, button")?.focus();
    };
    if (this.panelKind) replace(box, this.panelFor(this.panelKind, row, name, () => open(null)));
    return h(
      "section",
      { class: "inbox-act" },
      h("p", { class: "case-suggest" }, h("strong", {}, "Suggested: "), stepLabel(hours)),
      buttons,
      box,
    );
  }

  private panelFor(kind: PanelKind, row: InboxPlayer, name: string, close: () => void): HTMLElement {
    if (kind === "act") return this.actPanel(row, name, close);
    if (kind === "ban") return this.banPanel(row, name, close);
    return this.dismissPanel(row, name, close);
  }

  private reasonBox(value: string, label: string): HTMLTextAreaElement {
    const reason = h("textarea", {
      class: "field-input",
      attrs: { rows: "2", maxlength: String(MAX_MODERATION_REASON), "aria-label": label },
    });
    reason.value = value;
    return reason;
  }

  /** A row of length buttons; `onPick` gets the picked index. */
  private picker<T>(label: string, lengths: readonly (readonly [T, string])[], start: number, onPick: (index: number) => void): HTMLElement {
    const segs = lengths.map(([, words], index) =>
      h(
        "button",
        {
          class: "seg",
          attrs: { type: "button", "aria-pressed": String(index === start), "data-step": String(index) },
          onClick: () => {
            segs.forEach((seg, i) => seg.setAttribute("aria-pressed", String(i === index)));
            onPick(index);
          },
        },
        words,
      ),
    );
    return h(
      "div",
      { class: "field" },
      h("span", { class: "field-label" }, label),
      h("div", { class: "segmented case-steps", attrs: { role: "group", "aria-label": label } }, ...segs),
    );
  }

  /** Sends a step with what was shown; a change since is shown before anything is done. */
  private async send(row: InboxPlayer, name: string, body: InboxActionBody): Promise<void> {
    const seen = { caseId: row.caseId, reports: row.reports, flagsUpTo: row.flagsUpTo };
    try {
      const answer = await actOnInboxPlayer(row.userid, body, seen);
      const closed = answer.closed;
      const waiting = closed.caseId !== null ? (this.opened?.chatCase?.reporters.filter((r) => r.award === null).length ?? 0) : 0;
      const caseId = closed.caseId;
      const result = h(
        "div",
        { class: "inbox-result", attrs: { role: "status" } },
        h("p", {}, h("strong", {}, `${doneWords(name, body)}. `), `Closed: ${closedWords(closed)}.`),
        answer.player ? h("p", { class: "note" }, "Newer items came in since; they stay open below.") : null,
        waiting && caseId !== null && body.action !== "dismiss"
          ? h(
              "button",
              { class: "button", attrs: { type: "button" }, onClick: () => this.options.openAward(caseId) },
              icon("gift", 16),
              `Give ${plural(waiting, "reporter")} Shiny`,
            )
          : null,
      );
      this.options.say(doneWords(name, body));
      this.options.onChanged();
      await Promise.all([this.loadList(), this.loadPlayer(row.userid, true, result)]);
    } catch (err) {
      const why = refusal(err);
      if (why === "changed") {
        this.options.say("Something new came in for this player: look again before acting.");
        await this.loadPlayer(row.userid, true, h("p", { class: "form-error", attrs: { role: "alert" } }, "Not done: new reports or lines came in since you opened this. Here is everything now."));
        return;
      }
      if (why === "nothingOpen") {
        this.options.say("Already closed");
        await Promise.all([this.loadList(), this.loadPlayer(row.userid, true)]);
        return;
      }
      throw err;
    }
  }

  /** Warn, or warn and pause chat: the picker starts on the suggestion, and the button says the step. */
  private actPanel(row: InboxPlayer, name: string, close: () => void): HTMLElement {
    let picked = suggestedStep(row.suggest);
    const hours = () => CASE_STEPS[picked]![0];
    const reason = this.reasonBox(DEFAULT_WARNING, "Reason, the player sees this");
    const form = panel({
      fields: [
        this.picker("Pause chat for", CASE_STEPS, picked, (index) => {
          picked = index;
          nextButton().textContent = `${stepLabel(hours())}…`;
          form.changed();
        }),
        h("div", { class: "field" }, h("span", { class: "field-label" }, "Reason", h("span", { class: "hint" }, " the player sees this")), reason),
      ],
      next: `${stepLabel(hours())}…`,
      check: () => (reason.value.trim() ? null : "Write a reason: the player sees it."),
      question: () => {
        const length = hours();
        const all = closedPreview(row);
        return length === null ? `Warn ${name} and close ${all}?` : `Warn ${name}, pause their chat for ${shortLength(length)}, and close ${all}?`;
      },
      sees: () =>
        hours() === null
          ? "They see the reason in a pop-up in the game and in their mail."
          : "They can still read chat, not write. They see the reason in a pop-up and in their mail.",
      yes: "Yes, do it",
      busy: "Working…",
      send: () => {
        const length = hours();
        const text = reason.value.trim();
        return this.send(row, name, length === null ? { action: "warn", reason: text } : { action: "mute", reason: text, hours: length });
      },
      cancel: close,
    });
    const nextButton = () => form.element.querySelector<HTMLButtonElement>("button[type='submit']")!;
    reason.addEventListener("input", () => form.changed());
    return form.element;
  }

  /** Ban: a length must be picked; asked once more, in red. */
  private banPanel(row: InboxPlayer, name: string, close: () => void): HTMLElement {
    let picked: number | null = null;
    const days = () => (picked === null ? undefined : BAN_LENGTHS[picked]![0]);
    const reason = this.reasonBox("", "Reason, the player sees this");
    reason.placeholder = "Say why, in a sentence";
    const form = panel({
      fields: [
        this.picker("How long", BAN_LENGTHS, -1, (index) => {
          picked = index;
          nextButton().textContent = `${banLabel(BAN_LENGTHS[index]![0])}…`;
          form.changed();
        }),
        h("div", { class: "field" }, h("span", { class: "field-label" }, "Reason", h("span", { class: "hint" }, " the player sees this")), reason),
      ],
      next: "Ban…",
      check: () =>
        days() === undefined ? "Pick how long the ban lasts." : reason.value.trim() ? null : "Write a reason: the player sees it.",
      question: () => {
        const length = days();
        return `${length === null ? `Ban ${name} for good` : `Ban ${name} for ${plural(length!, "day")}`} and close ${closedPreview(row)}?`;
      },
      sees: () => "They are signed out at once. When they try to sign in, they see the reason and when the ban ends.",
      yes: "Yes, ban",
      busy: "Banning…",
      danger: true,
      send: () => this.send(row, name, { action: "ban", reason: reason.value.trim(), days: days() ?? null }),
      cancel: close,
    });
    const nextButton = () => form.element.querySelector<HTMLButtonElement>("button[type='submit']")!;
    nextButton().className = "button danger";
    reason.addEventListener("input", () => form.changed());
    return form.element;
  }

  /** Dismiss: nothing happens to the player; everything shown is closed. */
  private dismissPanel(row: InboxPlayer, name: string, close: () => void): HTMLElement {
    const note = h("textarea", {
      class: "field-input",
      attrs: { rows: "2", maxlength: String(MAX_MODERATION_REASON), placeholder: "Optional", "aria-label": "Note for the log" },
    });
    const form = panel({
      fields: [h("div", { class: "field" }, h("span", { class: "field-label" }, "Note", h("span", { class: "hint" }, " only you see this")), note)],
      next: "Dismiss…",
      check: () => null,
      question: () => `Close ${closedPreview(row)} for ${name} without a step?`,
      sees: () => "The player is told nothing.",
      yes: "Yes, dismiss",
      busy: "Dismissing…",
      send: () => {
        const text = note.value.trim();
        return this.send(row, name, text ? { action: "dismiss", note: text } : { action: "dismiss" });
      },
      cancel: close,
    });
    note.addEventListener("input", () => form.changed());
    return form.element;
  }
}

/** What a step would close, before it is sent: "1 chat case (4 reports) and 3 word-filter lines". */
export const closedPreview = (row: InboxPlayer): string =>
  closedWords({ caseId: row.caseId, reports: row.reports, filterLines: row.filterLines }).replace(", ", " and ");
