import type { AllianceResult } from "@/api/alliance";
import {
  TRADE_KEYS,
  allianceTradeApi,
  type AllianceTradeApi,
  type TradeAmounts,
  type TradeFor,
  type TradeKey,
  type TradeRequest,
  type TradeStorage,
  type TradeView,
} from "@/api/allianceTrade";
import {
  arriveFor,
  askCap,
  fitToRoom,
  giveCheck,
  landing,
  nonZero,
  roomOf,
  sendCap,
} from "@/game/alliance/tradeRules";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { buildPictureAt } from "@/game/yard/buildButtonArt";
import { buildingName } from "@/game/yard/buildingArt";
import { formatAmount, formatCountdown, formatShort } from "@/ui/format";
import { make } from "@/ui/friends/rows";
import { gameIcon } from "@/ui/gameIcon";
import { resourceIcon, resourceName } from "@/ui/resourceIcon";

/**
 * The alliance window's Trade tab and its three sheets (design v5 §12b):
 *
 * - the tab: Today (sends / receives left, new day, −10%), your request or
 *   Ask, mates asking (Give), the last 2 trades, a hint;
 * - Ask: resource tiles with free room, amount a mate gives (500K / 1M /
 *   Most or typed), what for (one of the asker's buildings at its next level,
 *   or one of their monsters, with its picture), preview, Post;
 * - Give: who asks and for what, the flow (you give → −10% → they get),
 *   both storage bars, one Give: exactly what was asked, 1:1 (owner, 10 Nov
 *   2026); greyed with the reason when the giver is short of it;
 * - Send (a mate's row in Members, or chat): tiles, 500K / 1M / Most, the
 *   flow with what really lands, "lost: storage full" and Fit to room.
 *
 * A sheet takes the tab's place (it fills a phone). A request's amounts are
 * what a mate gives; the flow shows what arrives. The server decides everything
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
  ask: "Ask for resources",
  askLine: "Say what you need; a mate fills it.",
  askUsed: "You got a trade today. Ask again tomorrow.",
  asksUsed: "No more requests today.",
  cancel: "Cancel",
  matesAsking: "Mates asking",
  arriveNote: "Amounts are what the giver gives; −10% on the way.",
  noRequests: "No one is asking right now.",
  give: "Give",
  givenBy: (name: string) => `✓ Given by ${name}`,
  recent: "Recent trades",
  noRecent: "No trades yet.",
  gave: (from: string, to: string, what: string) => `${from} gave ${to} ${what}`,
  ago: (time: string) => `${time} ago`,
  hint: "No request? Send from a mate's row in Members, or tap their name in chat.",
  back: "Back",
  post: "Post request",
  mateGives: "A mate gives",
  youGet: "You get",
  youGive: "You give",
  gets: (name: string) => `${name} gets`,
  most: "Most",
  youHave: (amount: string) => `You have ${amount}`,
  overCap: (amount: string) => `One trade carries up to ${amount}`,
  usesSend: "Uses your 1 send today · Shiny can't be sent",
  noSendLeft: "You've sent today. New day in",
  forWhat: "For",
  forBuilding: "Building",
  forMonster: "Monster",
  forNone: "Nothing to pick.",
  upgrading: (name: string, level: number) => `${name} L${level}`,
  room: "room",
  full: "Full",
  lostFull: (amount: string) => `${amount} lost: storage full`,
  fitWarning: (name: string, what: string, amount: string) =>
    `${name}'s ${what} storage is nearly full, so ${amount} would be lost.`,
  fit: "Fit to room",
  storage: (name: string) => `${name}'s storage`,
  yourStorage: "Your storage",
  sendTo: (name: string) => `Send to ${name}`,
  giveTo: (name: string) => `Give to ${name}`,
  asks: (name: string) => `${name} asks`,
  timeLeft: (time: string) => `${time} left`,
  sent: (name: string, what: string) => `Done! ${name} got ${what}.`,
  posted: "Request posted. Mates see it here and in chat.",
  loading: "Loading…",
  gone: "That request is no longer open.",
  pick: "Pick a resource",
};

/** "Town Hall L7" / "Bandito". */
export const tradeForName = (value: TradeFor): string =>
  value.kind === "building"
    ? TRADE_TEXT.upgrading(buildingName(value.type) ?? `#${value.type}`, value.level)
    : (monsterEntry(value.id)?.name ?? value.id);

/** The building's picture or the monster's portrait, small. */
const forPicture = (value: TradeFor, className: string): HTMLImageElement => {
  const image = make("img", className);
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  if (value.kind === "building") image.src = buildPictureAt(value.type, value.level);
  else showPortrait(image, monsterPortrait(value.id, "icon"));
  return image;
};

const sameFor = (a: TradeFor | null, b: TradeFor | null): boolean =>
  !!a && !!b && (a.kind === "building" && b.kind === "building" ? a.type === b.type && a.level === b.level : a.kind === "monster" && b.kind === "monster" && a.id === b.id);

/** The quick amounts on Ask and Send. */
const QUICK = [500_000, 1_000_000] as const;

/** What the tab needs from the window. */
export interface TradeHost {
  redraw(): void;
  say(text: string | null): void;
  now(): number;
  /** After a give or send: the yard's resources changed. */
  traded(): void;
}

type Amounts = Record<TradeKey, number>;
const zero = (): Amounts => ({ r1: 0, r2: 0, r3: 0, r4: 0 });

type Sheet =
  /** `amounts`: what a mate gives. `forTab`: which picker shows. */
  | { kind: "ask"; picked: Set<TradeKey>; amounts: Amounts; forWhat: TradeFor | null; forTab: "building" | "monster" }
  /** Gives exactly `request.amounts`. */
  | { kind: "give"; request: TradeRequest }
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

/** "2.0M Goo, 500K Twigs" as icons and short numbers. */
const chips = (amounts: Partial<TradeAmounts>): HTMLElement => {
  const row = make("span", "trade-chips");
  for (const key of TRADE_KEYS) {
    const value = amounts[key] ?? 0;
    if (value <= 0) continue;
    const chip = make("span", "trade-chip");
    chip.title = `${formatAmount(value)} ${resourceName(key)}`;
    chip.append(resourceIcon(key, { tooltip: false }), make("span", "trade-chip__n", formatShort(value)));
    row.append(chip);
  }
  return row;
};

const amountsWords = (amounts: Partial<TradeAmounts>): string =>
  TRADE_KEYS.filter((key) => (amounts[key] ?? 0) > 0)
    .map((key) => `${formatShort(amounts[key])} ${resourceName(key)}`)
    .join(", ");

/** Digits typed into an amount box, as a whole number. */
const typed = (value: string): number => {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Math.min(Number(digits), 1_000_000_000) : 0;
};

/**
 * One storage bar: what is held now, and the change (green: what lands;
 * red: what leaves). `lost` adds a red note.
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

export class TradeTab {
  private view: TradeView | null = null;
  private failed: string | null = null;
  private sheet: Sheet | null = null;
  private busy = false;
  private pendingGive: number | null = null;
  private generation = 0;
  /** When the view was loaded (Unix seconds): the new-day countdown runs from it. */
  private loadedAt = 0;
  /** The sheet's live part (flow, bars, button), redrawn as amounts are typed. */
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
    if (to) {
      const mate = answer.view.mate ?? { userid: to.userid, username: to.username, storage: null };
      this.sheet = { kind: "send", mate, picked: new Set(), amounts: zero() };
    }
    if (this.pendingGive !== null) {
      const request = answer.view.requests.find((row) => row.id === this.pendingGive && row.status === "open");
      this.pendingGive = null;
      if (request) this.openGiveSheet(request);
      else this.host.say(TRADE_TEXT.gone);
    }
    this.host.redraw();
  }

  /** Opens the Give sheet on a request (chat's Give); loads first. */
  openGive(requestId: number): void {
    this.sheet = null;
    this.pendingGive = requestId;
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
    const stat = (icon: HTMLElement, value: string, words: string, off = false) => {
      const box = make("div", `trade-today__stat${off ? " is-used" : ""}`);
      box.append(icon, make("strong", "trade-today__n", value), make("span", "trade-today__w", words));
      return box;
    };
    today.append(
      stat(gameIcon("income", { size: 24, decorative: true }), String(view.today.sendsLeft), `${TRADE_TEXT.send} ${TRADE_TEXT.left}`, view.today.sendsLeft === 0),
      stat(gameIcon("gift", { size: 24, decorative: true }), String(view.today.receivesLeft), `${TRADE_TEXT.receive} ${TRADE_TEXT.left}`, view.today.receivesLeft === 0),
      stat(gameIcon("time", { size: 24, decorative: true }), formatCountdown(view.today.newDayIn - (now - this.loadedAt)).replace(/ \d+[ms]$/, ""), TRADE_TEXT.newDay),
      stat(gameIcon("lost", { size: 24, decorative: true }), TRADE_TEXT.lossShort, TRADE_TEXT.loss.replace("−10% ", "")),
    );
    nodes.push(today);

    // Your request.
    const mine = view.myRequest;
    if (mine) {
      const row = make("div", "trade-request trade-request--mine");
      row.append(
        chips(mine.amounts),
        this.forTag(mine.for),
        make("span", "trade-request__time", TRADE_TEXT.timeLeft(formatCountdown(mine.expires_at - now))),
        button(TRADE_TEXT.cancel, "btn--outline trade-request__act", () => void this.cancel()),
      );
      nodes.push(card(TRADE_TEXT.yourRequest, row));
    } else {
      const canAsk = view.today.receivesLeft > 0 && view.today.asksLeft > 0;
      const ask = button(TRADE_TEXT.ask, "btn--primary trade-ask", () => this.openAsk());
      ask.disabled = !canAsk || !view.me;
      const line = make(
        "p",
        "trade-note",
        view.today.receivesLeft === 0 ? TRADE_TEXT.askUsed : view.today.asksLeft === 0 ? TRADE_TEXT.asksUsed : TRADE_TEXT.askLine,
      );
      const box = make("div", "trade-ask-row");
      box.append(ask, line);
      nodes.push(card(TRADE_TEXT.yourRequest, box));
    }

    // Mates asking.
    const list = make("div", "trade-requests");
    list.setAttribute("role", "list");
    for (const request of view.requests) list.append(this.requestRow(view, request, now));
    if (view.requests.length === 0) list.append(make("p", "trade-note", TRADE_TEXT.noRequests));
    nodes.push(card(TRADE_TEXT.matesAsking, list, make("p", "trade-note trade-note--small", TRADE_TEXT.arriveNote)));

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

  /** What the request is for: the building's picture or monster's portrait, and its name. */
  private forTag(value: TradeFor | null): HTMLElement {
    const tag = make("span", "trade-for");
    if (!value) return tag;
    const name = tradeForName(value);
    tag.title = name;
    if (value.kind === "building") tag.append(gameIcon("levelup", { size: 16, decorative: true }));
    tag.append(forPicture(value, "trade-for__pic"), make("span", "trade-for__name", name));
    return tag;
  }

  private requestRow(view: TradeView, request: TradeRequest, now: number): HTMLElement {
    const given = request.status === "given";
    const row = make("div", `trade-request${given ? " is-given" : ""}`);
    row.setAttribute("role", "listitem");
    row.dataset["request"] = String(request.id);
    const who = make("div", "trade-request__who");
    who.append(make("strong", "trade-request__name", request.username));
    if (request.role && request.role !== "member") who.append(make("span", `alliance__role alliance__role--${request.role}`, request.role === "leader" ? "Leader" : "Officer"));
    const what = make("div", "trade-request__what");
    what.append(chips(request.amounts), this.forTag(request.for));
    row.append(who, what);
    if (given) {
      row.append(make("span", "trade-request__given", TRADE_TEXT.givenBy(request.given_by ?? "?")));
    } else {
      const give = button(TRADE_TEXT.give, "btn--primary trade-request__act", () => this.openGiveSheet(request));
      give.disabled = view.today.sendsLeft === 0 || !view.me;
      if (view.today.sendsLeft === 0) give.title = `${TRADE_TEXT.noSendLeft} ${formatCountdown(view.today.newDayIn)}`;
      row.append(make("span", "trade-request__time", formatCountdown(request.expires_at - now).replace(/ \d+[ms]$/, "")), give);
    }
    return row;
  }

  // -------------------------------------------------------------------------
  // Sheets
  // -------------------------------------------------------------------------

  private openAsk(): void {
    this.host.say(null);
    this.sheet = { kind: "ask", picked: new Set(), amounts: zero(), forWhat: null, forTab: "building" };
    this.host.redraw();
  }

  private openGiveSheet(request: TradeRequest): void {
    this.host.say(null);
    this.sheet = { kind: "give", request };
    this.host.redraw();
  }

  private renderSheet(view: TradeView, sheet: Sheet): HTMLElement {
    const box = make("section", `trade-sheet trade-sheet--${sheet.kind}`);
    const head = make("div", "trade-sheet__head");
    const title =
      sheet.kind === "ask" ? TRADE_TEXT.ask : sheet.kind === "give" ? TRADE_TEXT.giveTo(sheet.request.username) : TRADE_TEXT.sendTo(sheet.mate.username);
    head.append(button(`← ${TRADE_TEXT.back}`, "btn--outline trade-sheet__back", () => this.closeSheet()), make("h3", "trade-sheet__title", title));
    box.append(head);
    this.live = make("div", "trade-sheet__live");
    if (sheet.kind === "ask") box.append(...this.askControls(view, sheet));
    if (sheet.kind === "give") box.append(...this.giveControls(view, sheet));
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
    if (sheet.kind === "ask") this.live.replaceChildren(...this.askLive(view, sheet));
    if (sheet.kind === "give") this.live.replaceChildren(...this.giveLive(view, sheet));
    if (sheet.kind === "send") this.live.replaceChildren(...this.sendLive(view, sheet));
  }

  /** A resource tile: icon, name, a small line (free room, held). */
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
      for (const amount of QUICK) {
        const node = button(formatShort(amount), `btn--outline trade-amount__quick${value === Math.min(amount, most) ? " is-on" : ""}`, () => {
          set(Math.min(amount, most));
          this.host.redraw();
        });
        node.disabled = most <= 0;
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
    return row;
  }

  private flow(key: TradeKey, give: number, arrive: number, receiver: string, lost = 0): HTMLElement {
    const flow = make("div", "trade-flow");
    flow.dataset["key"] = key;
    const from = make("div", "trade-flow__side");
    from.append(make("span", "trade-flow__who", receiver === TRADE_TEXT.youGet ? TRADE_TEXT.mateGives : TRADE_TEXT.youGive), make("strong", "trade-flow__n", formatAmount(give)));
    const arrow = make("div", "trade-flow__arrow");
    arrow.append(resourceIcon(key, { decorative: true }), make("span", "trade-flow__loss", TRADE_TEXT.lossLong));
    const to = make("div", "trade-flow__side trade-flow__side--to");
    to.append(make("span", "trade-flow__who", receiver), make("strong", "trade-flow__n trade-flow__n--gain", formatAmount(arrive)));
    if (lost > 0) to.append(make("span", "trade-flow__lost", TRADE_TEXT.lostFull(formatAmount(lost))));
    flow.append(from, arrow, to);
    return flow;
  }

  private submit(words: string, enabled: boolean, run: () => void): HTMLElement {
    const node = button(words, "btn--primary trade-sheet__go", run);
    node.disabled = !enabled || this.busy;
    return node;
  }

  // Ask --------------------------------------------------------------------

  private askControls(view: TradeView, sheet: Extract<Sheet, { kind: "ask" }>): HTMLElement[] {
    const me = view.me;
    const tiles = make("div", "trade-tiles");
    for (const key of TRADE_KEYS) {
      const most = me ? askCap(me, key) : 0;
      tiles.append(
        this.tile(key, sheet.picked.has(key), most > 0 ? `${formatShort(roomOf(me!, key))} ${TRADE_TEXT.room}` : TRADE_TEXT.full, most <= 0, () => {
          if (sheet.picked.has(key)) {
            sheet.picked.delete(key);
            sheet.amounts[key] = 0;
          } else {
            sheet.picked.add(key);
            sheet.amounts[key] = Math.min(QUICK[1], most);
          }
          this.host.redraw();
        }),
      );
    }
    const amounts = make("div", "trade-amounts");
    for (const key of TRADE_KEYS) {
      if (!sheet.picked.has(key) || !me) continue;
      amounts.append(this.amountRow(key, sheet.amounts[key], askCap(me, key), (n) => (sheet.amounts[key] = n)));
    }
    return [tiles, amounts, this.forPicker(view, sheet)];
  }

  /**
   * "For": Building / Monster, then the player's own: each building type at
   * its next level ("Town Hall L7") or each unlocked monster, as pictures.
   * Optional; tapping the chosen one again clears it.
   */
  private forPicker(view: TradeView, sheet: Extract<Sheet, { kind: "ask" }>): HTMLElement {
    const box = make("div", "trade-for-pick");
    const head = make("div", "trade-for-pick__head");
    head.append(make("span", "trade-for-pick__label", TRADE_TEXT.forWhat));
    for (const [tab, words, icon] of [
      ["building", TRADE_TEXT.forBuilding, "levelup"],
      ["monster", TRADE_TEXT.forMonster, "housing"],
    ] as const) {
      const on = sheet.forTab === tab;
      const node = make("button", `btn btn--outline trade-for-pick__tab${on ? " is-on" : ""}`);
      node.type = "button";
      node.setAttribute("aria-pressed", String(on));
      node.append(gameIcon(icon, { size: 16, decorative: true }), make("span", "", words));
      node.addEventListener("click", () => {
        sheet.forTab = tab;
        this.host.redraw();
      });
      head.append(node);
    }
    if (sheet.forWhat) head.append(this.forTag(sheet.forWhat));
    const grid = make("div", "trade-for-pick__grid");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", TRADE_TEXT.forWhat);
    const choices = view.choices ?? { buildings: [], monsters: [] };
    const options: TradeFor[] =
      sheet.forTab === "building"
        ? choices.buildings.map((b) => ({ kind: "building", type: b.type, level: b.level }))
        : choices.monsters.map((id) => ({ kind: "monster", id }));
    for (const option of options) {
      const on = sameFor(sheet.forWhat, option);
      const name = tradeForName(option);
      const node = make("button", `trade-for-pick__item${on ? " is-on" : ""}`);
      node.type = "button";
      node.title = name;
      node.setAttribute("role", "radio");
      node.setAttribute("aria-checked", String(on));
      node.setAttribute("aria-label", name);
      node.append(forPicture(option, "trade-for-pick__pic"));
      if (option.kind === "building") node.append(make("span", "trade-for-pick__lv", `L${option.level}`));
      node.addEventListener("click", () => {
        sheet.forWhat = on ? null : option;
        this.host.redraw();
      });
      grid.append(node);
    }
    if (options.length === 0) grid.append(make("p", "trade-note", TRADE_TEXT.forNone));
    box.append(head, grid);
    return box;
  }

  private askLive(_view: TradeView, sheet: Extract<Sheet, { kind: "ask" }>): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    for (const key of TRADE_KEYS) {
      if (!sheet.picked.has(key) || sheet.amounts[key] <= 0) continue;
      nodes.push(this.flow(key, sheet.amounts[key], arriveFor(sheet.amounts[key]), TRADE_TEXT.youGet));
    }
    if (sheet.picked.size === 0) nodes.push(make("p", "trade-note", TRADE_TEXT.pick));
    const any = TRADE_KEYS.some((key) => sheet.amounts[key] > 0);
    nodes.push(this.submit(TRADE_TEXT.post, any, () => void this.postAsk(sheet)));
    return nodes;
  }

  private async postAsk(sheet: Extract<Sheet, { kind: "ask" }>): Promise<void> {
    await this.act(() => this.api.ask(nonZero(sheet.amounts), sheet.forWhat), () => this.host.say(TRADE_TEXT.posted), false);
  }

  private async cancel(): Promise<void> {
    await this.act(() => this.api.cancel(), () => this.host.say(null), false);
  }

  // Give -------------------------------------------------------------------

  private giveControls(view: TradeView, sheet: Extract<Sheet, { kind: "give" }>): HTMLElement[] {
    const now = this.host.now();
    const request = sheet.request;
    const who = make("div", "trade-sheet__who");
    who.append(
      make("strong", "", TRADE_TEXT.asks(request.username)),
      chips(request.amounts),
      this.forTag(request.for),
      make("span", "trade-request__time", TRADE_TEXT.timeLeft(formatCountdown(request.expires_at - now).replace(/ \d+[ms]$/, ""))),
    );
    const nodes: HTMLElement[] = [who];
    // 1:1 or not at all: say what stops it, with the number.
    const check = giveCheck(request.amounts, view.me, request.storage);
    for (const key of check.short) {
      const warn = make("p", "trade-warn");
      warn.append(resourceIcon(key, { decorative: true }), make("span", "", TRADE_TEXT.youHave(formatAmount(view.me?.held[key] ?? 0))));
      nodes.push(warn);
    }
    if (check.overCap.length > 0 && view.me && request.storage) {
      const cap = Math.floor(Math.min(view.me.cap, request.storage.cap) * view.rules.capShare);
      nodes.push(make("p", "trade-warn", TRADE_TEXT.overCap(formatAmount(cap))));
    }
    return nodes;
  }

  private giveLive(view: TradeView, sheet: Extract<Sheet, { kind: "give" }>): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    const request = sheet.request;
    const bars = make("div", "trade-bars");
    for (const key of TRADE_KEYS) {
      const give = request.amounts[key] ?? 0;
      if (give <= 0) continue;
      const land = request.storage ? landing(give, request.storage, key) : { arrive: arriveFor(give), lands: arriveFor(give), lost: 0 };
      nodes.push(this.flow(key, give, land.lands, TRADE_TEXT.gets(request.username), land.lost));
      if (request.storage) bars.append(storageBar(TRADE_TEXT.storage(request.username), request.storage, key, land.lands));
      if (view.me) bars.append(storageBar(TRADE_TEXT.yourStorage, view.me, key, -give));
    }
    nodes.push(bars, make("p", "trade-note trade-note--small", TRADE_TEXT.usesSend));
    const check = giveCheck(request.amounts, view.me, request.storage);
    const can = check.short.length === 0 && check.overCap.length === 0 && view.today.sendsLeft > 0;
    nodes.push(this.submit(TRADE_TEXT.give, can, () => void this.give(sheet)));
    return nodes;
  }

  private async give(sheet: Extract<Sheet, { kind: "give" }>): Promise<void> {
    await this.act(
      () => this.api.give(sheet.request.id),
      (answer) => this.host.say(TRADE_TEXT.sent(sheet.request.username, amountsWords(answer.done.arrived))),
      true,
    );
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

  /** Runs a call; on success closes the sheet, reloads, and says so. */
  private async act<T extends object>(
    run: () => Promise<AllianceResult<T>>,
    done: (answer: T) => void,
    traded: boolean,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.fillLive();
    const answer = await run();
    this.busy = false;
    if (!answer.ok) {
      this.host.say(answer.message);
      this.fillLive();
      return;
    }
    this.sheet = null;
    this.live = null;
    if (traded) this.host.traded();
    await this.load();
    done(answer);
  }
}
