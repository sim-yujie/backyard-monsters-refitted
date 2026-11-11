import { getSession } from "@/api/auth";
import {
  ALLIANCE_TYPES,
  JOIN_MODES,
  allianceApi,
  type AdForm,
  type AllianceApi,
  type AllianceInviteRow,
  type AllianceListing,
  type AllianceMember,
  type AllianceResult,
  type AllianceRefusal,
  type AllianceType,
  type JoinMode,
  type MyAlliance,
} from "@/api/alliance";
import { friendsApi, SEARCH_MIN_LENGTH, type FriendsApi, type PlayerResult } from "@/api/friends";
import { avatarOf, avatarUrl } from "@/game/avatars";
import {
  ALLIANCE_DESC_MAX,
  ALLIANCE_NAME_MAX,
  browserTimeZone,
  canEdit,
  canInvite,
  descriptionProblem,
  gateStep,
  gmtLabel,
  joinModeOf,
  memberActions,
  membersLine,
  nameProblem,
  officerCount,
  orderMembers,
  pageCount,
  quickJoinPick,
  refusalText,
  renameWait,
  ROLE_WORD,
  SHIELD_COUNT,
  shieldUrl,
  shownMinLevel,
  stepMinLevel,
  stepTimeZone,
  switchSummary,
  TYPE_INFO,
  type MemberAction,
} from "@/game/alliance/allianceRules";
import type { AllianceFocus, AllianceTab } from "@/game/alliance/allianceView";
import { playerPool } from "@/game/friends/friendsView";
import type { AllianceTradeApi } from "@/api/allianceTrade";
import { TradeTab } from "./allianceTradeUi";
import { worldChat, type ChatSession } from "@/game/chat/chatSession";
import { formatAmount, formatCountdown } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import {
  allianceProgressApi,
  type AllianceProgressApi,
  type NewsLine,
  type TerritoryRow,
} from "@/api/allianceProgress";
import {
  constellationTab,
  goalsCard,
  helpersCard,
  newsCard,
  statTiles,
  territoryTab,
  todayCard,
  type ProgressHost,
} from "./allianceProgressUi";
import { onlineDot } from "@/ui/onlineDot";
import { Popup } from "@/ui/Popup";
import { StarEditor } from "@/ui/alliance/StarEditor";
import { make } from "@/ui/friends/rows";
import { CountryPicker } from "@/ui/CountryPicker";
import { countryFlagImage } from "@/ui/countryFlag";
import { countryName } from "@/game/account/countries";
import "./alliance.css";

/**
 * The alliance window (beta 7 phase 1, design v5 §7): a {@link Popup}, so it
 * wears the game's own window in both looks (steel in Modern, Flash's
 * parchment in Classic, `skin.css`).
 *
 * - **No alliance: the marketplace.** The alliances of the player's world in
 *   the server's order (room first, then the most active), a search, Quick
 *   Join by type (asks the first alliance of that type with room), Ask to
 *   join and Report on each, and Create. With none yet: "No alliances in your
 *   world yet. Be the first." Invites waiting show above with Accept and
 *   Decline. A refusal says why in the server's words and, for the join gate,
 *   what to do (build the Observatory, open the map).
 * - **Create:** name, one of Flash's 41 shields, a line about it, and three
 *   type cards that lead with "Up to 15 / 30 / 60 members".
 * - **A member: My alliance.** Overview (shield, name, type, members, the
 *   advert; Edit for the Leader and Officers; Rename, Change type for the
 *   Leader; Take over when the server offers it) and Members (ranks, and the
 *   buttons the viewer's rank allows; join requests and Invite for the Leader
 *   and Officers; Leave at the foot).
 *
 * Phase 2 adds a Chat tab: {@link AllianceWindow.TABS} and `renderTab`.
 */

export const ALLIANCE_TEXT = {
  title: "Alliance",
  marketTitle: "Alliances in your world",
  create: "Create",
  createTitle: "Create an alliance",
  quickJoin: "Quick Join",
  quickJoinTitle: "Join the most active Open alliance of this type with room",
  anyType: "Any",
  join: "Join",
  ask: "Ask to join",
  asked: "Asked",
  full: "Full",
  report: "Report",
  reported: "Reported",
  search: "Search",
  searchPlaceholder: "Alliance name",
  empty: "No alliances in your world yet. Be the first.",
  noMatch: "No alliance has that name.",
  leader: (name: string): string => `Leader: ${name}`,
  askedNote: (name: string): string => `Asked to join ${name}. Its Leader or an Officer will answer.`,
  quickNone: "No Open alliance of that type has room. Try Any.",
  /** The joining modes (design v5 §7a): the chip's word and its longer title. */
  joinMode: { open: "Open", ask: "Ask", invite: "Invite only" } as Readonly<Record<JoinMode, string>>,
  joinModeTitle: {
    open: "Open: anyone joins at once",
    ask: "Ask to join: the Leader or an Officer answers",
    invite: "Invite only: no asks",
  } as Readonly<Record<JoinMode, string>>,
  joining: "Joining",
  language: "Language",
  anyLanguage: "Any",
  timeZone: "Time zone",
  minLevel: "Min level",
  minLevelTitle: (level: number): string => `Players from level ${level}`,
  anyLevel: "Any",
  filters: "Filters",
  openOnly: "Open",
  openOnlyTitle: "Only alliances you can join at once",
  myLanguageTitle: (name: string): string => `Only alliances in ${name}`,
  clear: "Clear",
  rejoinWait: (left: string): string => `You can join an alliance again in ${left}.`,
  invites: "Invites",
  invitedBy: (who: string): string => `From ${who}`,
  accept: "Accept",
  decline: "Decline",
  name: "Name",
  shield: "Shield",
  description: "About",
  descriptionPlaceholder: "One line players see in the list",
  typeIntro: "The type sets how many members can join.",
  typeLater: "Growing into a bigger type later is free.",
  officers: (count: number): string => `${count} Officers`,
  back: "Back",
  overview: "Overview",
  members: "Members",
  tabs: { overview: "Overview", constellation: "Constellation", members: "Members", trade: "Trade", territory: "Territory" } as Readonly<
    Record<AllianceTab, string>
  >,
  membersCount: (count: number, limit: number): string => `${formatAmount(count)} / ${formatAmount(limit)} members`,
  online: (count: number): string => `${formatAmount(count)} online`,
  points: "Alliance points",
  /** A mate's row: send them resources (the Trade tab's Send sheet). */
  send: "Send",
  /** The short word under each Overview tile's number. */
  tileCaption: { members: "members", online: "online now", points: "points" },
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  rename: "Rename",
  mustRename: "Pick a new name for your alliance.",
  changeType: "Change type",
  switchTo: "Switch",
  takeOver: "Take over leadership",
  takeOverNote: "Your Leader has been away a week. You can lead now.",
  leave: "Leave alliance",
  leaveConfirm: "Leave? You wait 24 h before joining another.",
  yes: "Yes",
  no: "No",
  invite: "Invite",
  inviteTitle: "Invite a player",
  invitePlaceholder: "Player name",
  invited: "Invited",
  inviteSent: (name: string): string => `Invite sent to ${name} by mail.`,
  suggested: "Players without an alliance",
  requests: "Asking to join",
  action: {
    promote: "Make Officer",
    demote: "Make Member",
    handOver: "Make Leader",
    kick: "Kick",
    invite: "Invite",
  } satisfies Record<MemberAction, string>,
  confirm: {
    promote: (name: string): string => `Make ${name} an Officer?`,
    demote: (name: string): string => `Make ${name} a Member?`,
    handOver: (name: string): string => `Hand the alliance to ${name}? You become an Officer.`,
    kick: (name: string): string => `Kick ${name}?`,
    invite: (name: string): string => `Invite ${name}?`,
  } satisfies Record<MemberAction, (name: string) => string>,
  buildObservatory: "Build Observatory",
  openMap: "Open map",
  loading: "Loading…",
  loadFailed: "Could not load your alliance.",
  retry: "Try again",
  prev: "‹",
  next: "›",
  page: (page: number, pages: number): string => `${page} / ${pages}`,
  level: (level: number): string => `Lv ${level}`,
} as const;

const QUICK_KEY = "bymr.allianceQuickType";

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const savedQuickType = (): AllianceType | "any" => {
  try {
    const saved = storage()?.getItem(QUICK_KEY);
    return saved === "any" || ALLIANCE_TYPES.includes(saved as AllianceType) ? (saved as AllianceType | "any") : "midas";
  } catch {
    return "midas";
  }
};

const saveQuickType = (type: AllianceType | "any"): void => {
  try {
    storage()?.setItem(QUICK_KEY, type);
  } catch {
    // A private window: the pick is just not remembered.
  }
};

export interface AllianceWindowOptions {
  readonly api?: AllianceApi;
  /** Points, goals, stars, territory and news (phase 2); the game's own unless a test swaps it. */
  readonly progressApi?: AllianceProgressApi;
  /** The player search Invite uses. */
  readonly players?: Pick<FriendsApi, "search">;
  /** The player's own id; the session's by default. */
  readonly myId?: () => number | null;
  /** Unix seconds now, for a test. */
  readonly now?: () => number;
  /** The tab a member's window opens on. */
  readonly tab?: AllianceTab;
  /** On the Trade tab: open Give on a request, or Send to a mate. */
  readonly focus?: AllianceFocus;
  /** The trade routes; the game's own unless a test swaps them. */
  readonly tradeApi?: AllianceTradeApi;
  /** Opens the build menu on the Observatory (the join gate's next step). Without it, no button. */
  readonly onBuildObservatory?: () => void;
  /** Opens the map (Map Room 2's next step). Without it, no button. */
  readonly onOpenMap?: () => void;
  /** The player joined, founded, left or lost an alliance: the scene refreshes what shows it. */
  readonly onChanged?: () => void;
  /** World chat, whose Alliance room follows what this window learns; the game's own unless a test swaps it. */
  readonly chat?: Pick<ChatSession, "setAllianceRoom">;
  readonly onClose?: () => void;
}

type View =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "market" }
  | { readonly kind: "create" }
  | { readonly kind: "mine"; readonly alliance: MyAlliance };

/** A button with words, of the window's kit. */
const button = (words: string, className: string, run: () => void, title?: string): HTMLButtonElement => {
  const node = make("button", `btn ${className}`, words);
  node.type = "button";
  if (title) node.title = title;
  node.addEventListener("click", () => run());
  return node;
};

const shieldImage = (image: number, size: "medium" | "small", className: string): HTMLImageElement => {
  const img = make("img", className);
  img.src = shieldUrl(image, size);
  img.alt = "";
  img.decoding = "async";
  return img;
};

/** "[faces] 9 / 15": members against the limit, the painted friends icon and numbers. */
const membersBadge = (count: number, limit: number): HTMLElement => {
  const badge = make("span", "alliance__members");
  badge.title = ALLIANCE_TEXT.membersCount(count, limit);
  badge.setAttribute("aria-label", ALLIANCE_TEXT.membersCount(count, limit));
  badge.append(
    gameIcon("friends", { size: 16, decorative: true }),
    make("span", "alliance__members-count", `${formatAmount(count)}/${formatAmount(limit)}`),
  );
  return badge;
};

/** Each joining mode's painted icon. */
const JOIN_ICON: Readonly<Record<JoinMode, GameIconName>> = { open: "addfriend", ask: "mail", invite: "shield" };

/** The ad's editable part, as the Create and Edit forms hold it. */
type AdDraft = { -readonly [K in keyof AdForm]: AdForm[K] };

/** The ad's settings in one line of icons and numbers: mode, flag, GMT band, minimum level. */
const adLine = (ad: Partial<AdForm>): HTMLElement => {
  const line = make("span", "alliance__ad");
  const mode = joinModeOf(ad);
  const modeNode = make("span", `alliance__ad-item alliance__ad-mode alliance__ad-mode--${mode}`);
  modeNode.title = ALLIANCE_TEXT.joinModeTitle[mode];
  modeNode.setAttribute("aria-label", ALLIANCE_TEXT.joinModeTitle[mode]);
  modeNode.append(gameIcon(JOIN_ICON[mode], { size: 16, decorative: true }), make("span", "", ALLIANCE_TEXT.joinMode[mode]));
  line.append(modeNode);
  if (ad.language) {
    const flag = make("span", "alliance__ad-item alliance__ad-flag");
    flag.title = countryName(ad.language);
    flag.append(countryFlagImage(ad.language));
    line.append(flag);
  }
  if (ad.time_zone !== null && ad.time_zone !== undefined) {
    const zone = make("span", "alliance__ad-item alliance__ad-zone");
    zone.append(gameIcon("time", { size: 16, decorative: true }), make("span", "", gmtLabel(ad.time_zone)));
    line.append(zone);
  }
  const level = shownMinLevel(ad);
  if (level !== null) {
    const node = make("span", "alliance__ad-item alliance__ad-level");
    node.title = ALLIANCE_TEXT.minLevelTitle(level);
    node.setAttribute("aria-label", ALLIANCE_TEXT.minLevelTitle(level));
    node.append(gameIcon("levelup", { size: 16, decorative: true }), make("span", "", `${level}+`));
    line.append(node);
  }
  return line;
};

const typeBadge = (type: AllianceType): HTMLElement =>
  make("span", `alliance__type alliance__type--${type}`, TYPE_INFO[type]?.label ?? type);

export class AllianceWindow {
  /** The member tabs, in order (design v5 §7b). */
  static readonly TABS: readonly AllianceTab[] = ["overview", "constellation", "members", "trade", "territory"];

  /** Each tab's painted icon; on a phone the tabs show only it. */
  static readonly TAB_ICONS: Readonly<Record<AllianceTab, GameIconName>> = {
    overview: "alliance",
    constellation: "empire",
    members: "friends",
    trade: "income",
    territory: "pin",
  };

  readonly popup: Popup;

  /** The Trade tab (design v5 §12b), which keeps its own data and sheets. */
  private readonly trade: TradeTab;
  /** Where the Trade tab opens on its first load (chat's Give, a Send). */
  private focus: AllianceFocus | null;

  private readonly options: AllianceWindowOptions;
  private readonly api: AllianceApi;
  private readonly progressApi: AllianceProgressApi;
  private readonly players: Pick<FriendsApi, "search">;
  private readonly status = make("p", "alliance__status");
  private readonly foot = make("div", "alliance__foot");
  private view: View = { kind: "loading" };
  private tab: AllianceTab;
  private destroyed = false;
  /** Bumped by every load, so an answer that arrives late is dropped. */
  private generation = 0;

  // Marketplace.
  private listings: readonly AllianceListing[] = [];
  private total = 0;
  private pageSize = 10;
  private page = 0;
  private search = "";
  private quickType: AllianceType | "any" = savedQuickType();
  private opened: number | null = null;
  private readonly asked = new Set<number>();
  private readonly reported = new Set<number>();
  private rejoinAt: number | null = null;
  private inbox: readonly AllianceInviteRow[] = [];
  /** The marketplace filters (design v5 §7a); the server narrows the list. */
  private filters: { type: AllianceType | null; language: string | null; open: boolean } = { type: null, language: null, open: false };
  /** The player's chat country, from the last search: Quick Join and the language filter use it. */
  private myCountry: string | null = null;

  // Create form, kept while the player goes Back and forth. A new alliance starts Open.
  private draft = AllianceWindow.newDraft();
  /** The Edit form's ad while it is open. */
  private advertAd: AdDraft | null = null;

  // My alliance.
  private members: readonly AllianceMember[] = [];
  private openMember: number | null = null;
  private confirming: { readonly userid: number; readonly action: MemberAction } | null = null;
  private editing: "advert" | "rename" | "type" | null = null;
  private leaving = false;
  private found: readonly PlayerResult[] = [];
  private suggested: readonly AllianceMember[] = [];
  private invitedIds = new Set<number>();

  // Phase 2: goals, stars, territory, news.
  private chosenStar: string | null = null;
  /** Where the window was mounted: the star editor opens over it there. */
  private container: HTMLElement | null = null;
  private addingGoal = false;
  private territoryType: AllianceType | null = null;
  private territoryRows: readonly TerritoryRow[] | null = null;
  private news: readonly NewsLine[] | null = null;
  private showAllNews = false;
  private readonly host: ProgressHost = {
    run: (action) => void this.runProgress(action),
    redraw: () => this.render(),
    now: () => this.now(),
  };

  private static newDraft(): { name: string; image: number; description: string; type: AllianceType } & AdDraft {
    return { name: "", image: 1, description: "", type: "midas", join_mode: "open", language: null, time_zone: browserTimeZone(), min_level: 30 };
  }

  constructor(options: AllianceWindowOptions = {}) {
    this.options = options;
    this.trade = new TradeTab(
      {
        redraw: () => {
          if (this.tab === "trade") this.render();
        },
        say: (text) => this.say(text),
        now: () => this.now(),
        traded: () => playerPool()?.refresh(),
      },
      options.tradeApi,
    );
    this.focus = options.focus ?? null;
    this.api = options.api ?? allianceApi;
    this.progressApi = options.progressApi ?? allianceProgressApi;
    this.players = options.players ?? friendsApi;
    this.tab = options.tab ?? "overview";
    this.popup = new Popup({
      title: ALLIANCE_TEXT.title,
      className: "alliance-window",
      onClose: () => {
        this.destroyed = true;
        options.onClose?.();
      },
    });
    this.status.setAttribute("role", "status");
    this.status.hidden = true;
    this.popup.body.classList.add("alliance__body");
    // Under the body, not in it: the main buttons stay whole while the page scrolls.
    this.popup.element.append(this.foot);
  }

  /** Shows the window in `container` (the overlay's modal layer) and loads the player's alliance. */
  mount(container: HTMLElement): this {
    this.container = container;
    this.render();
    this.popup.mount(container);
    void this.load();
    return this;
  }

  close(): void {
    this.popup.close();
  }

  /** The owner's star editor (admins only); a save reloads the tab's figures. */
  private openStarEditor(): void {
    new StarEditor({ onClose: (saved) => saved && void this.load() }).mount(this.container ?? document.body);
  }

  /** What shows now, for a test. */
  get kind(): View["kind"] {
    return this.view.kind;
  }

  /** Shows a member tab; on Trade, `focus` opens Give or Send. */
  showTab(tab: AllianceTab, focus?: AllianceFocus): void {
    if (focus) this.focus = focus;
    this.tab = tab;
    this.editing = null;
    this.addingGoal = false;
    this.render();
    if (this.view.kind !== "mine") return;
    if (tab === "members") void this.loadMembers();
    if (tab === "overview") void this.loadNews();
    if (tab === "territory") void this.loadTerritory(this.territoryType ?? this.view.alliance.type);
    if (tab === "trade") this.loadTrade();
  }

  /** Loads the Trade tab, opening the sheet a focus asks for. */
  private loadTrade(): void {
    const focus = this.focus;
    this.focus = null;
    if (focus && "give" in focus) this.trade.openGive(focus.give);
    else if (focus && "send" in focus) this.trade.openSend(focus.send.userid, focus.send.username);
    else void this.trade.load();
  }

  /** Loads the player's alliance again: the marketplace without one, My alliance with one. */
  async load(): Promise<void> {
    const generation = ++this.generation;
    const mine = await this.api.mine();
    if (this.destroyed || generation !== this.generation) return;
    if (!mine.ok) {
      this.view = { kind: "failed" };
      this.say(mine.message);
      this.render();
      return;
    }
    this.rejoinAt = mine.rejoinAt;
    // The Alliance chat room opens or closes at once (joined, founded, left, kicked).
    const { alliance } = mine;
    (this.options.chat ?? worldChat).setAllianceRoom(
      alliance ? { id: alliance.alliance_id, name: alliance.name, image: alliance.image } : null,
    );
    if (mine.alliance) {
      this.view = { kind: "mine", alliance: mine.alliance };
      this.render();
      if (this.tab === "members") await this.loadMembers();
      if (this.tab === "overview") await this.loadNews();
      if (this.tab === "territory") await this.loadTerritory(this.territoryType ?? mine.alliance.type);
      if (this.tab === "trade") this.loadTrade();
      await this.loadInbox();
      return;
    }
    this.view = { kind: "market" };
    this.render();
    await Promise.all([this.loadMarket(), this.loadInbox()]);
  }

  private now(): number {
    return this.options.now?.() ?? Math.floor(Date.now() / 1000);
  }

  private myId(): number | null {
    return this.options.myId?.() ?? getSession()?.userId ?? null;
  }

  /** A line under the head: what just happened or why not. */
  private say(text: string | null, tone: "info" | "bad" = "info"): void {
    this.status.hidden = !text;
    this.status.textContent = text ?? "";
    this.status.className = `alliance__status alliance__status--${tone}`;
  }

  /** A refusal, with the join gate's next step as a button where the scene gave one. */
  private refuse(refusal: AllianceRefusal): void {
    this.say(refusalText(refusal, this.now()), "bad");
    const step = gateStep(refusal.reason);
    const run =
      step === "buildObservatory" ? this.options.onBuildObservatory : step === "openMap" ? this.options.onOpenMap : undefined;
    if (step && run) {
      this.status.append(
        " ",
        button(step === "buildObservatory" ? ALLIANCE_TEXT.buildObservatory : ALLIANCE_TEXT.openMap, "btn--primary alliance__step", () => {
          this.close();
          run();
        }),
      );
    }
  }

  private async loadMarket(): Promise<void> {
    const generation = this.generation;
    const answer = await this.api.search(this.search, this.page, this.filters);
    if (this.destroyed || generation !== this.generation || this.view.kind !== "market") return;
    if (!answer.ok) {
      this.refuse(answer);
      this.listings = [];
      this.total = 0;
    } else {
      this.listings = answer.alliances;
      this.total = answer.totalResults;
      this.pageSize = answer.pageSize;
      this.myCountry = answer.myCountry ?? null;
    }
    this.render();
  }

  private async loadInbox(): Promise<void> {
    const answer = await this.api.messages();
    if (this.destroyed || !answer.ok) return;
    this.inbox = answer.messages.filter((row) => row.status === "pending");
    this.render();
  }

  private async loadMembers(): Promise<void> {
    const answer = await this.api.members();
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.members = orderMembers(answer.members);
    this.render();
  }

  /**
   * A phase 2 action (light a star, suggest one, set or remove a goal): on a
   * refusal the reason shows; on success the alliance loads again on the same
   * tab (not {@link changed}, which goes back to the Overview).
   */
  private async runProgress(action: () => Promise<AllianceResult<object>>): Promise<void> {
    const answer = await action();
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      this.render();
      return;
    }
    this.say(null);
    this.addingGoal = false;
    await this.load();
  }

  private async loadNews(): Promise<void> {
    const answer = await this.progressApi.news();
    if (this.destroyed || !answer.ok) return;
    this.news = answer.news;
    if (this.tab === "overview") this.render();
  }

  private async loadTerritory(type: AllianceType): Promise<void> {
    this.territoryType = type;
    const answer = await this.progressApi.territory(type);
    if (this.destroyed || this.territoryType !== type) return;
    if (!answer.ok) {
      this.refuse(answer);
      this.territoryRows = [];
    } else {
      this.territoryRows = answer.rows;
    }
    if (this.tab === "territory") this.render();
  }

  /** After a join, a leave, a kick of the player: the alliance changed under the scene too. */
  private async changed(): Promise<void> {
    this.options.onChanged?.();
    this.tab = "overview";
    this.editing = null;
    await this.load();
  }

  private render(): void {
    if (this.destroyed) return;
    const view = this.view;
    this.foot.replaceChildren();
    this.foot.hidden = true;
    if (view.kind === "loading" || view.kind === "failed") {
      this.popup.setTitle(ALLIANCE_TEXT.title);
      this.popup.setHead(this.status);
      const words = make("p", "alliance__empty", view.kind === "loading" ? ALLIANCE_TEXT.loading : ALLIANCE_TEXT.loadFailed);
      const nodes: Node[] = [words];
      if (view.kind === "failed") nodes.push(button(ALLIANCE_TEXT.retry, "btn--primary", () => void this.retry()));
      this.popup.body.replaceChildren(...nodes);
      return;
    }
    if (view.kind === "market") this.renderMarket();
    else if (view.kind === "create") this.renderCreate();
    else this.renderMine(view.alliance);
  }

  private async retry(): Promise<void> {
    this.view = { kind: "loading" };
    this.say(null);
    this.render();
    await this.load();
  }

  /* ── Marketplace ──────────────────────────────────────────────────────── */

  private renderMarket(): void {
    this.popup.setTitle(ALLIANCE_TEXT.title);
    const head = make("div", "alliance__head");
    const title = make("h3", "alliance__head-title");
    title.append(gameIcon("alliance", { size: 24, decorative: true }), make("span", "", ALLIANCE_TEXT.marketTitle));
    head.append(title, button(ALLIANCE_TEXT.create, "btn--primary alliance__create", () => this.showCreate(), ALLIANCE_TEXT.createTitle));
    this.popup.setHead(head, this.status);

    const nodes: Node[] = [];
    const now = this.now();
    if (this.rejoinAt && this.rejoinAt > now) {
      const wait = make("p", "alliance__note alliance__note--wait");
      wait.append(gameIcon("time", { size: 16, decorative: true }), ALLIANCE_TEXT.rejoinWait(formatCountdown(this.rejoinAt - now)));
      nodes.push(wait);
    }
    const invites = this.inbox.filter((row) => row.type === "invite");
    if (invites.length > 0) nodes.push(this.invitesBox(invites));
    nodes.push(this.quickJoinBox(), this.searchBox(), this.filtersBox());

    if (this.listings.length === 0 && !this.search && !this.filtering()) {
      const empty = make("div", "alliance__first");
      empty.append(
        shieldImage(1, "medium", "alliance__first-shield"),
        make("p", "alliance__empty", ALLIANCE_TEXT.empty),
        button(ALLIANCE_TEXT.create, "btn--primary alliance__first-create", () => this.showCreate(), ALLIANCE_TEXT.createTitle),
      );
      nodes.push(empty);
    } else if (this.listings.length === 0) {
      nodes.push(make("p", "alliance__empty", ALLIANCE_TEXT.noMatch));
    } else {
      const list = make("div", "alliance__list");
      list.setAttribute("role", "list");
      list.append(...this.listings.map((listing) => this.listingRow(listing)));
      nodes.push(list);
      const pages = pageCount(this.total, this.pageSize);
      if (pages > 1) nodes.push(this.pager(pages));
    }
    this.popup.body.replaceChildren(...nodes);
  }

  private invitesBox(invites: readonly AllianceInviteRow[]): HTMLElement {
    const box = make("section", "alliance__invites");
    box.append(make("h4", "alliance__section", ALLIANCE_TEXT.invites));
    for (const invite of invites) {
      const row = make("div", "alliance__invite alliance__invite--answer");
      const words = make("div", "alliance__invite-words");
      words.append(make("strong", "", invite.alliance_name), make("small", "", ALLIANCE_TEXT.invitedBy(invite.invited_by_name)));
      row.append(
        shieldImage(invite.alliance_image, "small", "alliance__shield alliance__shield--small"),
        words,
        this.answerButtons(invite),
      );
      box.append(row);
    }
    return box;
  }

  /** Accept / Decline together: beside the name on desktop, on a line of their own on a phone. */
  private answerButtons(invite: AllianceInviteRow): HTMLElement {
    const answer = make("div", "alliance__invite-answer");
    answer.append(
      button(ALLIANCE_TEXT.accept, "btn--primary", () => void this.answerInvite(invite, true)),
      button(ALLIANCE_TEXT.decline, "btn--outline", () => void this.answerInvite(invite, false)),
    );
    return answer;
  }

  private async answerInvite(invite: AllianceInviteRow, accept: boolean): Promise<void> {
    const answer = await this.api.answerInvite(invite.invite_id, accept);
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      await this.loadInbox();
      return;
    }
    this.inbox = this.inbox.filter((row) => row.invite_id !== invite.invite_id);
    if (invite.type === "invite" && accept) {
      this.say(null);
      await this.changed();
      return;
    }
    this.say(null);
    if (invite.type === "request" && accept) await this.loadMembers();
    this.render();
  }

  private quickJoinBox(): HTMLElement {
    const box = make("section", "alliance__quick");
    const label = make("h4", "alliance__section", ALLIANCE_TEXT.quickJoin);
    label.title = ALLIANCE_TEXT.quickJoinTitle;
    const choices = make("div", "alliance__quick-types");
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", ALLIANCE_TEXT.quickJoin);
    for (const type of [...ALLIANCE_TYPES, "any"] as const) {
      const chosen = this.quickType === type;
      const choice = make("button", "alliance__chip");
      choice.type = "button";
      choice.setAttribute("aria-pressed", String(chosen));
      if (type === "any") choice.append(make("span", "alliance__chip-word", ALLIANCE_TEXT.anyType));
      else {
        choice.title = `${TYPE_INFO[type].label}: ${membersLine(type)}`;
        const size = make("span", "alliance__chip-size");
        size.append(gameIcon("friends", { size: 16, decorative: true }), make("span", "alliance__chip-count", String(TYPE_INFO[type].members)));
        choice.append(make("span", "alliance__chip-word", TYPE_INFO[type].label), size);
      }
      choice.addEventListener("click", () => {
        this.quickType = type;
        saveQuickType(type);
        this.render();
      });
      choices.append(choice);
    }
    box.append(label, choices, button(ALLIANCE_TEXT.join, "btn--primary alliance__quick-join", () => void this.quickJoin(), ALLIANCE_TEXT.quickJoinTitle));
    return box;
  }

  private async quickJoin(): Promise<void> {
    // Open alliances of the type, in the server's order: room first, then the most active.
    const type = this.quickType === "any" ? null : this.quickType;
    const answer = await this.api.search("", 0, { type, open: true });
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    const country = answer.myCountry ?? this.myCountry;
    const pick = quickJoinPick(answer.alliances.filter((listing) => !this.asked.has(listing.alliance_id)), this.quickType, country);
    if (!pick) {
      this.say(ALLIANCE_TEXT.quickNone, "bad");
      return;
    }
    await this.ask(pick);
  }

  private searchBox(): HTMLElement {
    const form = make("form", "alliance__search");
    const input = make("input", "alliance__input");
    input.type = "search";
    input.maxLength = 30;
    input.placeholder = ALLIANCE_TEXT.searchPlaceholder;
    input.setAttribute("aria-label", ALLIANCE_TEXT.searchPlaceholder);
    input.value = this.search;
    const go = make("button", "btn btn--outline alliance__search-go");
    go.type = "submit";
    go.setAttribute("aria-label", ALLIANCE_TEXT.search);
    go.title = ALLIANCE_TEXT.search;
    go.append(gameIcon("find", { size: 24, decorative: true }));
    form.append(input, go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.search = input.value.trim();
      this.page = 0;
      this.opened = null;
      void this.loadMarket();
    });
    return form;
  }

  private filtering(): boolean {
    return this.filters.open || this.filters.type !== null || this.filters.language !== null;
  }

  /** Type, language and Open only (design v5 §7a): chips the server narrows the list by. */
  private filtersBox(): HTMLElement {
    const row = make("div", "alliance__filters");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", ALLIANCE_TEXT.filters);
    const chip = (pressed: boolean, title: string, fill: (node: HTMLButtonElement) => void, flip: () => void): HTMLButtonElement => {
      const node = make("button", "alliance__chip alliance__filter");
      node.type = "button";
      node.title = title;
      node.setAttribute("aria-pressed", String(pressed));
      fill(node);
      node.addEventListener("click", () => {
        flip();
        this.page = 0;
        this.opened = null;
        void this.loadMarket();
      });
      return node;
    };
    row.append(
      chip(this.filters.open, ALLIANCE_TEXT.openOnlyTitle, (node) => {
        node.append(gameIcon(JOIN_ICON.open, { size: 16, decorative: true }), make("span", "alliance__chip-word", ALLIANCE_TEXT.openOnly));
      }, () => (this.filters.open = !this.filters.open)),
    );
    const country = this.filters.language ?? this.myCountry;
    if (country) {
      row.append(
        chip(this.filters.language !== null, ALLIANCE_TEXT.myLanguageTitle(countryName(country)), (node) => {
          node.setAttribute("aria-label", ALLIANCE_TEXT.myLanguageTitle(countryName(country)));
          node.append(countryFlagImage(country));
        }, () => (this.filters.language = this.filters.language ? null : country)),
      );
    }
    for (const type of ALLIANCE_TYPES) {
      row.append(
        chip(this.filters.type === type, TYPE_INFO[type].label, (node) => {
          const size = make("span", "alliance__chip-size");
          size.append(gameIcon("friends", { size: 16, decorative: true }), make("span", "alliance__chip-count", String(TYPE_INFO[type].members)));
          node.append(size);
        }, () => (this.filters.type = this.filters.type === type ? null : type)),
      );
    }
    if (this.filtering()) {
      const clear = button(ALLIANCE_TEXT.clear, "btn--outline alliance__filter-clear", () => {
        this.filters = { type: null, language: null, open: false };
        this.page = 0;
        this.opened = null;
        void this.loadMarket();
      });
      row.append(clear);
    }
    return row;
  }

  private pager(pages: number): HTMLElement {
    const row = make("div", "alliance__pager");
    const prev = button(ALLIANCE_TEXT.prev, "btn--outline", () => this.goPage(this.page - 1), "Previous page");
    prev.disabled = this.page <= 0;
    const next = button(ALLIANCE_TEXT.next, "btn--outline", () => this.goPage(this.page + 1), "Next page");
    next.disabled = this.page >= pages - 1;
    row.append(prev, make("span", "alliance__page", ALLIANCE_TEXT.page(this.page + 1, pages)), next);
    return row;
  }

  private goPage(page: number): void {
    this.page = Math.max(0, page);
    this.opened = null;
    void this.loadMarket();
  }

  private listingRow(listing: AllianceListing): HTMLElement {
    const opened = this.opened === listing.alliance_id;
    const item = make("div", "alliance__item");
    item.setAttribute("role", "listitem");
    item.dataset["alliance"] = String(listing.alliance_id);
    item.classList.toggle("is-open", opened);
    const row = make("button", "alliance__row");
    row.type = "button";
    row.setAttribute("aria-expanded", String(opened));
    const words = make("span", "alliance__row-words");
    words.append(make("strong", "alliance__row-name", listing.name), typeBadge(listing.type), adLine(listing));
    // The green number: members online now, as My Alliance's "online" (server `status`).
    const onlineNow = listing.online_members ?? 0;
    const active = make("span", "alliance__active", formatAmount(onlineNow));
    active.title = ALLIANCE_TEXT.online(onlineNow);
    active.setAttribute("aria-label", ALLIANCE_TEXT.online(onlineNow));
    active.prepend(onlineDot("alliance__active-dot", true));
    row.append(
      shieldImage(listing.image, "medium", "alliance__shield"),
      words,
      membersBadge(listing.members, listing.member_limit),
      active,
    );
    row.addEventListener("click", () => {
      this.opened = opened ? null : listing.alliance_id;
      this.render();
    });
    item.append(row);
    if (opened) {
      const more = make("div", "alliance__row-more");
      if (listing.description) more.append(make("p", "alliance__row-desc", listing.description));
      more.append(make("span", "alliance__row-leader", ALLIANCE_TEXT.leader(listing.leader_name)));
      const mode = joinModeOf(listing);
      const full = listing.members >= listing.member_limit;
      const asked = this.asked.has(listing.alliance_id);
      if (mode === "invite") {
        const note = make("span", "alliance__invite-only");
        note.append(gameIcon(JOIN_ICON.invite, { size: 16, decorative: true }), make("span", "", ALLIANCE_TEXT.joinMode.invite));
        more.append(note);
      } else {
        const words = full ? ALLIANCE_TEXT.full : mode === "open" ? ALLIANCE_TEXT.join : asked ? ALLIANCE_TEXT.asked : ALLIANCE_TEXT.ask;
        const ask = button(words, "btn--primary alliance__join", () => void this.ask(listing), ALLIANCE_TEXT.joinModeTitle[mode]);
        ask.disabled = full || (mode === "ask" && asked);
        more.append(ask);
      }
      const reported = this.reported.has(listing.alliance_id);
      const report = button(reported ? ALLIANCE_TEXT.reported : ALLIANCE_TEXT.report, "btn--outline alliance__report", () => void this.report(listing));
      report.disabled = reported;
      report.prepend(gameIcon("report", { size: 16, decorative: true }));
      more.append(report);
      item.append(more);
    }
    return item;
  }

  private async ask(listing: AllianceListing): Promise<void> {
    const answer = await this.api.requestJoin(listing.alliance_id);
    if (this.destroyed) return;
    if (!answer.ok) {
      if (answer.reason === "requestPending") this.asked.add(listing.alliance_id);
      this.refuse(answer);
      this.render();
      return;
    }
    if (answer.joined) {
      // An Open alliance took the player in: My alliance opens.
      this.say(null);
      await this.changed();
      return;
    }
    this.asked.add(listing.alliance_id);
    this.say(ALLIANCE_TEXT.askedNote(listing.name));
    this.render();
  }

  private async report(listing: AllianceListing): Promise<void> {
    const answer = await this.api.report(listing.alliance_id, "");
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.reported.add(listing.alliance_id);
    this.say(`Reported ${listing.name}. Thank you.`);
    this.render();
  }

  /* ── Create ───────────────────────────────────────────────────────────── */

  private showCreate(): void {
    this.view = { kind: "create" };
    this.say(null);
    this.render();
  }

  private renderCreate(): void {
    this.popup.setTitle(ALLIANCE_TEXT.createTitle);
    this.popup.setHead(this.status);
    const form = make("form", "alliance__form");
    form.noValidate = true;

    const name = make("input", "alliance__input");
    name.maxLength = ALLIANCE_NAME_MAX;
    name.value = this.draft.name;
    name.autocomplete = "off";
    name.addEventListener("input", () => (this.draft.name = name.value));
    form.append(this.field(ALLIANCE_TEXT.name, name));
    form.append(this.field(ALLIANCE_TEXT.shield, this.shieldPicker(this.draft.image, (image) => (this.draft.image = image))));

    const about = make("textarea", "alliance__input alliance__textarea");
    about.maxLength = ALLIANCE_DESC_MAX;
    about.rows = 2;
    about.placeholder = ALLIANCE_TEXT.descriptionPlaceholder;
    about.value = this.draft.description;
    about.addEventListener("input", () => (this.draft.description = about.value));
    form.append(this.field(ALLIANCE_TEXT.description, about));

    form.append(make("p", "alliance__note", ALLIANCE_TEXT.typeIntro), this.typeCards(this.draft.type, (type) => (this.draft.type = type)));
    form.append(make("p", "alliance__note alliance__note--soft", ALLIANCE_TEXT.typeLater));
    form.append(this.adFields(this.draft));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.create();
    });
    this.popup.body.replaceChildren(form);

    this.foot.hidden = false;
    const back = button(ALLIANCE_TEXT.back, "btn--outline", () => {
      this.view = { kind: "market" };
      this.say(null);
      this.render();
    });
    const create = button(ALLIANCE_TEXT.create, "btn--primary alliance__submit", () => void this.create());
    this.foot.append(back, create);
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const wrap = make("label", "alliance__field");
    wrap.append(make("span", "alliance__label", label), control);
    return wrap;
  }

  /** Flash's 41 shields as a row of choices; the chosen one marked. */
  private shieldPicker(chosen: number, pick: (image: number) => void): HTMLElement {
    const grid = make("div", "alliance__shields");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", ALLIANCE_TEXT.shield);
    for (let image = 1; image <= SHIELD_COUNT; image++) {
      const choice = make("button", "alliance__shield-choice");
      choice.type = "button";
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-checked", String(image === chosen));
      choice.setAttribute("aria-label", `Shield ${image}`);
      choice.append(shieldImage(image, "small", "alliance__shield alliance__shield--small"));
      choice.addEventListener("click", (event) => {
        event.preventDefault();
        pick(image);
        for (const other of grid.querySelectorAll("[role=radio]")) other.setAttribute("aria-checked", String(other === choice));
      });
      grid.append(choice);
    }
    return grid;
  }

  /** A labelled group of buttons (not a <label>: a click on its words must not press the first button). */
  private group(label: string, control: HTMLElement): HTMLElement {
    const wrap = make("div", "alliance__field");
    const words = make("span", "alliance__label", label);
    words.id = `alliance-${label.toLowerCase().replace(/\W+/g, "-")}`;
    control.setAttribute("aria-labelledby", words.id);
    wrap.append(words, control);
    return wrap;
  }

  /** ‹ value ›: one step each press, the value redrawn in place so the rest of the form keeps what was typed. */
  private stepper(icon: GameIconName, read: () => string, step: (direction: 1 | -1) => void, ends: () => [boolean, boolean]): HTMLElement {
    const box = make("div", "alliance__stepper");
    box.setAttribute("role", "group");
    const value = make("span", "alliance__stepper-value");
    const less = button("‹", "btn--outline alliance__stepper-go", () => press(-1), "Less");
    const more = button("›", "btn--outline alliance__stepper-go", () => press(1), "More");
    const draw = (): void => {
      value.replaceChildren(gameIcon(icon, { size: 16, decorative: true }), make("span", "", read()));
      const [atMin, atMax] = ends();
      less.disabled = atMin;
      more.disabled = atMax;
    };
    const press = (direction: 1 | -1): void => {
      step(direction);
      draw();
    };
    draw();
    box.append(less, value, more);
    return box;
  }

  /**
   * The ad's settings (design v5 §7a): joining mode, language, time zone,
   * minimum level. Every press changes `ad` and redraws in place.
   */
  private adFields(ad: AdDraft): HTMLElement {
    const box = make("div", "alliance__ad-fields");

    const modes = make("div", "alliance__modes");
    for (const mode of JOIN_MODES) {
      const chip = make("button", "alliance__chip alliance__mode");
      chip.type = "button";
      chip.dataset["mode"] = mode;
      chip.title = ALLIANCE_TEXT.joinModeTitle[mode];
      chip.setAttribute("aria-pressed", String(ad.join_mode === mode));
      chip.append(gameIcon(JOIN_ICON[mode], { size: 16, decorative: true }), make("span", "alliance__chip-word", ALLIANCE_TEXT.joinMode[mode]));
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        ad.join_mode = mode;
        for (const other of modes.querySelectorAll("[data-mode]")) other.setAttribute("aria-pressed", String(other === chip));
      });
      modes.append(chip);
    }
    box.append(this.group(ALLIANCE_TEXT.joining, modes));

    // Language: the chat country list, opened under the button; "Not set" is any language.
    const language = make("div", "alliance__lang");
    const pick = make("button", "btn btn--outline alliance__lang-pick");
    pick.type = "button";
    pick.setAttribute("aria-expanded", "false");
    const drawPick = (): void => {
      pick.replaceChildren(
        ...(ad.language ? [countryFlagImage(ad.language), make("span", "", countryName(ad.language))] : [make("span", "", ALLIANCE_TEXT.anyLanguage)]),
      );
    };
    let picker: CountryPicker | null = null;
    pick.addEventListener("click", (event) => {
      event.preventDefault();
      if (picker) {
        picker.element.remove();
        picker = null;
        pick.setAttribute("aria-expanded", "false");
        return;
      }
      picker = new CountryPicker({
        selected: ad.language,
        onPick: (code) => {
          ad.language = code;
          drawPick();
          picker?.element.remove();
          picker = null;
          pick.setAttribute("aria-expanded", "false");
        },
      });
      picker.element.classList.add("alliance__lang-list");
      language.append(picker.element);
      pick.setAttribute("aria-expanded", "true");
      picker.revealSelected();
    });
    drawPick();
    language.append(pick);
    box.append(this.group(ALLIANCE_TEXT.language, language));

    const zone = this.stepper(
      "time",
      () => (ad.time_zone === null ? "—" : gmtLabel(ad.time_zone)),
      (direction) => (ad.time_zone = ad.time_zone === null ? browserTimeZone() : stepTimeZone(ad.time_zone, direction)),
      () => (ad.time_zone === null ? [false, false] : [ad.time_zone <= -12, ad.time_zone >= 14]),
    );
    const level = this.stepper(
      "levelup",
      () => (shownMinLevel(ad) === null ? ALLIANCE_TEXT.anyLevel : `${ad.min_level}+`),
      (direction) => (ad.min_level = stepMinLevel(ad.min_level, direction)),
      () => [ad.min_level <= 30, ad.min_level >= 60],
    );
    const numbers = make("div", "alliance__ad-numbers");
    numbers.append(this.group(ALLIANCE_TEXT.timeZone, zone), this.group(ALLIANCE_TEXT.minLevel, level));
    box.append(numbers);
    return box;
  }

  /** The three type cards; each leads with "Up to N members". */
  private typeCards(chosen: AllianceType, pick: (type: AllianceType) => void): HTMLElement {
    const cards = make("div", "alliance__types");
    cards.setAttribute("role", "radiogroup");
    for (const type of ALLIANCE_TYPES) {
      const info = TYPE_INFO[type];
      const card = make("button", `alliance__type-card alliance__type-card--${type}`);
      card.type = "button";
      card.setAttribute("role", "radio");
      card.setAttribute("aria-checked", String(type === chosen));
      const size = make("span", "alliance__type-size");
      size.append(gameIcon("friends", { size: 24, decorative: true }), make("span", "", membersLine(type)));
      card.append(
        make("span", "alliance__type-name", info.label),
        size,
        make("span", "alliance__type-officers", ALLIANCE_TEXT.officers(info.officers)),
        make("span", "alliance__type-good", `+ ${info.strength}`),
        make("span", "alliance__type-bad", `− ${info.weakness}`),
      );
      card.addEventListener("click", (event) => {
        event.preventDefault();
        pick(type);
        for (const other of cards.querySelectorAll("[role=radio]")) other.setAttribute("aria-checked", String(other === card));
      });
      cards.append(card);
    }
    return cards;
  }

  private async create(): Promise<void> {
    const problem = nameProblem(this.draft.name) ?? descriptionProblem(this.draft.description);
    if (problem) {
      this.say(problem, "bad");
      return;
    }
    const answer = await this.api.create({
      name: this.draft.name.trim(),
      image: this.draft.image,
      description: this.draft.description.trim(),
      type: this.draft.type,
      join_mode: this.draft.join_mode,
      language: this.draft.language,
      time_zone: this.draft.time_zone,
      min_level: this.draft.min_level,
    });
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.draft = AllianceWindow.newDraft();
    this.say(null);
    await this.changed();
  }

  /* ── My alliance ──────────────────────────────────────────────────────── */

  private renderMine(alliance: MyAlliance): void {
    this.popup.setTitle(alliance.name);
    const head = make("div", "alliance__head alliance__head--mine");
    const words = make("div", "alliance__head-words");
    words.append(
      make("strong", "alliance__head-name", alliance.name),
      typeBadge(alliance.type),
    );
    head.append(
      shieldImage(alliance.image, "medium", "alliance__shield alliance__shield--head"),
      words,
      membersBadge(alliance.number_of_members ?? this.members.length, alliance.member_limit),
    );
    // `.tab-row`: the row fills the window and never cuts a label (ui.css).
    const tabs = make("div", "tabs tab-row alliance__tabs");
    tabs.setAttribute("role", "tablist");
    for (const tab of AllianceWindow.TABS) {
      const words = ALLIANCE_TEXT.tabs[tab];
      const node = make("button", "tabs__tab alliance__tab");
      node.append(
        gameIcon(AllianceWindow.TAB_ICONS[tab], { size: 24, decorative: true }),
        make("span", "alliance__tab-words", words),
      );
      node.title = words;
      node.setAttribute("aria-label", words);
      node.type = "button";
      node.setAttribute("role", "tab");
      node.setAttribute("aria-selected", String(tab === this.tab));
      node.dataset["tab"] = tab;
      node.addEventListener("click", () => this.showTab(tab));
      tabs.append(node);
    }
    this.popup.setHead(head, tabs, this.status);
    this.popup.body.replaceChildren(...this.tabBody(alliance));

    this.foot.hidden = alliance.role === "leader" && (alliance.number_of_members ?? 1) > 1;
    if (!this.foot.hidden) this.foot.append(...this.leaveButtons());
  }

  private leaveButtons(): HTMLElement[] {
    if (!this.leaving) {
      return [button(ALLIANCE_TEXT.leave, "btn--outline alliance__leave", () => {
        this.leaving = true;
        this.render();
      })];
    }
    return [
      make("span", "alliance__confirm-words", ALLIANCE_TEXT.leaveConfirm),
      button(ALLIANCE_TEXT.yes, "btn--primary", () => void this.leave()),
      button(ALLIANCE_TEXT.no, "btn--outline", () => {
        this.leaving = false;
        this.render();
      }),
    ];
  }

  private async leave(): Promise<void> {
    const answer = await this.api.leave();
    if (this.destroyed) return;
    this.leaving = false;
    if (!answer.ok) {
      this.refuse(answer);
      this.render();
      return;
    }
    this.members = [];
    this.say(null);
    await this.changed();
  }

  private tabBody(alliance: MyAlliance): HTMLElement[] {
    switch (this.tab) {
      case "members":
        return this.membersTab(alliance);
      case "constellation":
        return constellationTab(
          alliance,
          this.host,
          this.progressApi,
          this.chosenStar,
          (id) => {
            this.chosenStar = id;
            this.render();
          },
          alliance.can_edit_stars ? () => this.openStarEditor() : undefined,
        );
      case "trade":
        return this.trade.render();
      case "territory":
        return territoryTab(
          alliance,
          this.territoryType ?? alliance.type,
          this.territoryRows,
          (type) => {
            this.territoryRows = null;
            this.render();
            void this.loadTerritory(type);
          },
          (image) => shieldUrl(image, "small"),
        );
      default:
        return this.overviewTab(alliance);
    }
  }

  private overviewTab(alliance: MyAlliance): HTMLElement[] {
    const now = this.now();
    const nodes: HTMLElement[] = [];
    if (alliance.can_take_over) {
      const box = make("div", "alliance__callout");
      box.append(make("p", "", ALLIANCE_TEXT.takeOverNote), button(ALLIANCE_TEXT.takeOver, "btn--primary", () => void this.takeOver()));
      nodes.push(box);
    }
    if (alliance.must_rename && alliance.role === "leader") nodes.push(make("p", "alliance__callout", ALLIANCE_TEXT.mustRename));

    const tiles = make("div", "alliance__tiles");
    tiles.append(
      this.tile(gameIcon("friends", { size: 24, decorative: true }), `${formatAmount(alliance.number_of_members ?? 0)}/${formatAmount(alliance.member_limit)}`, ALLIANCE_TEXT.membersCount(alliance.number_of_members ?? 0, alliance.member_limit), ALLIANCE_TEXT.tileCaption.members),
      this.tile(onlineDot("alliance__tile-dot", true), formatAmount(alliance.online_members ?? 0), ALLIANCE_TEXT.online(alliance.online_members ?? 0), ALLIANCE_TEXT.tileCaption.online),
      this.tile(gameIcon("empire", { size: 24, decorative: true }), formatAmount(alliance.points), ALLIANCE_TEXT.points, ALLIANCE_TEXT.tileCaption.points),
    );
    nodes.push(tiles);

    // The type's 2 strengths and 2 weaknesses at today's values; the plain
    // words only while the server sends no constellations.
    const stats = statTiles(alliance);
    const info = TYPE_INFO[alliance.type];
    if (stats) nodes.push(stats);
    else if (info) {
      const type = make("div", "alliance__type-line");
      type.append(make("span", "alliance__type-good", `+ ${info.strength}`), make("span", "alliance__type-bad", `− ${info.weakness}`));
      nodes.push(type);
    }
    nodes.push(make("p", "alliance__leader", ALLIANCE_TEXT.leader(alliance.leader_name)));

    if (this.editing === "advert") nodes.push(this.advertForm(alliance));
    else {
      nodes.push(make("p", "alliance__description", alliance.description));
      if (alliance.join_mode) nodes.push(adLine(alliance));
      const actions = make("div", "alliance__actions");
      if (canEdit(alliance)) actions.append(button(ALLIANCE_TEXT.edit, "btn--outline", () => this.edit("advert")));
      if (alliance.permissions.includes("rename")) {
        const wait = renameWait(alliance, now);
        const rename = button(ALLIANCE_TEXT.rename, "btn--outline", () => this.edit("rename"), wait ?? undefined);
        rename.disabled = wait !== null;
        actions.append(rename);
      }
      if (alliance.permissions.includes("switchType")) actions.append(button(ALLIANCE_TEXT.changeType, "btn--outline", () => this.edit("type")));
      if (actions.childElementCount > 0) nodes.push(actions);
    }
    if (this.editing === "rename") nodes.push(this.renameForm(alliance));
    if (this.editing === "type") nodes.push(this.typeSwitch(alliance, now));

    const adding = {
      open: this.addingGoal,
      toggle: () => {
        this.addingGoal = !this.addingGoal;
        this.render();
      },
    };
    for (const part of [
      todayCard(alliance),
      goalsCard(alliance, this.host, this.progressApi, adding),
      helpersCard(alliance),
      newsCard(this.news, this.showAllNews, this.host, () => {
        this.showAllNews = !this.showAllNews;
        this.render();
      }),
    ]) {
      if (part) nodes.push(part);
    }
    return nodes;
  }

  private tile(picture: HTMLElement, value: string, label: string, caption: string): HTMLElement {
    const tile = make("div", "alliance__tile");
    tile.title = label;
    tile.setAttribute("aria-label", `${label}: ${value}`);
    const words = make("span", "alliance__tile-words");
    words.append(make("strong", "alliance__tile-value", value), make("span", "alliance__tile-caption", caption));
    tile.append(picture, words);
    return tile;
  }

  private edit(what: "advert" | "rename" | "type"): void {
    this.editing = this.editing === what ? null : what;
    this.advertAd = null;
    this.say(null);
    this.render();
  }

  private advertForm(alliance: MyAlliance): HTMLElement {
    let image = alliance.image;
    const form = make("div", "alliance__form alliance__form--inline");
    const about = make("textarea", "alliance__input alliance__textarea");
    about.maxLength = ALLIANCE_DESC_MAX;
    about.rows = 2;
    about.value = alliance.description;
    this.advertAd ??= {
      join_mode: joinModeOf(alliance),
      language: alliance.language ?? null,
      time_zone: alliance.time_zone ?? null,
      min_level: alliance.min_level ?? 30,
    };
    const ad = this.advertAd;
    form.append(
      this.field(ALLIANCE_TEXT.shield, this.shieldPicker(image, (chosen) => (image = chosen))),
      this.field(ALLIANCE_TEXT.description, about),
      this.adFields(ad),
    );
    const actions = make("div", "alliance__actions");
    actions.append(
      button(ALLIANCE_TEXT.save, "btn--primary", () => void this.saveAdvert(image, about.value, ad)),
      button(ALLIANCE_TEXT.cancel, "btn--outline", () => this.edit("advert")),
    );
    form.append(actions);
    return form;
  }

  private async saveAdvert(image: number, description: string, ad: AdDraft): Promise<void> {
    const problem = descriptionProblem(description);
    if (problem) {
      this.say(problem, "bad");
      return;
    }
    const answer = await this.api.edit({ image, description: description.trim(), ...ad });
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.editing = null;
    this.advertAd = null;
    await this.load();
  }

  private renameForm(alliance: MyAlliance): HTMLElement {
    const form = make("form", "alliance__form alliance__form--inline");
    const name = make("input", "alliance__input");
    name.maxLength = ALLIANCE_NAME_MAX;
    name.value = alliance.name;
    name.autocomplete = "off";
    const actions = make("div", "alliance__actions");
    const save = make("button", "btn btn--primary", ALLIANCE_TEXT.save);
    save.type = "submit";
    actions.append(save, button(ALLIANCE_TEXT.cancel, "btn--outline", () => this.edit("rename")));
    form.append(this.field(ALLIANCE_TEXT.name, name), actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.rename(name.value);
    });
    return form;
  }

  private async rename(name: string): Promise<void> {
    const problem = nameProblem(name);
    if (problem) {
      this.say(problem, "bad");
      return;
    }
    const answer = await this.api.rename(name.trim());
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.editing = null;
    this.options.onChanged?.();
    await this.load();
  }

  /** The other two types, each with the server's quote and Switch. */
  private typeSwitch(alliance: MyAlliance, now: number): HTMLElement {
    const box = make("div", "alliance__switch");
    for (const option of alliance.type_options) {
      if (option.type === alliance.type) continue;
      const info = TYPE_INFO[option.type];
      if (!info) continue;
      const row = make("div", "alliance__switch-row");
      const words = make("div", "alliance__switch-words");
      words.append(make("strong", "", info.label), make("small", "", `${membersLine(option.type)} · ${switchSummary(option, now)}`));
      const go = button(ALLIANCE_TEXT.switchTo, option.up ? "btn--primary" : "btn--outline", () => void this.switchType(option.type));
      go.disabled = option.refusal !== null;
      row.append(words, go);
      box.append(row);
    }
    return box;
  }

  private async switchType(type: AllianceType): Promise<void> {
    const answer = await this.api.changeType(type);
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.editing = null;
    this.say(`Now a ${TYPE_INFO[type].label}.`);
    await this.load();
  }

  private async takeOver(): Promise<void> {
    const answer = await this.api.takeOver();
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.options.onChanged?.();
    await this.load();
  }

  /* ── Members ──────────────────────────────────────────────────────────── */

  private membersTab(alliance: MyAlliance): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    const requests = this.inbox.filter((row) => row.type === "request");
    if (requests.length > 0 && alliance.permissions.includes("answerRequest")) nodes.push(this.requestsBox(requests));
    const list = make("div", "alliance__list");
    list.setAttribute("role", "list");
    const officers = officerCount(this.members);
    const me = this.myId() ?? -1;
    list.append(...this.members.map((member) => this.memberRow(alliance, member, memberActions(alliance, member, me, officers))));
    nodes.push(list);
    if (canInvite(alliance)) nodes.push(this.inviteBox());
    return nodes;
  }

  private requestsBox(requests: readonly AllianceInviteRow[]): HTMLElement {
    const box = make("section", "alliance__invites");
    box.append(make("h4", "alliance__section", ALLIANCE_TEXT.requests));
    for (const request of requests) {
      const row = make("div", "alliance__invite alliance__invite--answer");
      row.append(
        this.face(request.user_pic_square, request.user_id),
        make("strong", "alliance__invite-words", request.user_name),
        this.answerButtons(request),
      );
      box.append(row);
    }
    return box;
  }

  private face(pic: string | null, userid: number): HTMLElement {
    const img = make("img", "alliance__face");
    img.src = avatarUrl(avatarOf(pic, userid), "small");
    img.alt = "";
    img.loading = "lazy";
    return img;
  }

  private memberRow(alliance: MyAlliance, member: AllianceMember, actions: readonly MemberAction[]): HTMLElement {
    // Every mate but yourself can be sent resources (design v5 §7b, §12b).
    const canSend = member.user_id !== (this.myId() ?? -1);
    const opened = this.openMember === member.user_id && (actions.length > 0 || canSend);
    const item = make("div", "alliance__item");
    item.setAttribute("role", "listitem");
    item.dataset["userid"] = String(member.user_id);
    item.classList.toggle("is-open", opened);
    const row = make("button", "alliance__row");
    row.type = "button";
    row.disabled = actions.length === 0 && !canSend;
    row.setAttribute("aria-expanded", String(opened));
    const role = member.role ?? "member";
    const words = make("span", "alliance__row-words");
    words.append(make("strong", "alliance__row-name", member.display_name), make("span", `alliance__role alliance__role--${role}`, ROLE_WORD[role]));
    row.append(
      this.face(member.pic_square, member.user_id),
      words,
      make("span", "alliance__level", ALLIANCE_TEXT.level(member.level)),
      // Offline: an empty spot of the dot's size, so the levels line up (and no "Online" label).
      member.online ? onlineDot("alliance__online", false) : make("span", "alliance__online alliance__online--off"),
    );
    row.addEventListener("click", () => {
      this.openMember = opened ? null : member.user_id;
      this.confirming = null;
      this.render();
    });
    item.append(row);
    if (opened) {
      const more = make("div", "alliance__row-more");
      const confirming = this.confirming?.userid === member.user_id ? this.confirming.action : null;
      if (confirming) {
        more.append(
          make("span", "alliance__confirm-words", ALLIANCE_TEXT.confirm[confirming](member.display_name)),
          button(ALLIANCE_TEXT.yes, "btn--primary", () => void this.act(alliance, member, confirming)),
          button(ALLIANCE_TEXT.no, "btn--outline", () => {
            this.confirming = null;
            this.render();
          }),
        );
      } else {
        if (canSend) {
          const send = button(ALLIANCE_TEXT.send, "btn--outline alliance__send", () =>
            this.showTab("trade", { send: { userid: member.user_id, username: member.display_name } }),
          );
          send.prepend(gameIcon("income", { size: 16, decorative: true }));
          more.append(send);
        }
        for (const action of actions) {
          more.append(
            button(ALLIANCE_TEXT.action[action], action === "kick" ? "btn--outline alliance__kick" : "btn--outline", () => {
              this.confirming = { userid: member.user_id, action };
              this.render();
            }),
          );
        }
      }
      item.append(more);
    }
    return item;
  }

  private async act(alliance: MyAlliance, member: AllianceMember, action: MemberAction): Promise<void> {
    const api = this.api;
    const answer =
      action === "kick"
        ? await api.kick(member.user_id)
        : action === "handOver"
          ? await api.handOver(member.user_id)
          : action === "promote"
            ? await api.setRank(member.user_id, "officer")
            : action === "demote"
              ? await api.setRank(member.user_id, "member")
              : await api.invite(member.user_id);
    if (this.destroyed) return;
    this.confirming = null;
    if (!answer.ok) {
      this.refuse(answer);
      this.render();
      return;
    }
    this.say(null);
    this.openMember = null;
    // A hand-over changes the viewer's own rank and buttons: load the alliance again.
    if (action === "handOver") await this.load();
    else if (alliance) await this.loadMembers();
  }

  /** Invite: players without an alliance in the world, and a search by name. Invites go by mail. */
  private inviteBox(): HTMLElement {
    const box = make("section", "alliance__invite-box");
    box.append(make("h4", "alliance__section", ALLIANCE_TEXT.inviteTitle));
    const form = make("form", "alliance__search");
    const input = make("input", "alliance__input");
    input.type = "search";
    input.placeholder = ALLIANCE_TEXT.invitePlaceholder;
    input.setAttribute("aria-label", ALLIANCE_TEXT.invitePlaceholder);
    const go = make("button", "btn btn--outline alliance__search-go");
    go.type = "submit";
    go.setAttribute("aria-label", ALLIANCE_TEXT.search);
    go.append(gameIcon("find", { size: 24, decorative: true }));
    form.append(input, go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.findPlayers(input.value);
    });
    box.append(form);

    const people = this.found.length > 0
      ? this.found.filter((player) => player.relation !== "self").map((player) => ({ id: player.userid, name: player.username, level: player.level, pic: player.pic }))
      : this.suggested.map((member) => ({ id: member.user_id, name: member.display_name, level: member.level, pic: member.pic_square }));
    if (this.found.length === 0 && this.suggested.length > 0) box.append(make("p", "alliance__note alliance__note--soft", ALLIANCE_TEXT.suggested));
    for (const person of people) {
      const row = make("div", "alliance__invite");
      const invited = this.invitedIds.has(person.id);
      const send = button(invited ? ALLIANCE_TEXT.invited : ALLIANCE_TEXT.invite, "btn--primary", () => void this.invite(person.id, person.name));
      send.disabled = invited;
      row.append(
        this.face(person.pic, person.id),
        make("strong", "alliance__invite-words", person.name),
        make("span", "alliance__level", ALLIANCE_TEXT.level(person.level)),
        send,
      );
      box.append(row);
    }
    if (this.suggested.length === 0 && this.found.length === 0) void this.loadSuggested();
    return box;
  }

  private suggestedAsked = false;

  private async loadSuggested(): Promise<void> {
    if (this.suggestedAsked) return;
    this.suggestedAsked = true;
    const answer = await this.api.suggested();
    if (this.destroyed || !answer.ok || answer.members.length === 0) return;
    this.suggested = answer.members;
    this.render();
  }

  private async findPlayers(text: string): Promise<void> {
    const query = text.trim();
    if (query.length < SEARCH_MIN_LENGTH) {
      this.found = [];
      this.say(`Type at least ${SEARCH_MIN_LENGTH} letters.`, "bad");
      this.render();
      return;
    }
    try {
      this.found = await this.players.search(query);
    } catch {
      this.found = [];
    }
    if (this.destroyed) return;
    this.say(this.found.length === 0 ? "No player has that name." : null, "bad");
    this.render();
  }

  private async invite(userid: number, name: string): Promise<void> {
    const answer = await this.api.invite(userid);
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.invitedIds.add(userid);
    this.say(ALLIANCE_TEXT.inviteSent(name));
    this.render();
  }
}
