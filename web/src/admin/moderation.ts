import {
  MAX_MODERATION_REASON,
  fetchChatReports,
  fetchPlayerModeration,
  moderatePlayer,
  searchPlayers,
  type ChatReportView,
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
 * The Moderation section: find a player (or pick a chat report), see their
 * state and history, and warn them, pause their chat, ban them, or lift a
 * ban or pause. Every step is checked on the server, which refuses game team
 * accounts; the page only offers what makes sense.
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
  const setConfirming = (on: boolean) => {
    confirm.hidden = !on;
    submitRow.hidden = on;
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
    h("p", { class: "note mod-sees" }, PLAYER_SEES[kind]),
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
  private reportList: ChatReportView[] = [];
  private nextBefore: number | null = null;
  private searchTimer = 0;
  private searchSeq = 0;
  private openSeq = 0;
  /** The player on show, the report they were opened from, and the open form. */
  private current: { player: PlayerModeration; chatReportId: number | null; form: ModerationKind | null } | null =
    null;

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
    replace(
      this.element,
      h(
        "p",
        { class: "lede" },
        "Warn a player, pause their chat, or ban them. Pick a chat report below to act on it, " +
          "or find the player by name.",
      ),
      h(
        "div",
        { class: "group finder" },
        h("label", { class: "field-label", attrs: { for: "mod-search" } }, "Find a player"),
        this.search,
        this.results,
      ),
      this.picked,
      this.reports,
    );
  }

  /** Loads the reports again, and the player on show unless a form is open. */
  async refresh(): Promise<void> {
    const reload =
      this.current && this.current.form === null
        ? this.open(this.current.player.userid, this.current.chatReportId ?? undefined, false)
        : Promise.resolve();
    await Promise.all([this.loadReports(), reload]);
  }

  /** Shows a player's state, history and actions; `chatReportId` links what is done to that report. */
  async open(userid: number, chatReportId?: number, scroll = true): Promise<void> {
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
    this.current = { player, chatReportId: chatReportId ?? null, form: null };
    this.renderCard();
    if (scroll) this.picked.scrollIntoView?.({ block: "start" });
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
    this.picked.querySelector<HTMLElement>(".mod-form textarea, .mod-form .seg")?.focus();
  }

  private renderCard(): void {
    const current = this.current;
    if (!current) {
      replace(this.picked);
      return;
    }
    const { player, chatReportId, form } = current;
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
              this.current = { player: after, chatReportId, form: null };
              this.renderCard();
              void this.loadReports();
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
      ),
    );
  }

  private async loadReports(more = false): Promise<void> {
    try {
      const answer = await fetchChatReports(more ? (this.nextBefore ?? undefined) : undefined);
      this.reportList = more ? [...this.reportList, ...answer.reports] : answer.reports;
      this.nextBefore = answer.nextBefore;
    } catch (err) {
      replace(
        this.reports,
        h("h3", {}, "Chat reports"),
        h("p", { class: "note" }, `The reports could not be loaded: ${errorWords(err)}`),
      );
      return;
    }
    const open = (report: ChatReportView) => void this.open(report.reported.userid, report.id);
    replace(
      this.reports,
      h(
        "div",
        { class: "log-head" },
        h("h3", {}, "Chat reports"),
        h("span", { class: "hint" }, "Newest first. Pick one to act on the player."),
      ),
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
