import { getSession } from "@/api/auth";
import {
  ALLIANCE_TYPES,
  allianceApi,
  type AllianceApi,
  type AllianceInviteRow,
  type AllianceListing,
  type AllianceMember,
  type AllianceResult,
  type AllianceRefusal,
  type AllianceType,
  type MyAlliance,
} from "@/api/alliance";
import { friendsApi, SEARCH_MIN_LENGTH, type FriendsApi, type PlayerResult } from "@/api/friends";
import { avatarOf, avatarUrl } from "@/game/avatars";
import {
  ALLIANCE_DESC_MAX,
  ALLIANCE_NAME_MAX,
  canEdit,
  canInvite,
  descriptionProblem,
  gateStep,
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
  switchSummary,
  TYPE_INFO,
  type MemberAction,
} from "@/game/alliance/allianceRules";
import type { AllianceTab } from "@/game/alliance/allianceView";
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
import { make } from "@/ui/friends/rows";
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
  quickJoinTitle: "Ask the most active alliance of this type with room",
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
  quickNone: "No alliance of that type has room. Try Any.",
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
  tabs: { overview: "Overview", constellation: "Constellation", members: "Members", territory: "Territory" } as Readonly<
    Record<AllianceTab, string>
  >,
  membersCount: (count: number, limit: number): string => `${formatAmount(count)} / ${formatAmount(limit)} members`,
  online: (count: number): string => `${formatAmount(count)} online`,
  points: "Alliance points",
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

const typeBadge = (type: AllianceType): HTMLElement =>
  make("span", `alliance__type alliance__type--${type}`, TYPE_INFO[type]?.label ?? type);

export class AllianceWindow {
  /** The member tabs, in order (design v5 §7b); phase 3 puts Trade before Territory. */
  static readonly TABS: readonly AllianceTab[] = ["overview", "constellation", "members", "territory"];

  /** Each tab's painted icon; on a phone the tabs show only it. */
  static readonly TAB_ICONS: Readonly<Record<AllianceTab, GameIconName>> = {
    overview: "alliance",
    constellation: "empire",
    members: "friends",
    territory: "pin",
  };

  readonly popup: Popup;

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

  // Create form, kept while the player goes Back and forth.
  private draft = { name: "", image: 1, description: "", type: "midas" as AllianceType };

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

  constructor(options: AllianceWindowOptions = {}) {
    this.options = options;
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
    this.render();
    this.popup.mount(container);
    void this.load();
    return this;
  }

  close(): void {
    this.popup.close();
  }

  /** What shows now, for a test. */
  get kind(): View["kind"] {
    return this.view.kind;
  }

  /** Shows a member tab (Overview, Members). */
  showTab(tab: AllianceTab): void {
    this.tab = tab;
    this.editing = null;
    this.addingGoal = false;
    this.render();
    if (this.view.kind !== "mine") return;
    if (tab === "members") void this.loadMembers();
    if (tab === "overview") void this.loadNews();
    if (tab === "territory") void this.loadTerritory(this.territoryType ?? this.view.alliance.type);
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
    const answer = await this.api.search(this.search, this.page);
    if (this.destroyed || generation !== this.generation || this.view.kind !== "market") return;
    if (!answer.ok) {
      this.refuse(answer);
      this.listings = [];
      this.total = 0;
    } else {
      this.listings = answer.alliances;
      this.total = answer.totalResults;
      this.pageSize = answer.pageSize;
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
    nodes.push(this.quickJoinBox(), this.searchBox());

    if (this.listings.length === 0 && !this.search) {
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
    // The first page is the server's order: room first, then the most active.
    const answer = this.search || this.page > 0 ? await this.api.search("", 0) : null;
    if (this.destroyed) return;
    if (answer && !answer.ok) {
      this.refuse(answer);
      return;
    }
    const listings = answer?.ok ? answer.alliances : this.listings;
    const pick = quickJoinPick(listings.filter((listing) => !this.asked.has(listing.alliance_id)), this.quickType);
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
    words.append(make("strong", "alliance__row-name", listing.name), typeBadge(listing.type));
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
      more.append(make("span", "alliance__row-leader", ALLIANCE_TEXT.leader(listing.leader_name)));
      const full = listing.members >= listing.member_limit;
      const asked = this.asked.has(listing.alliance_id);
      const ask = button(full ? ALLIANCE_TEXT.full : asked ? ALLIANCE_TEXT.asked : ALLIANCE_TEXT.ask, "btn--primary", () => void this.ask(listing));
      ask.disabled = full || asked;
      const reported = this.reported.has(listing.alliance_id);
      const report = button(reported ? ALLIANCE_TEXT.reported : ALLIANCE_TEXT.report, "btn--outline alliance__report", () => void this.report(listing));
      report.disabled = reported;
      report.prepend(gameIcon("report", { size: 16, decorative: true }));
      more.append(ask, report);
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
    });
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.draft = { name: "", image: 1, description: "", type: "midas" };
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
        return constellationTab(alliance, this.host, this.progressApi, this.chosenStar, (id) => {
          this.chosenStar = id;
          this.render();
        });
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
    form.append(
      this.field(ALLIANCE_TEXT.shield, this.shieldPicker(image, (chosen) => (image = chosen))),
      this.field(ALLIANCE_TEXT.description, about),
    );
    const actions = make("div", "alliance__actions");
    actions.append(
      button(ALLIANCE_TEXT.save, "btn--primary", () => void this.saveAdvert(image, about.value)),
      button(ALLIANCE_TEXT.cancel, "btn--outline", () => this.edit("advert")),
    );
    form.append(actions);
    return form;
  }

  private async saveAdvert(image: number, description: string): Promise<void> {
    const problem = descriptionProblem(description);
    if (problem) {
      this.say(problem, "bad");
      return;
    }
    const answer = await this.api.edit({ image, description: description.trim() });
    if (this.destroyed) return;
    if (!answer.ok) {
      this.refuse(answer);
      return;
    }
    this.editing = null;
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
    const opened = this.openMember === member.user_id && actions.length > 0;
    const item = make("div", "alliance__item");
    item.setAttribute("role", "listitem");
    item.dataset["userid"] = String(member.user_id);
    item.classList.toggle("is-open", opened);
    const row = make("button", "alliance__row");
    row.type = "button";
    row.disabled = actions.length === 0;
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
