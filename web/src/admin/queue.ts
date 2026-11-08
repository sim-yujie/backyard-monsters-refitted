import { ApiError } from "@/api/http";
import {
  MAX_MODERATION_REASON,
  MAX_SHINY_AWARD,
  actOnInboxPlayer,
  awardCaseReporters,
  fetchAttackLog,
  fetchChatCase,
  fetchChatCases,
  fetchChatFlags,
  fetchChatLog,
  fetchClosed,
  fetchInbox,
  fetchModConversations,
  fetchPlayerModeration,
  searchPlayers,
  type AttackLogView,
  type ChatCaseView,
  type ClosedDecision,
  type FlaggedPlayer,
  type InboxActionBody,
  type InboxList,
  type InboxPlayer,
  type InboxSource,
  type ModConversationSummary,
  type PlayerMatch,
  type PlayerModeration,
} from "./api";
import { lootWords, resultWords, yardWord } from "./attacks";
import { AWARD_MAIL, defaultAward, nameOf, snapshotLine } from "./cases";
import { h, replace, type Child } from "./dom";
import {
  closesWords,
  countEvidence,
  lengthWords,
  mergeEvidence,
  outcomeWords,
  reportedByWords,
  rowWords,
  scopeOf,
  scopeWords,
  type EvidenceLine,
  type Scope,
} from "./evidence";
import { ago, count, dateTime, plural } from "./format";
import { icon } from "./icons";
import { BAN_LENGTHS, DEFAULT_WARNING, disguisedChip, entryRow, markWords, roomLabel, severityChip } from "./moderation";
import { errorWords } from "./shiny";
import type { ViewParams } from "./views";

/**
 * The Moderation page's list (owner, 8 Nov 2026, built on Codex astra's
 * mock-up): ONE queue of players with player reports and word-filter
 * catches, filtered All / Player reports / Word filter / Closed. A player
 * opens beside the list on a computer and in its place on a phone ("Back to
 * inbox"): every line they said that is open against them, each with who
 * reported it and when it was said, then their attack log and moderator mail
 * as tabs, and ONE action bar (Dismiss / Warn / Restrict chat / Ban) that
 * says what it covers: "Applies to all 3 messages, closes 4 reports". Nothing
 * is suggested; every action is confirmed with a reason first.
 *
 * A line both reported and caught by the word filter is one line with both
 * sources, never counted twice (`evidence.ts`).
 *
 * The address keeps what is on show (`#moderation?filter=reports&player=42&act=warn`),
 * so Back closes the confirm step, then the player, and a Home card can open one.
 */

export type QueueFilter = "all" | "reports" | "filter" | "closed";
export type ActKind = "dismiss" | "warn" | "restrict" | "ban";
export type RecordTab = "reports" | "attacks" | "mail";

export const FILTERS: readonly (readonly [QueueFilter, string])[] = [
  ["all", "All"],
  ["reports", "Player reports"],
  ["filter", "Word filter"],
  ["closed", "Closed"],
];

const ACTS: readonly (readonly [ActKind, string])[] = [
  ["dismiss", "Dismiss"],
  ["warn", "Warn"],
  ["restrict", "Restrict chat"],
  ["ban", "Ban"],
];

const TABS: readonly (readonly [RecordTab, string])[] = [
  ["reports", "Reports"],
  ["attacks", "Attack log"],
  ["mail", "Mail"],
];

/** How long Restrict chat lasts, in hours. */
export const RESTRICT_LENGTHS: readonly (readonly [number, string])[] = [
  [1, "1 hour"],
  [24, "1 day"],
  [72, "3 days"],
  [168, "7 days"],
];

const pick = <T extends string>(list: readonly (readonly [T, string])[], raw: string | undefined, fallback: T): T =>
  list.some(([id]) => id === raw) ? (raw as T) : fallback;

const wholeId = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return raw && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** What the address asks the queue to show. */
export const readQueueParams = (params: ViewParams): { filter: QueueFilter; player: number | null; act: ActKind | null; tab: RecordTab } => {
  const player = wholeId(params["player"]);
  return {
    filter: pick(FILTERS, params["filter"], "all"),
    player,
    act: player !== null && ACTS.some(([id]) => id === params["act"]) ? (params["act"] as ActKind) : null,
    tab: pick(TABS, params["tab"], "reports"),
  };
};

/** The server's reason for refusing a step (409), or null. */
const refusal = (err: unknown): string | null => {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { reason?: unknown } | null | undefined;
  return typeof body?.reason === "string" ? body.reason : null;
};

/** What the owner did, for the toast and the result line. */
export const doneWords = (name: string, body: InboxActionBody): string => {
  if (body.action === "warn") return `${name} warned`;
  if (body.action === "mute") return `${name}’s chat restricted for ${lengthWords(body.hours)}`;
  if (body.action === "ban") return body.days === null ? `${name} banned until you lift it` : `${name} banned for ${plural(body.days, "day")}`;
  return `Dismissed for ${name}`;
};

/** Everything shown about one opened player. */
interface Opened {
  userid: number;
  row: InboxPlayer | null;
  chatCase: ChatCaseView | null;
  flags: FlaggedPlayer | null;
  record: PlayerModeration | null;
  closed: ClosedDecision[];
  lines: EvidenceLine[];
  attacks?: AttackLogView | null;
  mail?: ModConversationSummary[] | null;
  /** The last step's result, shown above the evidence. */
  result: HTMLElement | null;
}

export interface QueueOptions {
  say(message: string): void;
  /** The players in each list, or null when they could not be read. */
  onCount(counts: InboxList["counts"] | null): void;
  /** A step closed items: other views changed too. */
  onChanged(): void;
  /** Opens the player in Find a player (every tool, the whole record). */
  openPlayer(userid: number): void;
  /** Moves the address to what should be on show; the dashboard calls {@link QueueView.show} back. */
  navigate(params: { filter: QueueFilter; player: number | null; act?: ActKind | null; tab?: RecordTab | null }): void;
}

/** The Moderation queue and the opened player's record. */
export class QueueView {
  readonly element = h("div", { class: "workspace" });
  private readonly search = h("input", {
    class: "input",
    attrs: { type: "search", placeholder: "Name or account number", "aria-label": "Search players", autocomplete: "off" },
  });
  private readonly filterBox: HTMLElement;
  private readonly listBox = h("div", { class: "queue-list" }, h("div", { class: "skeleton" }));
  private readonly detail = h("section", { class: "detail", attrs: { "aria-live": "polite", "aria-label": "Player" } });
  private filter: QueueFilter = "all";
  private rows: InboxPlayer[] = [];
  private decisions: ClosedDecision[] = [];
  private next: number | null = null;
  private counts: InboxList["counts"] | null = null;
  private closedCount: number | null = null;
  private matches: PlayerMatch[] = [];
  private loaded = false;
  private openId: number | null = null;
  private act: ActKind | null = null;
  private tab: RecordTab = "reports";
  private opened: Opened | null = null;
  private listY = 0;
  private seq = 0;
  private openSeq = 0;
  private searchTimer = 0;
  private searchSeq = 0;

  constructor(private readonly options: QueueOptions) {
    this.filterBox = h(
      "div",
      { class: "filter-grid", attrs: { role: "group", "aria-label": "Show" } },
      ...FILTERS.map(([id, words]) =>
        h(
          "button",
          {
            class: "seg",
            attrs: { type: "button", "data-filter": id, "aria-pressed": String(id === this.filter) },
            onClick: () => this.options.navigate({ filter: id, player: this.openId }),
          },
          h("span", {}, words),
          h("span", { class: "seg-count" }),
        ),
      ),
    );
    this.search.addEventListener("input", () => this.onSearch());
    replace(
      this.element,
      h(
        "div",
        { class: "queue-pane" },
        h("label", { class: "search-wrap" }, icon("search", 18), this.search),
        this.filterBox,
        this.listBox,
        h(
          "details",
          { class: "queue-footer" },
          h("summary", {}, "Looking for moderators or conversations?"),
          h("p", {}, "Chat moderators, their mail with players and any player’s whole record have their own tabs on this page."),
          h(
            "p",
            { class: "row" },
            h("a", { attrs: { href: "#moderators" } }, "Moderators"),
            h("a", { attrs: { href: "#modmail" } }, "Moderator mail"),
            h("a", { attrs: { href: "#find" } }, "Find a player"),
          ),
        ),
      ),
      this.detail,
    );
    this.renderEmptyDetail();
  }

  /** Shows what the address asks for: a filter, a player, their tab and a confirm step. */
  async show(params: ViewParams): Promise<void> {
    const want = readQueueParams(params);
    const work: Promise<void>[] = [];
    if (want.filter !== this.filter || !this.loaded) {
      this.filter = want.filter;
      this.markFilter();
      work.push(this.loadList());
    }
    const samePlayer = want.player === this.openId;
    this.act = want.act;
    this.tab = want.tab;
    if (!samePlayer) work.push(want.player === null ? Promise.resolve(this.closePlayer()) : this.openPlayer(want.player));
    else if (this.opened) this.renderPlayer();
    await Promise.all(work);
  }

  /** Reads the list again, and the opened player. */
  async refresh(): Promise<void> {
    await Promise.all([this.loadList(), this.openId !== null ? this.loadPlayer(this.openId) : Promise.resolve()]);
  }

  private go(over: { player?: number | null; act?: ActKind | null; tab?: RecordTab | null } = {}): void {
    this.options.navigate({
      filter: this.filter,
      player: over.player === undefined ? this.openId : over.player,
      act: over.act === undefined ? this.act : over.act,
      tab: over.tab === undefined ? (this.tab === "reports" ? null : this.tab) : over.tab,
    });
  }

  private markFilter(): void {
    for (const seg of this.filterBox.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
      seg.setAttribute("aria-pressed", String(seg.dataset["filter"] === this.filter));
    }
  }

  private renderCounts(): void {
    for (const seg of this.filterBox.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
      const id = seg.dataset["filter"] as QueueFilter;
      const n = id === "closed" ? this.closedCount : (this.counts?.[id] ?? null);
      replace(seg.querySelector(".seg-count")!, n === null ? null : ` ${n}`);
    }
  }

  private async loadList(more = false): Promise<void> {
    const seq = ++this.seq;
    const offset = more ? (this.next ?? undefined) : undefined;
    try {
      const closedWanted = this.filter === "closed";
      const [inbox, closed] = await Promise.all([
        closedWanted && more ? Promise.resolve(null) : fetchInbox({ source: closedWanted ? "all" : (this.filter as InboxSource), offset: closedWanted ? undefined : offset }),
        closedWanted || !this.loaded ? fetchClosed({ offset: closedWanted ? offset : undefined }) : Promise.resolve(null),
      ]);
      if (seq !== this.seq) return;
      if (inbox) {
        this.counts = inbox.counts;
        this.options.onCount(inbox.counts);
        if (!closedWanted) {
          this.rows = more ? [...this.rows, ...inbox.players] : inbox.players;
          this.next = inbox.nextOffset;
        }
      }
      if (closed) {
        this.closedCount = closed.count;
        if (closedWanted) {
          this.decisions = more ? [...this.decisions, ...closed.decisions] : closed.decisions;
          this.next = closed.nextOffset;
        }
      }
    } catch (err) {
      if (seq !== this.seq) return;
      this.options.onCount(null);
      replace(this.listBox, h("p", { class: "note" }, `The list could not be loaded: ${errorWords(err)}`));
      return;
    }
    this.loaded = true;
    this.renderCounts();
    this.renderList();
  }

  private query(): string {
    return this.search.value.trim().toLowerCase();
  }

  private onSearch(): void {
    this.renderList();
    window.clearTimeout(this.searchTimer);
    const q = this.search.value.trim();
    if (q.length < 2) {
      this.matches = [];
      this.renderList();
      return;
    }
    this.searchTimer = window.setTimeout(() => void this.searchAll(q), 300);
  }

  /** Any player, by name or account number: opens their record even with nothing open. */
  private async searchAll(q: string): Promise<void> {
    const seq = ++this.searchSeq;
    try {
      const answer = await searchPlayers(q);
      if (seq !== this.searchSeq) return;
      this.matches = answer.players.filter((p) => !p.bot);
    } catch {
      if (seq !== this.searchSeq) return;
      this.matches = [];
    }
    this.renderList();
  }

  private matchesQuery(userid: number, username: string | null): boolean {
    const q = this.query();
    return !q || String(userid) === q || (username ?? "").toLowerCase().includes(q);
  }

  private renderList(): void {
    const closed = this.filter === "closed";
    const items = closed
      ? this.decisions.filter((d) => this.matchesQuery(d.userid, d.username)).map((d) => this.closedRow(d))
      : this.rows.filter((r) => this.matchesQuery(r.userid, r.username)).map((r) => this.row(r));
    const shown = new Set(closed ? this.decisions.map((d) => d.userid) : this.rows.map((r) => r.userid));
    const others = this.query() ? this.matches.filter((m) => !shown.has(m.userid)) : [];
    replace(
      this.listBox,
      items.length
        ? h("div", { class: "queue", attrs: { role: "list" } }, ...items)
        : this.query()
          ? h("p", { class: "note" }, others.length ? "Nobody in this list matches." : "Nobody matches.")
          : this.emptyList(),
      others.length
        ? h(
            "div",
            { class: "queue-others" },
            h("p", { class: "eyebrow" }, "Other players"),
            h("div", { class: "queue", attrs: { role: "list" } }, ...others.slice(0, 8).map((m) => this.matchRow(m))),
          )
        : null,
      this.next !== null && !this.query()
        ? h("button", { class: "button quiet wide", attrs: { type: "button" }, onClick: () => void this.loadList(true) }, "Show more")
        : null,
    );
  }

  private emptyList(): HTMLElement {
    const words: Record<QueueFilter, string> = {
      all: "Players others report and lines the word filter catches show up here, one row per player.",
      reports: "When a player reports a chat line, the player who said it shows up here.",
      filter: "Players whose lines only the word filter caught show up here.",
      closed: "Decisions from the last 30 days show up here.",
    };
    return h(
      "div",
      { class: "q-empty" },
      h("span", { class: "needs-icon" }, icon("ok", 22)),
      h("strong", {}, this.filter === "closed" ? "No decisions yet" : "Nothing needs you"),
      h("p", {}, words[this.filter]),
    );
  }

  private rowButton(userid: number, ...children: Child[]): HTMLElement {
    return h(
      "a",
      {
        class: "q-row",
        attrs: {
          role: "listitem",
          href: `#moderation?${new URLSearchParams({ ...(this.filter === "all" ? {} : { filter: this.filter }), player: String(userid) })}`,
          "data-player": String(userid),
          ...(userid === this.openId ? { "aria-current": "true" } : {}),
        },
      },
      ...children,
    );
  }

  /** One player waiting: name, sources, the newest line, counts (each line once), how long. */
  private row(player: InboxPlayer): HTMLElement {
    const reported = player.reportedMessages > 0;
    const caught = player.filterLines > 0;
    return this.rowButton(
      player.userid,
      h(
        "span",
        { class: "row spread q-row-top" },
        h("strong", {}, nameOf(player.userid, player.username)),
        h(
          "time",
          { class: "small", attrs: { datetime: player.oldestAt, title: `Waiting since ${dateTime(player.oldestAt)}` } },
          ago(player.oldestAt),
        ),
      ),
      h(
        "span",
        { class: "row q-tags" },
        reported ? h("span", { class: "badge blue" }, icon("flag", 13), "Player reports") : null,
        caught ? h("span", { class: "badge amber" }, icon("warn", 13), "Word filter") : null,
        player.slurs ? h("span", { class: "badge red" }, "Slur") : null,
        player.banned ? h("span", { class: "badge red" }, "Banned") : null,
        player.muted ? h("span", { class: "badge" }, "Chat restricted") : null,
      ),
      player.preview ? h("span", { class: "preview-line" }, `“${player.preview.text}”`) : null,
      h("span", { class: "small" }, rowWords(player)),
    );
  }

  private closedRow(decision: ClosedDecision): HTMLElement {
    return this.rowButton(
      decision.userid,
      h(
        "span",
        { class: "row spread q-row-top" },
        h("strong", {}, nameOf(decision.userid, decision.username)),
        h("time", { class: "small", attrs: { datetime: decision.closedAt, title: dateTime(decision.closedAt) } }, ago(decision.closedAt)),
      ),
      h(
        "span",
        { class: "row q-tags" },
        h("span", { class: decision.outcome === "dismiss" ? "badge" : "badge green" }, outcomeWords(decision)),
        decision.closedByName ? h("span", { class: "small" }, `by ${decision.closedByName}`) : null,
      ),
      decision.preview ? h("span", { class: "preview-line" }, `“${decision.preview.text}”`) : null,
      h("span", { class: "small" }, decision.note ? `Reason: ${decision.note}` : rowWords({ ...decision, filterOnlyLines: decision.filterOnlyLines })),
    );
  }

  private matchRow(match: PlayerMatch): HTMLElement {
    return this.rowButton(
      match.userid,
      h("span", { class: "row spread q-row-top" }, h("strong", {}, match.username), h("span", { class: "small" }, `#${match.userid}`)),
      h("span", { class: "small" }, match.lastSeenAt ? `Last seen ${ago(match.lastSeenAt)}` : "Not seen yet"),
    );
  }

  private markRows(): void {
    for (const row of this.listBox.querySelectorAll<HTMLElement>("[data-player]")) {
      if (row.dataset["player"] === String(this.openId)) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
  }

  private phone(): boolean {
    return window.matchMedia?.("(max-width: 800px)").matches ?? false;
  }

  private async openPlayer(userid: number): Promise<void> {
    if (this.openId === null && this.phone()) this.listY = window.scrollY;
    this.openId = userid;
    this.opened = null;
    this.element.classList.add("has-player");
    replace(this.detail, h("div", { class: "detail-head" }, h("div", { class: "skeleton-group" }, h("div", { class: "skeleton" }), h("div", { class: "skeleton" }))));
    this.markRows();
    if (this.phone()) window.scrollTo?.(0, 0);
    await this.loadPlayer(userid);
  }

  private closePlayer(): void {
    const wasOpen = this.openId !== null;
    this.openId = null;
    this.opened = null;
    this.act = null;
    this.element.classList.remove("has-player");
    this.renderEmptyDetail();
    this.markRows();
    if (wasOpen && this.phone()) window.scrollTo?.(0, this.listY);
  }

  private renderEmptyDetail(): void {
    replace(
      this.detail,
      h(
        "div",
        { class: "q-empty" },
        h("span", { class: "needs-icon" }, icon("shield", 22)),
        h("strong", {}, "Pick a player"),
        h("p", {}, "Their reported lines, who reported them, their attack log and mail open here."),
      ),
    );
  }

  /** Reads everything about a player: their row, the case, the filter lines, the record, past decisions. */
  private async loadPlayer(userid: number, result: HTMLElement | null = null): Promise<void> {
    const seq = ++this.openSeq;
    let row: InboxPlayer | null;
    try {
      row = (await fetchInbox({ userid })).players[0] ?? null;
    } catch (err) {
      if (seq !== this.openSeq) return;
      replace(this.detail, h("div", { class: "detail-head" }, this.backLink(), h("p", { class: "note" }, `This player could not be loaded: ${errorWords(err)}`)));
      return;
    }
    const [chatCase, flags, record, closed] = await Promise.all([
      row?.caseId ? fetchChatCase(row.caseId).then((a) => a.case).catch(() => null) : Promise.resolve(null),
      row?.filterLines ? fetchChatFlags({ userid, lines: 50 }).then((a) => a.players[0] ?? null).catch(() => null) : Promise.resolve(null),
      fetchPlayerModeration(userid).then((a) => a.player).catch(() => null),
      fetchClosed({ userid }).then((a) => a.decisions).catch(() => [] as ClosedDecision[]),
    ]);
    if (seq !== this.openSeq || this.openId !== userid) return;
    const before = this.opened?.userid === userid ? this.opened : null;
    this.opened = {
      userid,
      row,
      chatCase,
      flags,
      record,
      closed,
      lines: mergeEvidence(chatCase, flags?.lines ?? []),
      result: result ?? before?.result ?? null,
    };
    this.renderPlayer();
  }

  private backLink(): HTMLElement {
    return h(
      "a",
      { class: "back-link", attrs: { href: `#moderation${this.filter === "all" ? "" : `?filter=${this.filter}`}` } },
      icon("back", 16),
      "Back to inbox",
    );
  }

  private nameNow(): string {
    const o = this.opened;
    if (!o) return "";
    return o.row ? nameOf(o.row.userid, o.row.username) : (o.record?.username ?? `#${o.userid}`);
  }

  private renderPlayer(): void {
    const o = this.opened;
    if (!o) return;
    const { row, record } = o;
    const name = this.nameNow();
    const tabs = h(
      "div",
      { class: "rtabs", attrs: { role: "tablist", "aria-label": "Player record" } },
      ...TABS.map(([id, words]) =>
        h(
          "button",
          {
            class: "rtab",
            attrs: {
              type: "button",
              role: "tab",
              id: `rtab-${id}`,
              "aria-selected": String(id === this.tab),
              "aria-controls": "record-panel",
              tabindex: id === this.tab ? "0" : "-1",
              "data-tab": id,
            },
            onClick: () => this.go({ tab: id === "reports" ? null : id }),
          },
          words,
        ),
      ),
    );
    tabs.addEventListener("keydown", (event) => {
      const at = TABS.findIndex(([id]) => id === this.tab);
      const to =
        event.key === "ArrowRight" ? (at + 1) % TABS.length : event.key === "ArrowLeft" ? (at + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
      if (to < 0) return;
      event.preventDefault();
      const id = TABS[to]![0];
      this.go({ tab: id === "reports" ? null : id });
    });
    const head = h(
      "header",
      { class: "detail-head" },
      this.backLink(),
      h(
        "div",
        { class: "row spread" },
        h(
          "h2",
          { class: "row" },
          name,
          row?.banned || record?.banned ? h("span", { class: "badge red" }, "Banned") : null,
          row?.muted || record?.muteUntil ? h("span", { class: "badge amber" }, "Chat restricted") : null,
          row?.gameTeam || record?.gameTeam ? h("span", { class: "badge blue" }, "Game team") : null,
        ),
        h(
          "button",
          { class: "button link account", attrs: { type: "button" }, onClick: () => this.options.openPlayer(o.userid) },
          `Account #${o.userid}`,
        ),
      ),
      h(
        "p",
        { class: "summary" },
        row ? `${rowWords(row)} · waiting since ${dateTime(row.oldestAt)}` : "No open reports",
        record?.lastSeenAt ? ` · last seen ${ago(record.lastSeenAt)}` : null,
      ),
      tabs,
    );
    const panelBox = h("div", { class: "evidence", attrs: { id: "record-panel", role: "tabpanel", "aria-labelledby": `rtab-${this.tab}`, tabindex: "0" } });
    if (this.tab === "attacks") void this.fillAttacks(panelBox);
    else if (this.tab === "mail") void this.fillMail(panelBox);
    else replace(panelBox, ...this.reportsTab());
    const canAct = row !== null && !row.gameTeam;
    const confirm = canAct && this.act ? this.confirmPane(row, name, this.act) : null;
    replace(
      this.detail,
      head,
      h("div", { class: `review-body${confirm ? " has-confirm" : ""}` }, panelBox, confirm),
      canAct ? this.actionBar(row) : null,
    );
    confirm?.querySelector<HTMLElement>("textarea, button.seg, button")?.focus();
  }

  /** The Reports tab: the open lines, one each, then earlier decisions and the record. */
  private reportsTab(): Child[] {
    const o = this.opened!;
    const { row, lines, chatCase, closed, record } = o;
    const out: Child[] = [o.result];
    if (row) {
      const missing = lines.filter((l) => l.reported && (!l.reported.message.verified || l.reported.message.snapshot.lines.length === 0)).length;
      if (missing) {
        out.push(
          h(
            "div",
            { class: "notice", attrs: { role: "note" } },
            icon("warn", 18),
            h(
              "p",
              {},
              missing === 1
                ? "For 1 reported message the chat server kept no copy, so the words come from the reporter’s game and the chat around it is missing. "
                : `For ${missing} reported messages the chat server kept no copy, so the words come from the reporters’ games and the chat around them is missing. `,
              "That alone says nothing about what was meant.",
            ),
          ),
        );
      }
      if (row.caseId !== null && !chatCase) out.push(h("p", { class: "note" }, "The reported messages could not be loaded."));
      if (row.filterLines && !o.flags) out.push(h("p", { class: "note" }, "The word filter’s lines could not be loaded."));
      out.push(...lines.map((line) => this.lineBlock(line, o.userid)));
      const counted = countEvidence(lines);
      if (o.flags && row.filterOnlyLines > counted.filterOnly) {
        out.push(h("p", { class: "note" }, `The newest ${plural(counted.filterOnly, "word-filter catch", "word-filter catches")} are shown; acting closes all ${row.filterOnlyLines}.`));
      }
    } else {
      out.push(
        h(
          "div",
          { class: "q-empty" },
          h("span", { class: "needs-icon" }, icon("ok", 22)),
          h("strong", {}, "No open reports"),
          h("p", {}, "Nothing is waiting for this player. To warn or ban them anyway, open their account."),
          h("button", { class: "button", attrs: { type: "button" }, onClick: () => this.options.openPlayer(o.userid) }, "Open account"),
        ),
      );
    }
    out.push(this.historyBlock(record, closed));
    return out;
  }

  /** One line they said: its sources, their words, when, who reported it, and the chat around it. */
  private lineBlock(line: EvidenceLine, offender: number): HTMLElement {
    const at = new Date(line.ts).toISOString();
    const flag = line.filter;
    const snap = line.reported?.message.snapshot.lines ?? [];
    const context = h("div", { class: "chat-context-box" });
    if (snap.length) {
      replace(context, h("ol", { class: "chat-context snap", attrs: { "aria-label": "The chat around the line" } }, ...snap.map((l) => snapshotLine(l, offender))));
    } else if (flag) {
      replace(
        context,
        h(
          "button",
          { class: "button link", attrs: { type: "button" }, onClick: () => void this.loadContext(context, line, offender) },
          "Show the chat around it",
        ),
      );
    }
    return h(
      "article",
      { class: "ev-line", attrs: { "data-ts": String(line.ts), "data-sources": [line.reported ? "report" : "", flag ? "filter" : ""].filter(Boolean).join(" ") } },
      h(
        "div",
        { class: "row q-tags" },
        line.reported ? h("span", { class: "badge blue" }, icon("flag", 13), "Player report") : null,
        flag ? h("span", { class: "badge amber" }, icon("warn", 13), "Word filter") : null,
        flag ? severityChip(flag.severity) : null,
        flag?.rule === "disguised" ? disguisedChip(flag.words) : null,
        line.reported && !line.reported.message.verified ? h("span", { class: "badge" }, "Not matched") : null,
      ),
      h("blockquote", {}, "“", ...(flag ? markWords(line.message, flag.words) : [line.message]), "”"),
      h(
        "p",
        { class: "small" },
        `${roomLabel(line.channel)} · said `,
        h("time", { attrs: { datetime: at } }, dateTime(at)),
        flag ? ` · players saw “${flag.shown}”` : null,
      ),
      line.reported ? h("p", { class: "reporter-line" }, reportedByWords(line.reported.reporters)) : null,
      context,
    );
  }

  /** The chat log around a word-filter line (kept 90 days), read when asked for. */
  private async loadContext(box: HTMLElement, line: EvidenceLine, offender: number): Promise<void> {
    replace(box, h("div", { class: "skeleton" }));
    try {
      const answer = await fetchChatLog({ channel: line.channel, until: line.ts + 60_000 });
      const near = answer.lines.filter((l) => Date.parse(l.at) <= line.ts + 60_000).slice(0, 8).reverse();
      replace(
        box,
        near.length
          ? h(
              "ol",
              { class: "chat-context snap" },
              ...near.map((l) =>
                snapshotLine({ userid: l.userid, name: l.username, text: l.message, at: Date.parse(l.at), ...(l.userid === offender && Math.abs(Date.parse(l.at) - line.ts) < 1000 ? { reported: true as const } : {}) }, offender),
              ),
            )
          : h("p", { class: "note" }, "The chat log has nothing around this line (it keeps 90 days)."),
      );
    } catch (err) {
      replace(box, h("p", { class: "note" }, `The chat around it could not be read: ${errorWords(err)}`));
    }
  }

  /** Earlier warnings, restrictions and bans, and earlier decisions on reports (with the reporters' Shiny). */
  private historyBlock(record: PlayerModeration | null, closed: readonly ClosedDecision[]): HTMLElement {
    const steps = record?.log ?? [];
    return h(
      "section",
      { class: "history" },
      h("h3", {}, "Previous moderation"),
      steps.length
        ? h("ul", { class: "rows mod-log" }, ...steps.slice(0, 5).map(entryRow))
        : h("p", {}, record ? "No warnings, chat restrictions or bans." : "Their record could not be loaded."),
      steps.length > 5 ? h("p", {}, `${steps.length - 5} older on their account.`) : null,
      closed.length
        ? h(
            "details",
            { attrs: { open: "" } },
            h("summary", {}, icon("history", 16), `Earlier decisions (last 30 days): ${closed.length}`),
            ...closed.map((d) => this.decisionBlock(d)),
          )
        : null,
    );
  }

  private decisionBlock(decision: ClosedDecision): HTMLElement {
    const box = h("div", { class: "award-box" });
    const award =
      decision.caseId !== null && decision.outcome !== "dismiss" && decision.reports > 0
        ? h(
            "button",
            { class: "button quiet", attrs: { type: "button" }, onClick: () => void this.openAward(box, decision.caseId!) },
            icon("gift", 16),
            "Reporters’ Shiny",
          )
        : null;
    return h(
      "div",
      { class: "timeline" },
      h("strong", {}, outcomeWords(decision)),
      h(
        "p",
        {},
        `${dateTime(decision.closedAt)}${decision.closedByName ? ` by ${decision.closedByName}` : ""} · ${plural(decision.messages, "message")}, closed ${closesWords(scopeOf(decision))}`,
      ),
      decision.note ? h("p", {}, `Reason: ${decision.note}`) : null,
      award,
      box,
    );
  }

  /** Shiny for the reporters of a closed case (kept per reporter: nobody is given twice). */
  private async openAward(box: HTMLElement, caseId: number): Promise<void> {
    replace(box, h("div", { class: "skeleton" }));
    let view: ChatCaseView;
    let amounts = { each: 25, first: 50 };
    try {
      const [one, list] = await Promise.all([fetchChatCase(caseId), fetchChatCases("closed").catch(() => null)]);
      view = one.case;
      if (list) amounts = list.award;
    } catch (err) {
      replace(box, h("p", { class: "note" }, `The reporters could not be loaded: ${errorWords(err)}`));
      return;
    }
    const rows = view.reporters.map((reporter) => {
      const done = reporter.award !== null;
      const who = nameOf(reporter.userid, reporter.username);
      const tick = h("input", { attrs: { type: "checkbox", "aria-label": `Give Shiny to ${who}` } });
      tick.checked = !done;
      tick.disabled = done;
      const amount = h("input", {
        class: "input award-amount",
        attrs: { type: "number", inputmode: "numeric", min: "1", max: String(MAX_SHINY_AWARD), "aria-label": `Shiny for ${who}` },
      });
      amount.value = String(done ? reporter.award!.amount : defaultAward(reporter, amounts));
      amount.disabled = done;
      return { reporter, who, done, tick, amount };
    });
    const problem = h("p", { class: "form-error", attrs: { role: "alert", hidden: "" } });
    const give = h("button", { class: "button primary", attrs: { type: "submit" } }, "Give Shiny");
    const form = h(
      "form",
      { class: "award-form" },
      h(
        "ul",
        { class: "award-list" },
        ...rows.map((r) =>
          h(
            "li",
            { class: "row spread" },
            h("label", { class: "row" }, r.tick, r.who, r.reporter.first ? h("span", { class: "badge blue" }, "1st") : null, r.done ? h("span", { class: "badge green" }, "given") : null),
            r.amount,
          ),
        ),
      ),
      h("p", { class: "small" }, `Each gets the Shiny in the game and a mail: “${AWARD_MAIL}”`),
      problem,
      rows.some((r) => !r.done) ? h("div", { class: "row" }, give, h("button", { class: "button", attrs: { type: "button" }, onClick: () => replace(box) }, "Cancel")) : h("p", { class: "note" }, "Every reporter has been given Shiny for this case."),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const picked = rows.filter((r) => !r.done && r.tick.checked);
      const bad = picked.find((r) => {
        const v = Number(r.amount.value);
        return !Number.isSafeInteger(v) || v < 1 || v > MAX_SHINY_AWARD;
      });
      problem.hidden = false;
      if (!picked.length) return void (problem.textContent = "Tick at least one reporter.");
      if (bad) return void (problem.textContent = `Give a whole number of Shiny from 1 to ${count(MAX_SHINY_AWARD)}.`);
      problem.hidden = true;
      give.disabled = true;
      void awardCaseReporters(caseId, picked.map((r) => ({ userid: r.reporter.userid, amount: Number(r.amount.value) })))
        .then((answer) => {
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
          void this.openAward(box, caseId);
        })
        .catch((err: unknown) => {
          give.disabled = false;
          problem.hidden = false;
          problem.textContent = `Not given: ${errorWords(err)}`;
        });
    });
    replace(box, form);
  }

  private async fillAttacks(box: HTMLElement): Promise<void> {
    const o = this.opened!;
    if (o.attacks === undefined) {
      replace(box, h("div", { class: "skeleton" }), h("div", { class: "skeleton" }));
      o.attacks = await fetchAttackLog(o.userid, { side: "both", range: "30d" })
        .then((a) => a.log)
        .catch(() => null);
      if (this.opened !== o || this.tab !== "attacks") return;
    }
    const log = o.attacks;
    if (!log) return replace(box, h("p", { class: "note" }, "The attack log could not be loaded."));
    replace(
      box,
      h(
        "div",
        { class: "record-facts" },
        h("div", {}, h("strong", {}, count(log.summary.made)), "attacks made"),
        h("div", {}, h("strong", {}, count(log.summary.received)), "attacks received"),
        h("div", {}, h("strong", {}, count(log.summary.targets)), "players attacked"),
        h("div", {}, h("strong", {}, count(log.summary.attackers)), "attackers"),
      ),
      h("p", { class: "small" }, `Last 30 days. Attack logs are kept ${plural(log.retentionDays, "day")}.`),
      log.attacks.length
        ? h(
            "div",
            {},
            ...log.attacks.slice(0, 10).map((a) => {
              const loot = lootWords(a.loot);
              const result = resultWords(a.report);
              return h(
                "div",
                { class: "timeline" },
                h("strong", {}, a.direction === "made" ? `Attacked ${a.other.username}` : `Attacked by ${a.other.username}`),
                h("p", {}, [dateTime(a.time), yardWord(a.type), result, loot].filter(Boolean).join(" · ")),
              );
            }),
          )
        : h("p", { class: "note" }, "No attacks in the last 30 days."),
      h("a", { class: "text-link", attrs: { href: `#attacks?player=${o.userid}&range=30d` } }, "Whole attack log"),
    );
  }

  private async fillMail(box: HTMLElement): Promise<void> {
    const o = this.opened!;
    if (o.mail === undefined) {
      replace(box, h("div", { class: "skeleton" }));
      const id = String(o.userid);
      const [asPlayer, asModerator] = await Promise.all([
        fetchModConversations({ recipient: id }).then((a) => a.conversations).catch(() => null),
        fetchModConversations({ moderator: id }).then((a) => a.conversations).catch(() => null),
      ]);
      o.mail = asPlayer === null && asModerator === null ? null : [...(asPlayer ?? []), ...(asModerator ?? [])].filter((c) => c.playerId === o.userid || c.moderatorId === o.userid);
      if (this.opened !== o || this.tab !== "mail") return;
    }
    const mail = o.mail;
    if (!mail) return replace(box, h("p", { class: "note" }, "Their mail could not be loaded."));
    replace(
      box,
      h("p", { class: "small" }, "Mail between this player and chat moderators. Mail between players is private and not kept here."),
      mail.length
        ? h(
            "div",
            {},
            ...mail.map((c) =>
              h(
                "a",
                { class: "timeline q-mail", attrs: { href: `#modmail?thread=${c.threadid}` } },
                h("strong", {}, c.playerId === o.userid ? `With moderator ${c.moderatorName}` : `As moderator, with ${c.playerName}`),
                h("p", {}, `${plural(c.messages, "message")} · last ${ago(c.lastAt)} · “${c.lastSubject || c.lastMessage}”`),
              ),
            ),
          )
        : h("p", { class: "note" }, "No moderator mail with this player."),
    );
  }

  /** ONE action bar: what any action covers, then the four actions. */
  private actionBar(row: InboxPlayer): HTMLElement {
    return h(
      "div",
      { class: "action-bar" },
      h("p", { class: "scope-line" }, scopeWords(scopeOf(row))),
      h(
        "div",
        { class: "action-buttons" },
        ...ACTS.map(([kind, words]) =>
          h(
            "button",
            {
              class: `button${kind === "ban" ? " danger" : kind === "dismiss" ? " quiet" : ""}`,
              attrs: { type: "button", "data-act": kind, "aria-pressed": String(this.act === kind) },
              onClick: () => this.go({ act: this.act === kind ? null : kind }),
            },
            words,
          ),
        ),
      ),
    );
  }

  /** The confirm step: what happens, how long, a reason, what it covers, Cancel / Confirm. */
  private confirmPane(row: InboxPlayer, name: string, kind: ActKind): HTMLElement {
    const scope: Scope = scopeOf(row);
    let hours = RESTRICT_LENGTHS[1]![0];
    let banDays: number | null | undefined;
    const reason = h("textarea", {
      attrs: {
        id: "confirm-reason",
        rows: "3",
        maxlength: String(MAX_MODERATION_REASON),
        placeholder: kind === "dismiss" ? "Optional" : kind === "warn" ? DEFAULT_WARNING : "Say why, in a sentence",
      },
    });
    const segs = <T>(label: string, lengths: readonly (readonly [T, string])[], start: number, onPick: (value: T) => void) => {
      const buttons = lengths.map(([value, words], i) =>
        h(
          "button",
          {
            class: "seg",
            attrs: { type: "button", "aria-pressed": String(i === start) },
            onClick: () => {
              buttons.forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
              onPick(value);
            },
          },
          words,
        ),
      );
      return h("div", { class: "field" }, h("span", {}, label), h("div", { class: "segments", attrs: { role: "group", "aria-label": label } }, ...buttons));
    };
    const titles: Record<ActKind, string> = {
      dismiss: `Dismiss for ${name}?`,
      warn: `Warn ${name}?`,
      restrict: `Restrict ${name}’s chat?`,
      ban: `Ban ${name}?`,
    };
    const explain: Record<ActKind, string> = {
      dismiss: "Nothing happens to the player and they are not told. The reports and catches are closed.",
      warn: "They see your reason in a pop-up in the game and in their mail.",
      restrict: "They can still read chat but cannot write in it until it ends. They see your reason in a pop-up and in their mail.",
      ban: "They are signed out at once. When they try to sign in, they see your reason and when the ban ends.",
    };
    const problem = h("p", { class: "form-error", attrs: { role: "alert", hidden: "" } });
    const confirm = h(
      "button",
      { class: `button ${kind === "ban" ? "danger" : "primary"}`, attrs: { type: "submit" } },
      kind === "dismiss" ? "Confirm dismiss" : kind === "restrict" ? "Confirm restrict" : `Confirm ${kind}`,
    );
    const form = h(
      "form",
      { class: "confirm-pane", attrs: { "aria-labelledby": "confirm-title" } },
      h(
        "div",
        { class: "confirm-fields" },
        h("h3", { attrs: { id: "confirm-title" } }, titles[kind]),
        h("p", {}, explain[kind]),
        kind === "restrict" ? segs("How long", RESTRICT_LENGTHS, 1, (v) => (hours = v)) : null,
        kind === "ban" ? segs("How long", BAN_LENGTHS, -1, (v) => (banDays = v)) : null,
        kind === "ban" ? h("p", { class: "small" }, "“For good” lasts until you lift the ban on their account.") : null,
        h(
          "label",
          { class: "field", attrs: { for: "confirm-reason" } },
          h("span", {}, kind === "dismiss" ? "Note " : "Reason ", h("small", { class: "small" }, kind === "dismiss" ? "only you see this" : "the player sees this")),
          reason,
        ),
        h("div", { class: "scope" }, scopeWords(scope)),
        problem,
      ),
      h(
        "div",
        { class: "buttons" },
        h("button", { class: "button", attrs: { type: "button" }, onClick: () => this.go({ act: null }) }, "Cancel"),
        confirm,
      ),
    );
    form.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.go({ act: null });
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = reason.value.trim();
      const fail = (why: string) => {
        problem.hidden = false;
        problem.textContent = why;
      };
      if (kind === "ban" && banDays === undefined) return fail("Pick how long the ban lasts.");
      if (kind !== "dismiss" && !text) return fail("Write a reason: the player sees it.");
      const body: InboxActionBody =
        kind === "dismiss"
          ? text
            ? { action: "dismiss", note: text }
            : { action: "dismiss" }
          : kind === "warn"
            ? { action: "warn", reason: text }
            : kind === "restrict"
              ? { action: "mute", reason: text, hours }
              : { action: "ban", reason: text, days: banDays ?? null };
      confirm.disabled = true;
      confirm.textContent = "Working…";
      void this.send(row, name, body).catch((err: unknown) => {
        confirm.disabled = false;
        confirm.textContent = "Try again";
        fail(`Not done: ${errorWords(err)}`);
      });
    });
    return form;
  }

  /** Sends a step with what was shown; a change since is shown before anything is done. */
  private async send(row: InboxPlayer, name: string, body: InboxActionBody): Promise<void> {
    const seen = { caseId: row.caseId, reports: row.reports, flagsUpTo: row.flagsUpTo };
    try {
      const answer = await actOnInboxPlayer(row.userid, body, seen);
      const closed = answer.closed;
      const result = h(
        "div",
        { class: "inbox-result", attrs: { role: "status" } },
        h(
          "p",
          {},
          h("strong", {}, `${doneWords(name, body)}. `),
          `Closed ${closesWords({ messages: 0, reports: closed.reports, filterOnly: closed.filterOnlyLines })}.`,
        ),
        answer.player ? h("p", { class: "note" }, "Newer items came in since; they stay open below.") : null,
        closed.caseId !== null && body.action !== "dismiss" ? h("p", { class: "note" }, "You can give the reporters Shiny under Earlier decisions.") : null,
      );
      this.options.say(doneWords(name, body));
      this.options.onChanged();
      this.act = null;
      this.go({ act: null });
      await Promise.all([this.loadList(), this.loadPlayer(row.userid, result)]);
    } catch (err) {
      const why = refusal(err);
      if (why === "changed") {
        this.options.say("Something new came in for this player: look again before acting.");
        this.act = null;
        this.go({ act: null });
        await this.loadPlayer(
          row.userid,
          h("p", { class: "form-error", attrs: { role: "alert" } }, "Not done: new reports or lines came in since you opened this. Here is everything now."),
        );
        return;
      }
      if (why === "nothingOpen") {
        this.options.say("Already closed");
        this.act = null;
        this.go({ act: null });
        await Promise.all([this.loadList(), this.loadPlayer(row.userid)]);
        return;
      }
      throw err;
    }
  }
}
