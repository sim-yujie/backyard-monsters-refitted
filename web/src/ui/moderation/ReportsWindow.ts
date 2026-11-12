import {
  MAX_MOD_REASON,
  MOD_MUTE_LENGTHS,
  modReportsApi,
  refusalReason,
  type AroundLine,
  type ModActBody,
  type ModActKind,
  type ModClosedRow,
  type ModFilter,
  type ModLine,
  type ModList,
  type ModLogEntry,
  type ModPlayer,
  type ModQueueRow,
  type ModReportsApi,
} from "@/api/modReports";
import { make } from "@/ui/friends/rows";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import {
  REFUSAL_FALLBACK,
  REPORTS_TEXT as T,
  ago,
  clock,
  closesWords,
  dateTime,
  logMeta,
  logWords,
  muteLength,
  outcomeWords,
  plural,
  roomLabel,
  rowWords,
  scopeWords,
  severityWords,
} from "./reportsText";
import "./reports.css";

/**
 * The moderators' Reports window (owner, 12 Nov 2026, desk card
 * "mod-reports-b", option B): the admin Moderation page's layout in the
 * game, for moderators only. On the left the players with something open
 * (search, filters All / Reports / Word filter / Closed); on the right the
 * opened player: each open line with who reported it and the chat around it,
 * their earlier warnings and mutes, and Close, Warn or Mute (1 hour, 1 day,
 * 3 days, 7 days) after a confirm step. Bans stay with admins.
 *
 * Every word a player wrote goes in as text, never as markup.
 */

export interface ReportsWindowOptions {
  /** The routes, for a test. */
  readonly api?: ModReportsApi;
  readonly onClose?: () => void;
  /** A step was taken: the door re-reads its count. */
  readonly onChanged?: () => void;
}

/** The phone layout: one column, the list or the player (reports.css). */
export const REPORTS_PHONE_QUERY = "(width <= 620px)";

/** Below this much room the window is one column (reports.css `@container mod-reports`). */
export const REPORTS_TWO_COLUMNS = 720;

const FILTERS: readonly (readonly [ModFilter, GameIconName])[] = [
  ["all", "mail"],
  ["reports", "report"],
  ["filter", "find"],
  ["closed", "shield"],
];

const TICK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const icon = (name: GameIconName, small = false): HTMLImageElement =>
  gameIcon(name, { size: small ? 16 : 24, decorative: true, ...(small ? { className: "mod-reports__gi16" } : {}) });

const badge = (words: string, tone: "" | "blue" | "amber" | "red" | "green" = "", picture?: GameIconName): HTMLElement => {
  const node = make("span", tone ? `mod-reports__badge mod-reports__badge--${tone}` : "mod-reports__badge");
  if (picture) node.append(icon(picture));
  node.append(words);
  return node;
};

const tick = (): HTMLElement => {
  const node = make("span", "mod-reports__tick");
  node.innerHTML = TICK_SVG;
  return node;
};

const empty = (title: string, words: string, picture: HTMLElement, small = false): HTMLElement => {
  const node = make("div", small ? "mod-reports__empty mod-reports__empty--small" : "mod-reports__empty");
  node.append(picture, make("strong", "", title), make("p", "", words));
  return node;
};

const plate = (words: string, kind: "primary" | "outline", run: () => void, picture?: GameIconName): HTMLButtonElement => {
  const node = make("button", `btn btn--${kind} mod-reports__btn`);
  node.type = "button";
  // The word alone is centred on the plate; its picture hangs off its left (reports.css).
  const word = make("span", "mod-reports__btn-word", words);
  if (picture) word.prepend(icon(picture));
  node.append(word);
  node.addEventListener("click", run);
  return node;
};

/** The words with the word filter's catches marked. */
export const markedWords = (text: string, words: readonly string[]): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  const wanted = words.map((word) => word.trim()).filter(Boolean);
  if (!wanted.length) {
    fragment.append(text);
    return fragment;
  }
  const pattern = new RegExp(wanted.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (!match[0]) continue;
    if (start > at) fragment.append(text.slice(at, start));
    fragment.append(make("mark", "", match[0]));
    at = start + match[0].length;
  }
  if (at < text.length) fragment.append(text.slice(at));
  return fragment;
};

/** The chat around a line: time, who, words; theirs in red, the line itself lit. */
export const snapList = (lines: readonly AroundLine[], them: number, line?: Pick<ModLine, "ts">): HTMLElement => {
  const list = make("ol", "mod-reports__snap");
  list.setAttribute("aria-label", "The chat around the line");
  for (const said of lines) {
    const lit = said.reported === true || (line !== undefined && said.userid === them && said.at === line.ts);
    const item = make("li", `mod-reports__snap-line${lit ? " is-reported" : ""}${said.userid === them ? " is-them" : ""}`);
    const time = make("time", "mod-reports__snap-time", clock(said.at));
    time.dateTime = new Date(said.at).toISOString();
    const words = make("span", "mod-reports__snap-text");
    if (lit) {
      const mark = make("span", "mod-reports__snap-mark");
      mark.append(icon("report", true));
      words.append(mark);
    }
    if (said.flagged) words.append(badge(severityWords(said.flagged), said.flagged === "slur" ? "red" : "amber"));
    words.append(said.text);
    item.append(time, make("strong", "mod-reports__snap-who", said.name ?? `#${said.userid}`), words);
    list.append(item);
  }
  return list;
};

/** One column: a phone, or a window too narrow for the list and the player side by side. */
const isNarrow = (workspace: HTMLElement): boolean => {
  const width = workspace.clientWidth;
  if (width > 0 && width < REPORTS_TWO_COLUMNS) return true;
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(REPORTS_PHONE_QUERY).matches;
  } catch {
    return false;
  }
};

const failure = (caught: unknown): string => {
  const reason = refusalReason(caught);
  const words = caught instanceof Error && caught.message ? caught.message : null;
  return (reason && words) || (reason && REFUSAL_FALLBACK[reason]) || words || T.failed;
};

export class ReportsWindow {
  readonly popup: Popup;

  private readonly api: ModReportsApi;
  private readonly options: ReportsWindowOptions;
  private readonly workspace = make("div", "mod-reports__workspace");
  private readonly search = make("input", "mod-reports__input");
  private readonly filters = make("div", "mod-reports__filters");
  private readonly listBox = make("div", "mod-reports__list");
  private readonly detail = make("div", "mod-reports__detail");

  private filter: ModFilter = "all";
  private query = "";
  private list: ModList | null = null;
  private listState: "loading" | "ready" | "failed" = "loading";
  private openId: number | null = null;
  private player: ModPlayer | null = null;
  private playerState: "loading" | "ready" | "failed" = "ready";
  private playerProblem = "";
  private act: ModActKind | null = null;
  private hours = 24;
  private result: { text: string; problem: boolean } | null = null;
  private sending = false;
  private listToken = 0;
  private playerToken = 0;
  private closed = false;
  private problemLine: HTMLElement | null = null;
  private reasonBox: HTMLTextAreaElement | null = null;

  constructor(options: ReportsWindowOptions = {}) {
    this.options = options;
    this.api = options.api ?? modReportsApi;
    this.popup = new Popup({
      title: T.title,
      className: "mod-reports-window",
      onClose: () => {
        this.closed = true;
        options.onClose?.();
      },
    });

    const pane = make("div", "mod-reports__queue-pane");
    const searchWrap = make("label", "mod-reports__search");
    this.search.type = "search";
    this.search.placeholder = T.search;
    this.search.autocomplete = "off";
    this.search.setAttribute("aria-label", T.search);
    this.search.addEventListener("input", () => {
      this.query = this.search.value.trim().toLowerCase();
      this.renderList();
    });
    searchWrap.append(icon("find"), this.search);
    this.filters.setAttribute("role", "group");
    this.filters.setAttribute("aria-label", "Show");
    pane.append(searchWrap, this.filters, this.listBox);
    this.workspace.append(pane, this.detail);
    this.popup.body.append(this.workspace);
    this.render();
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    void this.loadList(true);
    return this;
  }

  close(): void {
    this.popup.close();
  }

  // ── Loading ──────────────────────────────────────────────────────────

  private async loadList(openFirst: boolean): Promise<void> {
    const token = ++this.listToken;
    this.listState = this.list ? this.listState : "loading";
    this.renderList();
    try {
      const list = await this.api.list(this.filter);
      if (token !== this.listToken || this.closed) return;
      this.list = list;
      this.listState = "ready";
    } catch {
      if (token !== this.listToken || this.closed) return;
      this.list = null;
      this.listState = "failed";
    }
    this.renderFilters();
    this.renderList();
    if (openFirst && this.openId === null && !isNarrow(this.workspace)) {
      const first = this.visibleIds()[0];
      if (first !== undefined) void this.openPlayer(first);
    }
  }

  private async loadMore(): Promise<void> {
    const list = this.list;
    if (!list || list.nextOffset === null) return;
    const token = this.listToken;
    try {
      const more = await this.api.list(this.filter, list.nextOffset);
      if (token !== this.listToken || this.closed) return;
      this.list = {
        ...more,
        players: [...list.players, ...more.players],
        closed: [...list.closed, ...more.closed],
      };
      this.renderList();
    } catch {
      // The button stays; another press tries again.
    }
  }

  private async openPlayer(userid: number, keepResult = false): Promise<void> {
    const token = ++this.playerToken;
    if (this.openId !== userid) this.player = null;
    this.openId = userid;
    this.act = null;
    if (!keepResult) this.result = null;
    this.playerState = "loading";
    this.render();
    try {
      const player = await this.api.player(userid);
      if (token !== this.playerToken || this.closed) return;
      this.player = player;
      this.playerState = "ready";
    } catch (caught) {
      if (token !== this.playerToken || this.closed) return;
      this.player = null;
      this.playerState = "failed";
      this.playerProblem = failure(caught);
    }
    this.renderDetail();
    this.renderList();
  }

  // ── What the list shows ──────────────────────────────────────────────

  private matches(userid: number, username: string | null): boolean {
    if (!this.query) return true;
    return (username ?? "").toLowerCase().includes(this.query) || String(userid) === this.query.replace(/^#/, "");
  }

  private shownPlayers(): ModQueueRow[] {
    return (this.list?.players ?? []).filter((row) => this.matches(row.userid, row.username));
  }

  private shownClosed(): ModClosedRow[] {
    return (this.list?.closed ?? []).filter((row) => this.matches(row.userid, row.username));
  }

  private visibleIds(): number[] {
    return this.filter === "closed" ? this.shownClosed().map((row) => row.userid) : this.shownPlayers().map((row) => row.userid);
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private render(): void {
    this.workspace.classList.toggle("has-player", this.openId !== null);
    this.renderFilters();
    this.renderList();
    this.renderDetail();
  }

  private renderFilters(): void {
    const counts = this.list?.counts;
    this.filters.replaceChildren(
      ...FILTERS.map(([id, picture]) => {
        const [words, tip] = T.filters[id];
        const chip = make("button", "mod-reports__seg");
        chip.type = "button";
        chip.dataset["filter"] = id;
        chip.title = tip;
        chip.setAttribute("aria-pressed", String(this.filter === id));
        chip.append(icon(picture), make("span", "", words), make("span", "mod-reports__seg-count", counts ? String(counts[id]) : "–"));
        chip.addEventListener("click", () => this.setFilter(id));
        return chip;
      }),
    );
  }

  private setFilter(filter: ModFilter): void {
    if (this.filter === filter && this.listState !== "failed") return;
    this.filter = filter;
    this.list = null;
    this.openId = null;
    this.player = null;
    this.act = null;
    this.result = null;
    this.render();
    void this.loadList(true);
  }

  private renderList(): void {
    this.workspace.classList.toggle("has-player", this.openId !== null);
    if (this.listState === "loading" && !this.list) {
      this.listBox.replaceChildren(make("p", "mod-reports__empty mod-reports__small", T.loading));
      return;
    }
    if (this.listState === "failed" || !this.list) {
      this.listBox.replaceChildren(make("p", "mod-reports__empty mod-reports__small", T.failed));
      return;
    }
    const closedList = this.filter === "closed";
    const rows = closedList ? this.shownClosed().map((row) => this.closedRow(row)) : this.shownPlayers().map((row) => this.openRow(row));
    if (!rows.length) {
      this.listBox.replaceChildren(
        this.query
          ? make("p", "mod-reports__empty mod-reports__small", T.nobody)
          : empty(closedList ? T.noDecisions : T.nothing, T.empty[this.filter], tick()),
      );
      return;
    }
    if (this.list.nextOffset !== null) {
      const more = make("button", "mod-reports__more", T.more);
      more.type = "button";
      more.addEventListener("click", () => void this.loadMore());
      rows.push(more);
    }
    this.listBox.replaceChildren(...rows);
  }

  private openRow(row: ModQueueRow): HTMLElement {
    const node = make("button", "mod-reports__row");
    node.type = "button";
    node.dataset["player"] = String(row.userid);
    if (this.openId === row.userid) node.setAttribute("aria-current", "true");
    const top = make("span", "mod-reports__row-top");
    const since = make("span", "mod-reports__small", ago(row.oldestAt));
    since.title = `Waiting since ${dateTime(row.oldestAt)}`;
    top.append(make("strong", "", row.username ?? `#${row.userid}`), since);
    const tags = make("span", "mod-reports__tags");
    if (row.reports > 0) tags.append(badge(T.playerReports, "blue", "report"));
    if (row.filterOnlyLines > 0 || row.slurs > 0 || row.preview?.source === "filter") tags.append(badge(T.wordFilter, "amber", "find"));
    if (row.slurs > 0) tags.append(badge("Slur", "red"));
    if (row.muted) tags.append(badge(T.muted, "", "time"));
    if (row.banned) tags.append(badge(T.banned, "red"));
    node.append(top, tags);
    if (row.preview) node.append(make("span", "mod-reports__preview", `“${row.preview.text}”`));
    node.append(make("span", "mod-reports__small", rowWords(row)));
    node.addEventListener("click", () => void this.openPlayer(row.userid));
    return node;
  }

  private closedRow(row: ModClosedRow): HTMLElement {
    const node = make("button", "mod-reports__row");
    node.type = "button";
    node.dataset["closed"] = String(row.userid);
    if (this.openId === row.userid) node.setAttribute("aria-current", "true");
    const top = make("span", "mod-reports__row-top");
    const when = make("span", "mod-reports__small", ago(row.closedAt));
    when.title = dateTime(row.closedAt);
    top.append(make("strong", "", row.username ?? `#${row.userid}`), when);
    const tags = make("span", "mod-reports__tags");
    tags.append(
      badge(outcomeWords(row), row.outcome === "dismiss" ? "" : "green"),
      make("span", "mod-reports__small", `by ${row.closedByName ?? "the game team"}`),
    );
    node.append(top, tags);
    if (row.preview) node.append(make("span", "mod-reports__preview", `“${row.preview.text}”`));
    node.append(make("span", "mod-reports__small", row.note ? `Reason: ${row.note}` : plural(row.messages, "message")));
    node.addEventListener("click", () => void this.openPlayer(row.userid));
    return node;
  }

  private renderDetail(): void {
    this.problemLine = null;
    this.reasonBox = null;
    if (this.openId === null) {
      this.detail.replaceChildren(empty(T.pick, T.pickWords, gameIcon("shield", { size: 32, decorative: true })));
      return;
    }
    const player = this.player;
    const head = make("header", "mod-reports__head");
    const back = plate(T.back, "outline", () => this.back());
    back.classList.add("mod-reports__back");
    head.append(back);

    if (!player) {
      const listed = this.list?.players.find((row) => row.userid === this.openId) ?? this.list?.closed.find((row) => row.userid === this.openId);
      const spread = make("div", "mod-reports__hspread");
      spread.append(make("h2", "", listed?.username ?? `#${this.openId}`), make("span", "mod-reports__account", `#${this.openId}`));
      head.append(spread);
      const words = this.playerState === "failed" ? this.playerProblem : T.loading;
      this.detail.replaceChildren(head, make("p", "mod-reports__empty mod-reports__small", words));
      return;
    }

    const now = Date.now();
    const title = make("h2", "", player.username);
    if (player.muteUntil && Date.parse(player.muteUntil) > now) {
      const muted = badge(T.muted, "amber", "time");
      muted.title = `Until ${dateTime(player.muteUntil)}`;
      title.append(muted);
    }
    if (player.banned) title.append(badge(T.banned, "red"));
    const spread = make("div", "mod-reports__hspread");
    spread.append(title, make("span", "mod-reports__account", `#${player.userid}`));
    const open = player.open;
    const summary = [
      open ? `${rowWords(open)} · waiting since ${dateTime(open.oldestAt)}` : T.noOpen,
      player.lastSeenAt ? `last seen ${ago(player.lastSeenAt, now)} ago` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    head.append(spread, make("p", "mod-reports__summary", summary));

    const review = make("div", "mod-reports__review");
    const evidence = make("div", "mod-reports__evidence");
    if (this.result) {
      const result = make("p", this.result.problem ? "mod-reports__result mod-reports__result--problem" : "mod-reports__result", this.result.text);
      result.setAttribute("role", "status");
      evidence.append(result);
    }
    if (open && player.lines.length) {
      const missing = player.lines.filter((line) => line.report && !line.report.verified).length;
      if (missing) {
        const notice = make("div", "mod-reports__notice");
        notice.append(icon("report"), make("span", "", T.noCopyNotice(missing)));
        evidence.append(notice);
      }
      for (const line of player.lines) evidence.append(this.lineBlock(line, player));
    } else {
      evidence.append(empty(T.noOpen, T.noOpenWords, tick(), true));
    }
    evidence.append(this.historyBlock(player));
    review.append(evidence);

    const parts: HTMLElement[] = [head, review];
    if (open) {
      if (this.act) {
        review.prepend(this.confirmPane(player, this.act));
        parts.push(this.confirmFoot(open, this.act));
      } else {
        parts.push(this.actionBar(open));
      }
    }
    this.detail.replaceChildren(...parts);
  }

  private lineBlock(line: ModLine, player: ModPlayer): HTMLElement {
    const node = make("article", "mod-reports__line");
    const tags = make("div", "mod-reports__tags");
    if (line.report) tags.append(badge(T.playerReport, "blue", "report"));
    if (line.filter) {
      tags.append(badge(T.wordFilter, "amber", "find"), badge(severityWords(line.filter.severity), line.filter.severity === "slur" ? "red" : "amber"));
    }
    if (line.report && !line.report.verified) {
      const noCopy = badge(T.noCopy);
      noCopy.title = T.noCopyTitle;
      tags.append(noCopy);
    }
    const quote = make("blockquote", "");
    quote.append("“", markedWords(line.message, line.filter?.words ?? []), "”");
    const where = [roomLabel(line.channel), `said ${dateTime(line.ts)}`, line.filter ? `players saw “${line.filter.shown}”` : null]
      .filter(Boolean)
      .join(" · ");
    node.append(tags, quote, make("p", "mod-reports__small", where));
    if (line.report) {
      const who = make("p", "mod-reports__reporters");
      who.append(icon("report", true), `Reported by ${plural(line.report.reporters.length, "player")}: ${line.report.reporters.join(", ")}`);
      node.append(who);
    }
    const context = make("div", "mod-reports__context");
    if (line.report && line.report.around.length) {
      context.append(snapList(line.report.around, player.userid, line));
    } else if (line.filter) {
      const flagId = line.filter.id;
      const ask = make("button", "mod-reports__link", T.showAround);
      ask.type = "button";
      ask.addEventListener("click", () => {
        ask.disabled = true;
        void this.api.around(flagId).then(
          (lines) => context.replaceChildren(lines.length ? snapList(lines, player.userid, line) : make("p", "mod-reports__note", T.noAround)),
          (caught) => context.replaceChildren(make("p", "mod-reports__note", failure(caught))),
        );
      });
      context.append(ask);
    }
    node.append(context);
    return node;
  }

  private historyBlock(player: ModPlayer): HTMLElement {
    const node = make("section", "mod-reports__history");
    node.append(make("h3", "", T.history));
    if (player.log.length) {
      const log = make("ul", "mod-reports__log");
      for (const entry of player.log) log.append(this.logEntry(entry));
      node.append(log);
    } else {
      node.append(make("p", "", T.noHistory));
    }
    if (player.decisions.length) {
      const details = make("details", "");
      details.open = true;
      const summary = make("summary", "", T.decisions(player.decisions.length));
      details.append(summary);
      for (const decision of player.decisions) {
        const item = make("div", "mod-reports__timeline");
        item.append(
          make("strong", "", outcomeWords(decision)),
          make(
            "p",
            "",
            `${dateTime(decision.closedAt)} by ${decision.closedByName ?? "the game team"} · ${plural(decision.messages, "message")}, closed ${closesWords(decision)}`,
          ),
        );
        if (decision.note) item.append(make("p", "", `Reason: ${decision.note}`));
        details.append(item);
      }
      node.append(details);
    }
    return node;
  }

  private logEntry(entry: ModLogEntry): HTMLElement {
    const item = make("li", "mod-reports__entry");
    const tone = entry.action === "ban" ? "red" : entry.action === "warn" || entry.action === "mute" ? "amber" : "";
    item.append(badge(logWords(entry.action), tone, entry.action === "mute" ? "time" : undefined));
    const main = make("span", "mod-reports__entry-main");
    main.append(make("span", "", entry.reason), make("span", "mod-reports__small", logMeta(entry)));
    item.append(main);
    return item;
  }

  private actionBar(open: ModQueueRow): HTMLElement {
    const bar = make("div", "mod-reports__actions");
    const row = make("div", "mod-reports__action-row");
    const buttons = make("div", "mod-reports__action-buttons");
    const start = (kind: ModActKind) => () => {
      this.act = kind;
      this.hours = 24;
      this.result = null;
      this.renderDetail();
      this.reasonBox?.focus();
    };
    const closeButton = plate(T.actions.close, "outline", start("close"));
    const warnButton = plate(T.actions.warn, "primary", start("warn"));
    const muteButton = plate(T.actions.mute, "primary", start("mute"), "time");
    closeButton.dataset["act"] = "close";
    warnButton.dataset["act"] = "warn";
    muteButton.dataset["act"] = "mute";
    buttons.append(closeButton, warnButton, muteButton);
    row.append(buttons, make("p", "mod-reports__ban-note", T.banNote));
    bar.append(make("p", "mod-reports__scope", scopeWords(open)), row);
    return bar;
  }

  private confirmPane(player: ModPlayer, kind: ModActKind): HTMLElement {
    const form = make("form", "mod-reports__confirm");
    form.addEventListener("submit", (event) => event.preventDefault());
    form.append(make("h3", "", T.ask[kind](player.username)), make("p", "", T.explain[kind]));
    if (kind === "mute") {
      const field = make("div", "mod-reports__field");
      const lengths = make("div", "mod-reports__lengths");
      lengths.setAttribute("role", "group");
      lengths.setAttribute("aria-label", T.howLong);
      for (const [hours, words] of MOD_MUTE_LENGTHS) {
        const chip = make("button", "mod-reports__seg");
        chip.type = "button";
        chip.dataset["hours"] = String(hours);
        chip.setAttribute("aria-pressed", String(this.hours === hours));
        chip.append(icon("time"), words);
        chip.addEventListener("click", () => {
          this.hours = hours;
          for (const other of lengths.querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === chip));
        });
        lengths.append(chip);
      }
      field.append(make("span", "", T.howLong), lengths);
      form.append(field);
    }
    const label = make("label", "mod-reports__field");
    const words = make("span", "", kind === "close" ? T.note : T.reason);
    words.append(" ", make("small", "", kind === "close" ? T.noteWho : T.reasonWho));
    const reason = make("textarea", "");
    reason.rows = 3;
    reason.maxLength = MAX_MOD_REASON;
    reason.placeholder = kind === "close" ? T.optional : kind === "warn" ? T.defaultWarning : T.sayWhy;
    if (kind === "warn") reason.value = T.defaultWarning;
    label.append(words, reason);
    form.append(label);
    this.reasonBox = reason;
    return form;
  }

  private confirmFoot(open: ModQueueRow, kind: ModActKind): HTMLElement {
    const foot = make("div", "mod-reports__actions mod-reports__confirm-foot");
    const problem = make("p", "mod-reports__problem");
    problem.hidden = true;
    problem.setAttribute("role", "alert");
    this.problemLine = problem;
    const buttons = make("div", "mod-reports__confirm-buttons");
    const cancel = plate(T.cancel, "outline", () => {
      this.act = null;
      this.renderDetail();
    });
    cancel.dataset["cancel"] = "";
    const confirm = plate(T.confirm[kind], "primary", () => void this.confirm(kind, [cancel, confirm]));
    confirm.dataset["confirm"] = "";
    buttons.append(cancel, confirm);
    foot.append(make("p", "mod-reports__scope", scopeWords(open)), problem, buttons);
    return foot;
  }

  private showProblem(words: string): void {
    if (!this.problemLine) return;
    this.problemLine.hidden = false;
    this.problemLine.textContent = words;
  }

  private async confirm(kind: ModActKind, buttons: HTMLButtonElement[]): Promise<void> {
    const player = this.player;
    const open = player?.open;
    if (!player || !open || this.sending) return;
    const text = (this.reasonBox?.value ?? "").trim();
    if (kind !== "close" && !text) {
      this.showProblem(T.needReason);
      this.reasonBox?.focus();
      return;
    }
    const hours = this.hours;
    const body: ModActBody = {
      action: kind,
      ...(kind === "close" ? (text ? { note: text } : {}) : { reason: text }),
      ...(kind === "mute" ? { hours } : {}),
      caseId: open.caseId,
      reports: open.reports,
      flagsUpTo: open.flagsUpTo,
    };
    this.sending = true;
    for (const button of buttons) button.disabled = true;
    try {
      const done = await this.api.act(player.userid, body);
      if (this.closed) return;
      const name = player.username;
      const did =
        kind === "close" ? `Closed for ${name}` : kind === "warn" ? `${name} warned` : `${name}’s chat muted for ${muteLength(hours)}`;
      this.result = { text: `${did}. Closed ${closesWords(done.closed)}.`, problem: false };
      this.act = null;
      this.options.onChanged?.();
      void this.loadList(false);
      await this.openPlayer(player.userid, true);
    } catch (caught) {
      if (this.closed) return;
      if (refusalReason(caught) === "changed" || refusalReason(caught) === "nothingOpen") {
        this.result = { text: failure(caught), problem: true };
        this.act = null;
        void this.loadList(false);
        await this.openPlayer(player.userid, true);
        return;
      }
      for (const button of buttons) button.disabled = false;
      this.showProblem(failure(caught));
    } finally {
      this.sending = false;
    }
  }

  private back(): void {
    this.playerToken += 1;
    this.openId = null;
    this.player = null;
    this.act = null;
    this.result = null;
    this.render();
  }
}
