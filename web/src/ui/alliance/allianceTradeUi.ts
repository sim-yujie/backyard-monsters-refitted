import type { AllianceResult } from "@/api/alliance";
import {
  TRADE_KEYS,
  allianceTradeApi,
  type AllianceTradeApi,
  type TradeAmounts,
  type TradeKey,
  type TradeRequest,
  type TradeStorage,
  type TradeView,
} from "@/api/allianceTrade";
import {
  acceptBlock,
  arriveFor,
  carryCap,
  fitToRoom,
  landing,
  nonZero,
  postCap,
  roomOf,
  sendCap,
  type AcceptBlock,
} from "@/game/alliance/tradeRules";
import { formatAmount, formatCountdown, formatShort } from "@/ui/format";
import { make } from "@/ui/friends/rows";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { resourceIcon, resourceName } from "@/ui/resourceIcon";

/**
 * The alliance window's Trade tab (design v5 §12b; a request is a 1:1 swap,
 * owner 10 and 11 Nov 2026):
 *
 * - the tab: Today (sends / receives left, new day, −10%), your request
 *   (what you give → what you get, Cancel) or New request, mates' requests
 *   each with one Accept that shows what you get, the last 2 trades, a hint;
 * - New request: what you give (one resource), what you get (another), the
 *   amount (500K / 1M / Most or typed), the swap with the 10% shown, Post.
 *   What you give is held by the request until a mate accepts or you cancel;
 * - Send (a mate's row in Members, or chat): tiles, 500K / 1M / Most, the
 *   flow with what really lands, "lost: storage full" and Fit to room.
 *
 * Icons and numbers over words (owner). A sheet takes the tab's place (it
 * fills a phone). The server decides everything
 * (`server/src/services/alliance/trade.ts`); the sums here are its preview.
 */

export const TRADE_TEXT = {
  today: "Today",
  send: "Send",
  receive: "Receive",
  left: "left",
  newDay: "New day",
  loss: "−10% on the way",
  lossShort: "−10%",
  lossLong: "−10% lost on the way",
  yourRequest: "Your request",
  newRequest: "New request",
  postLine: "Swap one resource for another, 1:1. Each side gets 90%.",
  tradedToday: "You traded today. Post again tomorrow.",
  postsUsed: "No more requests today.",
  cancel: "Cancel",
  held: "Held until a mate accepts. Cancel gives it back.",
  requests: "Mates' requests",
  noRequests: "No requests right now.",
  accept: "Accept",
  /** A request's swap, read out: "You give 1,000 Goo, you get 900 Twigs". */
  swapLabel: (give: string, get: string) => `You give ${give}, you get ${get}`,
  takenBy: (name: string) => `✓ ${name}`,
  recent: "Recent trades",
  noRecent: "No trades yet.",
  gave: (from: string, to: string, what: string) => `${from} gave ${to} ${what}`,
  ago: (time: string) => `${time} ago`,
  hint: "Or send to a mate: their row in Members, or tap their name in chat.",
  back: "Back",
  post: "Post",
  youGive: "You give",
  youGet: "You get",
  mateGets: "Mate gets",
  gets: (name: string) => `${name} gets`,
  most: "Most",
  /** Beside the amount: the most one trade carries here. */
  max: (amount: string) => `max ${amount}`,
  maxWhy: "One trade carries up to 10% of storage, what you have, and what fits your room after the 10%.",
  room: "room",
  full: "Full",
  /** Why Accept is off, short. */
  block: {
    traded: "You traded today",
    mateTraded: "Tomorrow",
    short: (amount: string) => `You have ${amount}`,
    overCap: (amount: string) => `Max ${amount}`,
    full: "Your storage is full",
    mateFull: (name: string) => `${name}'s storage is full`,
  },
  lostFull: (amount: string) => `${amount} lost: storage full`,
  fitWarning: (name: string, what: string, amount: string) =>
    `${name}'s ${what} storage is nearly full, so ${amount} would be lost.`,
  fit: "Fit to room",
  storage: (name: string) => `${name}'s storage`,
  yourStorage: "Your storage",
  sendTo: (name: string) => `Send to ${name}`,
  timeLeft: (time: string) => `${time} left`,
  sent: (name: string, what: string) => `Done! ${name} got ${what}.`,
  swapped: (name: string, what: string) => `Done! You got ${what} from ${name}.`,
  posted: "Request posted. Mates see it here and in chat.",
  usesSend: "Uses your 1 send today · Shiny can't be sent",
  loading: "Loading…",
  gone: "That request is no longer open.",
  pick: "Pick a resource",
};

/** The quick amounts on New request and Send. */
const QUICK = [500_000, 1_000_000] as const;

/** What the tab needs from the window. */
export interface TradeHost {
  redraw(): void;
  say(text: string | null): void;
  now(): number;
  /** After a post, cancel, accept or send: the yard's resources changed. */
  traded(): void;
}

type Amounts = Record<TradeKey, number>;
const zero = (): Amounts => ({ r1: 0, r2: 0, r3: 0, r4: 0 });

type Sheet =
  /** A new request: what is given, what is wanted, how much of each. */
  | { kind: "post"; give: TradeKey | null; want: TradeKey | null; amount: number }
  /** `amounts`: what leaves. */
  | { kind: "send"; mate: { userid: number; username: string; storage: TradeStorage | null }; picked: Set<TradeKey>; amounts: Amounts };

const button = (words: string, className: string, run: () => void, title?: string): HTMLButtonElement => {
  const node = make("button", `btn ${className}`, words);
  node.type = "button";
  if (title) node.title = title;
  node.addEventListener("click", () => run());
  return node;
};

const card = (title: string, ...children: HTMLElement[]): HTMLElement => {
  const box = make("section", "alliance-card trade-card");
  box.append(make("h3", "alliance-card__title", title), ...children);
  return box;
};

const amountsWords = (amounts: Partial<TradeAmounts>): string =>
  TRADE_KEYS.filter((key) => (amounts[key] ?? 0) > 0)
    .map((key) => `${formatShort(amounts[key])} ${resourceName(key)}`)
    .join(", ");

const words = (key: TradeKey, amount: number) => `${formatAmount(amount)} ${resourceName(key)}`;

/**
 * A swap as icons and numbers: what leaves (−1,000 Goo) → what comes
 * (+900 Twigs), from the reader's side.
 */
const swap = (out: { key: TradeKey; n: number }, back: { key: TradeKey; n: number }): HTMLElement => {
  const row = make("span", "trade-swap");
  row.setAttribute("role", "img");
  row.setAttribute("aria-label", TRADE_TEXT.swapLabel(words(out.key, out.n), words(back.key, back.n)));
  const side = (key: TradeKey, text: string, className: string) => {
    const chip = make("span", `trade-swap__side ${className}`);
    chip.dataset["key"] = key;
    chip.append(resourceIcon(key, { decorative: true }), make("span", "trade-swap__n", text));
    return chip;
  };
  row.append(
    side(out.key, `−${formatAmount(out.n)}`, "trade-swap__out"),
    make("span", "trade-swap__arrow", "→"),
    side(back.key, `+${formatAmount(back.n)}`, "trade-swap__in"),
  );
  return row;
};

/** Digits typed into an amount box, as a whole number. */
const typed = (value: string): number => {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Math.min(Number(digits), 1_000_000_000) : 0;
};

/**
 * One storage bar: what is held now, and the change (green: what lands;
 * red: what leaves).
 */
const storageBar = (label: string, storage: TradeStorage, key: TradeKey, change: number): HTMLElement => {
  const box = make("div", "trade-bar");
  const now = Math.max(0, storage.held[key]);
  const after = Math.max(0, now + change);
  const cap = Math.max(1, storage.cap);
  const pct = (value: number) => `${Math.min(100, (value / cap) * 100).toFixed(1)}%`;
  const head = make("div", "trade-bar__head");
  head.append(make("span", "trade-bar__label", label), make("span", "trade-bar__nums", `${formatShort(now)} → ${formatShort(after)} / ${formatShort(storage.cap)}`));
  const track = make("div", "trade-bar__track");
  track.setAttribute("role", "img");
  track.setAttribute("aria-label", `${label}: ${formatAmount(now)} now, ${formatAmount(after)} after, of ${formatAmount(storage.cap)}`);
  const base = make("div", "trade-bar__fill");
  base.style.width = pct(Math.min(now, after));
  const delta = make("div", change >= 0 ? "trade-bar__gain" : "trade-bar__loss");
  delta.style.left = pct(Math.min(now, after));
  delta.style.width = pct(Math.abs(after - now));
  track.append(base, delta);
  box.append(head, track);
  return box;
};

/** Why Accept is off: an icon and a few words. */
const blockLine = (block: AcceptBlock, request: TradeRequest, view: TradeView): HTMLElement => {
  const icon: GameIconName = block === "traded" || block === "mateTraded" ? "time" : block === "full" || block === "mateFull" ? "storagefull" : "lost";
  let text: string;
  switch (block) {
    case "traded":
      text = TRADE_TEXT.block.traded;
      break;
    case "mateTraded":
      text = TRADE_TEXT.block.mateTraded;
      break;
    case "short":
      text = TRADE_TEXT.block.short(formatAmount(view.me?.held[request.want] ?? 0));
      break;
    case "overCap":
      text = TRADE_TEXT.block.overCap(formatAmount(view.me && request.storage ? carryCap(view.me.cap, request.storage.cap, view.rules.capShare) : 0));
      break;
    case "full":
      text = TRADE_TEXT.block.full;
      break;
    case "mateFull":
      text = TRADE_TEXT.block.mateFull(request.username);
      break;
  }
  const line = make("span", "trade-request__why");
  line.dataset["block"] = block;
  line.append(gameIcon(icon, { size: 16, decorative: true }), make("span", "", text));
  return line;
};

export class TradeTab {
  private view: TradeView | null = null;
  private failed: string | null = null;
  private sheet: Sheet | null = null;
  private busy = false;
  /** A request to show lit (chat's Trade), until the next load. */
  private focusId: number | null = null;
  private pendingFocus: number | null = null;
  private generation = 0;
  /** When the view was loaded (Unix seconds): the new-day countdown runs from it. */
  private loadedAt = 0;
  /** The sheet's live part (swap, bars, button), redrawn as amounts are typed. */
  private live: HTMLElement | null = null;

  constructor(
    private readonly host: TradeHost,
    private readonly api: AllianceTradeApi = allianceTradeApi,
  ) {}

  /** Whether a sheet is open (the window's Back goes to the tab). */
  get sheetOpen(): boolean {
    return this.sheet !== null;
  }

  /** The current view, for a test. */
  get data(): TradeView | null {
    return this.view;
  }

  /** Loads the tab; with `to`, opens Send to that mate. */
  async load(to?: { userid: number; username: string }): Promise<void> {
    const generation = ++this.generation;
    const answer = await this.api.view(to?.userid);
    if (generation !== this.generation) return;
    if (!answer.ok) {
      this.failed = answer.message;
      this.host.redraw();
      return;
    }
    this.failed = null;
    this.view = answer.view;
    this.loadedAt = this.host.now();
    this.focusId = null;
    if (to) {
      const mate = answer.view.mate ?? { userid: to.userid, username: to.username, storage: null };
      this.sheet = { kind: "send", mate, picked: new Set(), amounts: zero() };
    }
    if (this.pendingFocus !== null) {
      const id = this.pendingFocus;
      this.pendingFocus = null;
      const open = [...answer.view.requests, ...(answer.view.myRequest ? [answer.view.myRequest] : [])].some(
        (row) => row.id === id && row.status === "open",
      );
      if (open) this.focusId = id;
      else this.host.say(TRADE_TEXT.gone);
    }
    this.host.redraw();
  }

  /** Shows the tab with one request lit (chat's Trade on a request line); loads first. */
  openRequest(requestId: number): void {
    this.sheet = null;
    this.pendingFocus = requestId;
    void this.load();
  }

  /** Opens the Send sheet to a mate (Members row, chat name). */
  openSend(userid: number, username: string): void {
    this.sheet = null;
    void this.load({ userid, username });
  }

  /** Closes any sheet. */
  closeSheet(): void {
    this.sheet = null;
    this.live = null;
    this.host.redraw();
  }

  render(): HTMLElement[] {
    if (this.failed && !this.view) return [make("p", "alliance__empty", this.failed)];
    if (!this.view) return [make("p", "alliance__empty", TRADE_TEXT.loading)];
    if (this.sheet) return [this.renderSheet(this.view, this.sheet)];
    return this.renderTab(this.view);
  }

  // -------------------------------------------------------------------------
  // The tab
  // -------------------------------------------------------------------------

  private renderTab(view: TradeView): HTMLElement[] {
    const now = this.host.now();
    const nodes: HTMLElement[] = [];

    // Today: icons and numbers.
    const today = make("div", "trade-today");
    today.setAttribute("aria-label", TRADE_TEXT.today);
    const stat = (icon: HTMLElement, value: string, label: string, off = false) => {
      const box = make("div", `trade-today__stat${off ? " is-used" : ""}`);
      box.append(icon, make("strong", "trade-today__n", value), make("span", "trade-today__w", label));
      return box;
    };
    today.append(
      stat(gameIcon("income", { size: 24, decorative: true }), String(view.today.sendsLeft), `${TRADE_TEXT.send} ${TRADE_TEXT.left}`, view.today.sendsLeft === 0),
      stat(gameIcon("gift", { size: 24, decorative: true }), String(view.today.receivesLeft), `${TRADE_TEXT.receive} ${TRADE_TEXT.left}`, view.today.receivesLeft === 0),
      stat(gameIcon("time", { size: 24, decorative: true }), formatCountdown(view.today.newDayIn - (now - this.loadedAt)).replace(/ \d+[ms]$/, ""), TRADE_TEXT.newDay),
      stat(gameIcon("lost", { size: 24, decorative: true }), TRADE_TEXT.lossShort, TRADE_TEXT.loss.replace("−10% ", "")),
    );
    nodes.push(today);

    // Your request: what you give → what you get, or New request.
    const mine = view.myRequest;
    if (mine) {
      const row = make("div", `trade-request trade-request--mine${this.focusId === mine.id ? " is-focus" : ""}`);
      row.dataset["request"] = String(mine.id);
      row.append(
        swap({ key: mine.give, n: mine.amount }, { key: mine.want, n: mine.gets }),
        make("span", "trade-request__time", TRADE_TEXT.timeLeft(formatCountdown(mine.expires_at - now).replace(/ \d+[ms]$/, ""))),
        button(TRADE_TEXT.cancel, "btn--outline trade-request__act", () => void this.cancel()),
      );
      if (!mine.ready) row.append(blockLine("mateTraded", mine, view));
      nodes.push(card(TRADE_TEXT.yourRequest, row, make("p", "trade-note trade-note--small", TRADE_TEXT.held)));
    } else {
      const traded = view.today.sendsLeft === 0 || view.today.receivesLeft === 0;
      const open = button("", "btn--primary trade-new", () => this.openPost());
      open.append(gameIcon("income", { size: 24, decorative: true }), make("span", "", TRADE_TEXT.newRequest));
      open.disabled = traded || view.today.postsLeft === 0 || !view.me || this.busy;
      const line = make("p", "trade-note", traded ? TRADE_TEXT.tradedToday : view.today.postsLeft === 0 ? TRADE_TEXT.postsUsed : TRADE_TEXT.postLine);
      const box = make("div", "trade-ask-row");
      box.append(open, line);
      nodes.push(card(TRADE_TEXT.yourRequest, box));
    }

    // Mates' requests: each with what you give, what you get, and Accept.
    const list = make("div", "trade-requests");
    list.setAttribute("role", "list");
    for (const request of view.requests) list.append(this.requestRow(view, request, now));
    if (view.requests.length === 0) list.append(make("p", "trade-note", TRADE_TEXT.noRequests));
    nodes.push(card(TRADE_TEXT.requests, list));

    // Recent trades.
    const recent = make("div", "trade-recent");
    for (const line of view.recent.slice(0, 2)) {
      const row = make("p", "trade-recent__line");
      row.append(
        make("span", "", TRADE_TEXT.gave(line.from, line.to, amountsWords(line.arrived))),
        make("span", "trade-recent__ago", ` · ${TRADE_TEXT.ago(formatCountdown(Math.max(1, now - line.at)).replace(/ \d+[ms]$/, ""))}`),
      );
      recent.append(row);
    }
    if (view.recent.length === 0) recent.append(make("p", "trade-note", TRADE_TEXT.noRecent));
    nodes.push(card(TRADE_TEXT.recent, recent));
    nodes.push(make("p", "trade-note trade-hint", TRADE_TEXT.hint));
    return nodes;
  }

  /** A mate's request from the reader's side: you give what they want, you get what they give. */
  private requestRow(view: TradeView, request: TradeRequest, now: number): HTMLElement {
    const done = request.status === "done";
    const row = make("div", `trade-request${done ? " is-done" : ""}${this.focusId === request.id ? " is-focus" : ""}`);
    row.setAttribute("role", "listitem");
    row.dataset["request"] = String(request.id);
    const who = make("div", "trade-request__who");
    who.append(make("strong", "trade-request__name", request.username));
    if (request.role && request.role !== "member") who.append(make("span", `alliance__role alliance__role--${request.role}`, request.role === "leader" ? "Leader" : "Officer"));
    row.append(who, swap({ key: request.want, n: request.amount }, { key: request.give, n: request.gets }));
    if (done) {
      row.append(make("span", "trade-request__given", TRADE_TEXT.takenBy(request.taken_by ?? "?")));
      return row;
    }
    const block = acceptBlock(request, view.me, view.today);
    // Accept shows what you get: "Accept +900 (Twigs)".
    const accept = button("", "btn--primary trade-request__act trade-accept", () => void this.accept(request));
    accept.setAttribute("aria-label", `${TRADE_TEXT.accept}: ${TRADE_TEXT.swapLabel(words(request.want, request.amount), words(request.give, request.gets))}`);
    accept.append(
      make("span", "trade-accept__word", TRADE_TEXT.accept),
      make("span", "trade-accept__n", `+${formatShort(request.gets)}`),
      resourceIcon(request.give, { decorative: true }),
    );
    accept.disabled = block !== null || this.busy;
    row.append(make("span", "trade-request__time", formatCountdown(request.expires_at - now).replace(/ \d+[ms]$/, "")), accept);
    if (block) row.append(blockLine(block, request, view));
    if (this.focusId === request.id) queueMicrotask(() => row.scrollIntoView?.({ block: "nearest" }));
    return row;
  }

  private async accept(request: TradeRequest): Promise<void> {
    await this.act(
      () => this.api.accept(request.id),
      (answer) => this.host.say(TRADE_TEXT.swapped(request.username, amountsWords(answer.done.got))),
      true,
    );
  }

  private async cancel(): Promise<void> {
    await this.act(() => this.api.cancel(), () => this.host.say(null), true);
  }

  // -------------------------------------------------------------------------
  // Sheets
  // -------------------------------------------------------------------------

  private openPost(): void {
    this.host.say(null);
    this.sheet = { kind: "post", give: null, want: null, amount: 0 };
    this.host.redraw();
  }

  private renderSheet(view: TradeView, sheet: Sheet): HTMLElement {
    const box = make("section", `trade-sheet trade-sheet--${sheet.kind}`);
    const head = make("div", "trade-sheet__head");
    const title = sheet.kind === "post" ? TRADE_TEXT.newRequest : TRADE_TEXT.sendTo(sheet.mate.username);
    head.append(button(`← ${TRADE_TEXT.back}`, "btn--outline trade-sheet__back", () => this.closeSheet()), make("h3", "trade-sheet__title", title));
    box.append(head);
    this.live = make("div", "trade-sheet__live");
    if (sheet.kind === "post") box.append(...this.postControls(view, sheet));
    if (sheet.kind === "send") box.append(...this.sendControls(view, sheet));
    box.append(this.live);
    this.fillLive();
    return box;
  }

  /** Redraws only the live part, so a box being typed in keeps its focus. */
  private fillLive(): void {
    const sheet = this.sheet;
    const view = this.view;
    if (!sheet || !view || !this.live) return;
    if (sheet.kind === "post") this.live.replaceChildren(...this.postLive(view, sheet));
    if (sheet.kind === "send") this.live.replaceChildren(...this.sendLive(view, sheet));
  }

  /** A resource tile: icon, name, a small line (free room, held). The chosen one is lit. */
  private tile(key: TradeKey, on: boolean, line: string, disabled: boolean, toggle: () => void): HTMLElement {
    const tile = make("button", `trade-tile${on ? " is-on" : ""}`);
    tile.type = "button";
    tile.disabled = disabled;
    tile.setAttribute("aria-pressed", String(on));
    tile.dataset["key"] = key;
    tile.append(resourceIcon(key, { decorative: true }), make("span", "trade-tile__name", resourceName(key)), make("span", "trade-tile__line", line));
    tile.addEventListener("click", toggle);
    return tile;
  }

  /** One amount row: quick buttons and a box. `most` caps it. */
  private amountRow(key: TradeKey, value: number, most: number, set: (n: number) => void, quick = true): HTMLElement {
    const row = make("div", "trade-amount");
    row.dataset["key"] = key;
    row.append(resourceIcon(key, { decorative: true }));
    if (quick) {
      // A quick amount bigger than one trade carries is off (lead, 11 Nov 2026).
      for (const amount of QUICK) {
        const node = button(formatShort(amount), `btn--outline trade-amount__quick${value === amount ? " is-on" : ""}`, () => {
          set(amount);
          this.host.redraw();
        });
        node.disabled = amount > most;
        if (node.disabled && most > 0) node.title = TRADE_TEXT.maxWhy;
        row.append(node);
      }
      const max = button(TRADE_TEXT.most, `btn--outline trade-amount__quick${value === most && most > 0 ? " is-on" : ""}`, () => {
        set(most);
        this.host.redraw();
      });
      max.disabled = most <= 0;
      row.append(max);
    }
    const input = make("input", "trade-amount__box");
    input.type = "text";
    input.inputMode = "numeric";
    input.value = value > 0 ? formatAmount(value) : "";
    input.placeholder = formatAmount(most);
    input.setAttribute("aria-label", resourceName(key));
    input.addEventListener("input", () => {
      set(Math.min(typed(input.value), most));
      this.fillLive();
    });
    input.addEventListener("change", () => this.host.redraw());
    row.append(input);
    if (most > 0) {
      const max = make("span", "trade-amount__max", TRADE_TEXT.max(formatShort(most)));
      max.title = TRADE_TEXT.maxWhy;
      row.append(max);
    }
    return row;
  }

  private flow(key: TradeKey, give: number, arrive: number, receiver: string, lost = 0): HTMLElement {
    const flow = make("div", "trade-flow");
    flow.dataset["key"] = key;
    const from = make("div", "trade-flow__side");
    from.append(make("span", "trade-flow__who", TRADE_TEXT.youGive), make("strong", "trade-flow__n", formatAmount(give)));
    const arrow = make("div", "trade-flow__arrow");
    arrow.append(resourceIcon(key, { decorative: true }), make("span", "trade-flow__loss", TRADE_TEXT.lossLong));
    const to = make("div", "trade-flow__side trade-flow__side--to");
    to.append(make("span", "trade-flow__who", receiver), make("strong", "trade-flow__n trade-flow__n--gain", formatAmount(arrive)));
    if (lost > 0) to.append(make("span", "trade-flow__lost", TRADE_TEXT.lostFull(formatAmount(lost))));
    flow.append(from, arrow, to);
    return flow;
  }

  private submit(label: string, enabled: boolean, run: () => void): HTMLElement {
    const node = button(label, "btn--primary trade-sheet__go", run);
    node.disabled = !enabled || this.busy;
    return node;
  }

  // New request -------------------------------------------------------------

  private postControls(view: TradeView, sheet: Extract<Sheet, { kind: "post" }>): HTMLElement[] {
    const me = view.me;
    const most = (give: TradeKey | null, want: TradeKey | null) => (me && give && want ? postCap(me, give, want) : 0);
    const settle = () => {
      const cap = most(sheet.give, sheet.want);
      if (sheet.give && sheet.want && (sheet.amount <= 0 || sheet.amount > cap)) sheet.amount = Math.min(QUICK[0], cap);
      if (!sheet.give || !sheet.want) sheet.amount = 0;
      this.host.redraw();
    };
    const group = (side: "give" | "want", label: string) => {
      const box = make("div", "trade-pick");
      box.dataset["side"] = side;
      box.append(make("span", "trade-pick__label", label));
      const tiles = make("div", "trade-tiles");
      tiles.setAttribute("role", "group");
      tiles.setAttribute("aria-label", label);
      for (const key of TRADE_KEYS) {
        const held = me ? Math.floor(me.held[key]) : 0;
        const room = me ? roomOf(me, key) : 0;
        const on = sheet[side] === key;
        const line = side === "give" ? formatShort(held) : room > 0 ? `${formatShort(room)} ${TRADE_TEXT.room}` : TRADE_TEXT.full;
        const off = !me || (side === "give" ? held <= 0 : room <= 0 || sheet.give === key);
        tiles.append(
          this.tile(key, on, line, off && !on, () => {
            sheet[side] = on ? null : key;
            if (side === "give" && sheet.want === sheet.give) sheet.want = null;
            settle();
          }),
        );
      }
      box.append(tiles);
      return box;
    };
    const nodes: HTMLElement[] = [group("give", TRADE_TEXT.youGive), group("want", TRADE_TEXT.youGet)];
    if (sheet.give && sheet.want) {
      nodes.push(this.amountRow(sheet.give, sheet.amount, most(sheet.give, sheet.want), (n) => (sheet.amount = n)));
    }
    return nodes;
  }

  private postLive(view: TradeView, sheet: Extract<Sheet, { kind: "post" }>): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    if (!sheet.give || !sheet.want) {
      nodes.push(make("p", "trade-note", TRADE_TEXT.pick));
    } else if (sheet.amount > 0) {
      const gets = arriveFor(sheet.amount, view.rules.loss);
      // You give 1,000 Twigs → you get 900 Goo; the mate gets 900 Twigs.
      const summary = make("div", "trade-post-sum");
      const mate = make("span", "trade-post-sum__mate");
      mate.append(make("span", "", TRADE_TEXT.mateGets), resourceIcon(sheet.give, { decorative: true }), make("strong", "", formatAmount(gets)));
      summary.append(swap({ key: sheet.give, n: sheet.amount }, { key: sheet.want, n: gets }), mate, make("span", "trade-flow__loss", TRADE_TEXT.lossShort));
      nodes.push(summary, make("p", "trade-note trade-note--small", TRADE_TEXT.held));
    }
    const ready = !!sheet.give && !!sheet.want && sheet.amount > 0;
    nodes.push(this.submit(TRADE_TEXT.post, ready, () => void this.post(sheet)));
    return nodes;
  }

  private async post(sheet: Extract<Sheet, { kind: "post" }>): Promise<void> {
    const { give, want, amount } = sheet;
    if (!give || !want || amount <= 0) return;
    await this.act(() => this.api.post(give, want, amount), () => this.host.say(TRADE_TEXT.posted), true);
  }

  // Send -------------------------------------------------------------------

  private sendControls(view: TradeView, sheet: Extract<Sheet, { kind: "send" }>): HTMLElement[] {
    const me = view.me;
    const theirs = sheet.mate.storage;
    const tiles = make("div", "trade-tiles");
    for (const key of TRADE_KEYS) {
      const most = me && theirs ? sendCap(me, theirs, key) : 0;
      tiles.append(
        this.tile(key, sheet.picked.has(key), me ? formatShort(me.held[key]) : "—", most <= 0, () => {
          if (sheet.picked.has(key)) {
            sheet.picked.delete(key);
            sheet.amounts[key] = 0;
          } else {
            sheet.picked.add(key);
            sheet.amounts[key] = Math.min(QUICK[0], most);
          }
          this.host.redraw();
        }),
      );
    }
    const amounts = make("div", "trade-amounts");
    for (const key of TRADE_KEYS) {
      if (!sheet.picked.has(key) || !me || !theirs) continue;
      amounts.append(this.amountRow(key, sheet.amounts[key], sendCap(me, theirs, key), (n) => (sheet.amounts[key] = n)));
    }
    return [tiles, amounts];
  }

  private sendLive(view: TradeView, sheet: Extract<Sheet, { kind: "send" }>): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    const theirs = sheet.mate.storage;
    const name = sheet.mate.username;
    const bars = make("div", "trade-bars");
    for (const key of TRADE_KEYS) {
      if (!sheet.picked.has(key)) continue;
      const sent = sheet.amounts[key];
      const land = theirs ? landing(sent, theirs, key) : { arrive: arriveFor(sent), lands: arriveFor(sent), lost: 0 };
      nodes.push(this.flow(key, sent, land.lands, TRADE_TEXT.gets(name), land.lost));
      if (land.lost > 0 && theirs) {
        const warn = make("div", "trade-warn");
        warn.append(
          make("span", "", TRADE_TEXT.fitWarning(name, resourceName(key), formatAmount(land.lost))),
          button(TRADE_TEXT.fit, "btn--outline trade-warn__fit", () => {
            sheet.amounts[key] = Math.min(sheet.amounts[key], fitToRoom(theirs, key));
            this.host.redraw();
          }),
        );
        nodes.push(warn);
      }
      if (theirs) bars.append(storageBar(TRADE_TEXT.storage(name), theirs, key, land.lands));
      if (view.me) bars.append(storageBar(TRADE_TEXT.yourStorage, view.me, key, -sent));
    }
    if (sheet.picked.size === 0) nodes.push(make("p", "trade-note", TRADE_TEXT.pick));
    nodes.push(bars, make("p", "trade-note trade-note--small", TRADE_TEXT.usesSend));
    const any = TRADE_KEYS.some((key) => sheet.amounts[key] > 0);
    nodes.push(this.submit(TRADE_TEXT.send, any && view.today.sendsLeft > 0, () => void this.send(sheet)));
    return nodes;
  }

  private async send(sheet: Extract<Sheet, { kind: "send" }>): Promise<void> {
    const amounts = nonZero(sheet.amounts);
    await this.act(
      () => this.api.send(sheet.mate.userid, amounts),
      (answer) => this.host.say(TRADE_TEXT.sent(sheet.mate.username, amountsWords(answer.done.arrived))),
      true,
    );
  }

  /** Runs a call; on success closes any sheet, reloads, and says so. */
  private async act<T extends object>(
    run: () => Promise<AllianceResult<T>>,
    done: (answer: T) => void,
    traded: boolean,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.redrawBusy();
    const answer = await run();
    this.busy = false;
    if (!answer.ok) {
      this.host.say(answer.message);
      this.redrawBusy();
      return;
    }
    this.sheet = null;
    this.live = null;
    if (traded) this.host.traded();
    await this.load();
    done(answer);
  }

  /** Busy on or off: a sheet redraws its live part (keeping a box's focus); the tab redraws. */
  private redrawBusy(): void {
    if (this.sheet) this.fillLive();
    else this.host.redraw();
  }
}
