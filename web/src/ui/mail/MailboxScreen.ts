import { tutTarget, TutTarget } from "@/game/guide/targets";
import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import { getSession } from "@/api/auth";
import { allianceApi, type AllianceApi } from "@/api/alliance";
import { shieldUrl } from "@/game/alliance/allianceRules";
import { blockRefusal, mailApi, type InvitePayment, type MailApi, type MailTarget } from "@/api/mail";
import type { OffsetCell } from "@/game/HexGrid";
import {
  contactsOf,
  counterText,
  MESSAGE_LIMIT,
  NO_SUBJECT,
  sendable,
  sentText,
  teamAnswerable,
  threadItems,
  threadList,
  unreadThreads,
  type MailAttack,
  type MailContact,
  type MailAllianceInvite,
  type MailItem,
  type MailThread,
} from "@/game/mail/mailbox";
import {
  canPropose,
  REQUEST_DAYS,
  requestIndex,
  TRUCE_ACCEPT_TEXT,
  TRUCE_DAYS,
  TRUCE_REJECT_TEXT,
  TRUCE_REQUEST_TEXT,
  truceCard,
  truceState,
  truceTag,
  type TruceTone,
} from "@/game/mail/truce";
import {
  INVITE_DAYS,
  INVITE_SUBJECT,
  INVITE_TEXT,
  INVITE_WARNING,
  INVITE_WITHDRAW_TEXT,
  inviteCard,
  inviteIndex,
  invitePriceText,
  inviteState,
  inviteTag,
} from "@/game/mail/invite";
import type { OwnOutpost } from "@/game/yard/ownYards";
import { centreWindow, type CentreWindow } from "@/ui/centreWindow";
import { Panel } from "@/ui/Panel";
import { attackStatsRow, attackStatsText } from "@/ui/attackNotice";
import { requestCard, type RequestAction } from "./RequestCard";
import { gmBadge, modBadge } from "./MailToast";
import "@/ui/styles/mail.css";

/**
 * The mailbox screen (#193): the player's threads on the left, the one open
 * on the right, stacked on a phone.
 *
 * - The list is newest first: who, the subject, the last message's first
 *   line, when, and a dot for unread.
 * - A thread reads oldest first, the player's messages on the right. A player
 *   thread has a reply box (580 characters, the server's own limit) and Block
 *   player, which asks once more before it blocks.
 * - The game's notices (an outpost attacked or taken, #187) read as notices:
 *   no reply, no block, and "Show on map" when they name a cell.
 * - New message writes to a friend or a past contact (`friends`), or to the
 *   player the map or the Friends screen opened it for (`openCompose`). A
 *   chat moderator may instead type any player's name or account number
 *   (owner, beta 7; the server's `mail/findplayer`, moderators only), and a
 *   moderator's name carries the light blue Mod badge in the list and thread;
 *   an admin's carries the game team's green GM badge instead, as in chat.
 * - Truces (#203): "Propose truce" in a player thread, or from the map on the
 *   player's yard (`openTruce`, the server's `requesttruce`). The thread's
 *   request carries a card with its state (waiting, active, ended, lapsed,
 *   rejected) and when it ends, and Accept and Reject for its recipient. The
 *   list tags a thread by its truce, as Flash's inbox did.
 * - Invitations to move (#205): from the map, on the player's own outpost or
 *   on another player's yard (`openInvite`), with a box to tick that says the
 *   outpost is replaced. The thread's invitation carries a card: Accept (then
 *   the price), Decline and View on map for the one invited, Withdraw for the
 *   one who invited. The list tags a thread by its invitation.
 *
 * Docked like the Shop and the Monsters screen. The server marks a thread
 * read as it is opened; the screen tells the scene how many threads are still
 * unread (`onUnreadChange`) for the Mail button.
 */

export interface MailboxScreenOptions {
  /** The mail routes; the real ones unless a test swaps them. */
  readonly api?: MailApi;
  /** The signed-in player's id, to tell their messages from the other side's. */
  readonly myId?: () => number | null;
  /** After it closes; `hadFocus` when focus was inside it, so the opener can take it back. */
  readonly onClose?: (hadFocus: boolean) => void;
  /** Threads still unread, after every fetch and every thread opened. */
  readonly onUnreadChange?: (count: number) => void;
  /** A notice's "Show on map". Absent: no such button. */
  readonly onShowOnMap?: (cell: OffsetCell) => void;
  /** Unix seconds; the clock's own unless a test sets it. */
  readonly now?: () => number;
  /** A truce was accepted here: the map's truce marks are out of date (#203). */
  readonly onTruceAccepted?: () => void;
  /** An invitation was accepted here: the main yard is now at `coords` (#205). */
  readonly onInviteAccepted?: (coords: readonly [number, number] | null) => void;
  /** An invitation was sent or withdrawn here: the map's pending marks are out of date (#205). */
  readonly onInviteChanged?: () => void;
  /**
   * An attack notice's Watch (#363): play that defence's replay. Resolves to
   * null once it is on its way, or the words to show instead ("Replay not
   * available after a game update"). Absent: no Watch.
   */
  readonly onWatchDefence?: (id: number) => Promise<string | null>;
  /** An attack notice's Defences: open the Defences screen (#363). Absent: no such button. */
  readonly onOpenDefences?: () => void;
  /**
   * An attack notice's Add friend for the player who did it (friends WP11,
   * #378, `ui/friends/AddFriendButton.ts`). Absent: none. Never on the
   * game's other notices, nor on older notices that name no one.
   */
  readonly addFriend?: (userid: number) => HTMLElement;
  /**
   * The player's friends, offered as recipients beside past contacts: a
   * friend not yet written to has no thread, so the mail targets leave them
   * out. Asked with every refresh; a failure offers past contacts only.
   * Absent: past contacts only.
   */
  readonly friends?: () => Promise<readonly MailContact[]>;
  /** The alliance route for an alliance invite's Accept and Decline (beta 7); the real one unless a test swaps it. */
  readonly allianceApi?: Pick<AllianceApi, "answerInvite">;
  /** An alliance invite was accepted here: the player is in an alliance now (beta 7). */
  readonly onAllianceJoined?: () => void;
}

/** A new message's recipient when the map opened it: the player whose yard it was. */
export interface ComposeTarget {
  readonly userid: number;
  readonly name: string;
}

/** A truce proposed from the map: the player, and the yard it was proposed on (#203). */
export interface TruceTarget extends ComposeTarget {
  readonly baseid: string;
}

/**
 * An invitation to move from the map (#205): to the player whose yard it was,
 * or to a past contact the player picks; onto one of `outposts`, the one shown
 * or one the player picks.
 */
export interface InviteTarget {
  readonly to: ComposeTarget | null;
  readonly outposts: readonly OwnOutpost[];
}

type View =
  | { readonly kind: "none" }
  | { readonly kind: "invite"; readonly target: InviteTarget }
  | { readonly kind: "thread"; readonly thread: MailThread }
  | { readonly kind: "compose"; readonly to: ComposeTarget | null }
  /** A truce proposal: in `thread`, or from the map in a new one. */
  | { readonly kind: "truce"; readonly to: ComposeTarget; readonly via: MailThread | TruceTarget };

type Tone = "info" | "bad";

const LOAD_FAILED = "Could not load your mail. Try again.";
/** Numbers the moderators' suggestion lists, so each has its own id. */
let anyPlayerLists = 0;
const SUBJECT_LIMIT = 60;

/** An alliance invite's state, as its card shows it (beta 7). */
const ALLIANCE_INVITE_LOOK: Readonly<Record<MailAllianceInvite["state"], { label: string; tone: "info" | "good" | "bad" | "muted" }>> = {
  pending: { label: "Waiting for you", tone: "info" },
  accepted: { label: "Accepted", tone: "good" },
  declined: { label: "Declined", tone: "muted" },
  closed: { label: "Closed", tone: "muted" },
};

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const buttonOf = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
  const node = make("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

/**
 * An attack notice's numbers as icons in place of its sentence (less-text job
 * 3): the sentence stays as the tooltip, and the icons carry their words.
 */
const attackText = (text: string, attack: MailAttack): HTMLElement => {
  const node = make("p", "mail-message__text mail-message__text--attack");
  node.title = text;
  node.append(attackStatsRow(attack.stats, attack.realm));
  return node;
};

/** The thread list's preview of an attack notice: its numbers as icons. */
const attackPreview = (attack: MailAttack): HTMLElement => {
  const node = make("span", "mail-row__preview mail-row__preview--attack");
  node.title = attackStatsText(attack.stats, attack.realm);
  node.append(attackStatsRow(attack.stats, attack.realm));
  return node;
};

/** What an attack notice's Watch says while its replay loads. */
const WATCH_LOADING = "Loading…";

export class MailboxScreen {
  readonly element: HTMLElement;

  private readonly api: MailApi;
  /** The alliance route an alliance invite's Accept and Decline call (beta 7). */
  private readonly allianceApi: Pick<AllianceApi, "answerInvite">;
  private readonly myId: () => number | null;
  private readonly now: () => number;
  private readonly options: MailboxScreenOptions;
  private readonly status: HTMLElement;
  private readonly panes: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly pane: HTMLElement;

  private threads: MailThread[] = [];
  private targets: Record<string, MailTarget> = {};
  private friends: readonly MailContact[] = [];
  /** The player is a chat moderator: New message may find any player (`api.status`). */
  private canMailAnyone = false;
  /** The player is the game team (an admin): the compose box shows GM, not Mod. */
  private isGameTeam = false;
  private view: View = { kind: "none" };
  private opened = false;
  private destroyed = false;
  /** Bumped by every fetch, so an answer that arrives late for an old view is dropped. */
  private generation = 0;
  /** The status line says the list could not load: the next good fetch clears it, and nothing else does. */
  private loadFailed = false;

  /** Its place in the middle of the screen, one window at a time (`ui/centreWindow.ts`). */
  private readonly centre: CentreWindow;

  constructor(options: MailboxScreenOptions = {}) {
    this.options = options;
    this.api = options.api ?? mailApi;
    this.allianceApi = options.allianceApi ?? allianceApi;
    this.myId = options.myId ?? (() => getSession()?.userId ?? null);
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));

    // Not Panel's own close, which removes the element for good: the screen
    // opens and closes many times over one scene.
    const panel = new Panel({ title: "Mail", className: "mail-screen", closable: false });
    this.element = panel.element;
    this.centre = centreWindow(this.element, () => this.close());
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        this.close();
      }
    });
    const close = buttonOf("btn btn--ghost btn--icon mail-screen__close", "×", () => this.close());
    close.setAttribute("aria-label", "Close Mail");
    panel.titlebar.append(close);
    this.header = panel.titlebar;

    this.status = make("p", "mail-status");
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.list = make("nav", "mail-list");
    this.list.setAttribute("aria-label", "Your threads");
    const listHead = make("div", "mail-list__head");
    listHead.append(
      tutTarget(
        buttonOf("btn btn--primary mail-list__new", "New message", () => this.openCompose()),
        TutTarget.MAIL_NEW,
      ),
    );
    // The threads themselves, not the list with New message on top: a tip
    // pointing at each must point at two different places (issue #227).
    this.rows = tutTarget(make("ul", "mail-list__rows"), TutTarget.MAIL_THREADS);
    this.list.append(listHead, this.rows);

    this.pane = make("section", "mail-pane");
    this.pane.setAttribute("aria-live", "polite");

    this.panes = make("div", "mail-panes");
    this.panes.append(this.list, this.pane);
    panel.setContent(this.status, this.panes);
  }

  /** The screen's title row, for the tutorial's "?" (issue #227). */
  private header: HTMLElement | null = null;

  get isOpen(): boolean {
    return this.opened;
  }

  /** The threads as the screen last fetched them. */
  get shownThreads(): readonly MailThread[] {
    return this.threads;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** Opens the screen on the thread list, fetched fresh. */
  async open(): Promise<void> {
    if (this.destroyed) return;
    const wasOpen = this.opened;
    this.opened = true;
    this.element.hidden = false;
    this.centre.opened();
    if (!wasOpen) {
      this.view = { kind: "none" };
      this.renderPane();
      this.element.querySelector<HTMLElement>(".mail-screen__close")?.focus();
      guideBus.emit("screen", { id: GuideScreen.MAIL, root: this.element, header: this.header });
    }
    await this.refresh();
  }

  /**
   * Opens a new message, to `to` when the map named the player (their yard's
   * "Message"), else to a past contact the player picks.
   */
  async openCompose(to: ComposeTarget | null = null): Promise<void> {
    if (this.destroyed) return;
    if (!this.opened) {
      this.opened = true;
      this.element.hidden = false;
      this.centre.opened();
      void this.refresh();
    }
    this.view = { kind: "compose", to };
    this.renderList();
    this.renderPane();
    this.pane.querySelector<HTMLElement>(to ? ".mail-compose__subject" : ".mail-compose__to")?.focus();
  }

  /** Opens the screen on one thread (the live mail pop-up's), or on the list if it is gone. */
  async openThreadById(threadid: number): Promise<void> {
    await this.open();
    if (this.destroyed || !this.opened) return;
    const thread = this.threads.find((one) => one.threadid === threadid);
    if (thread) await this.openThread(thread);
  }

  /** Fetches the list again while open (new mail came). The open thread stays as it is. */
  async reload(): Promise<void> {
    if (this.destroyed || !this.opened) return;
    await this.refresh();
  }

  /** Proposes a truce to the owner of a yard the map showed (#203): a new thread. */
  async openTruce(to: TruceTarget): Promise<void> {
    if (this.destroyed) return;
    if (!this.opened) {
      this.opened = true;
      this.element.hidden = false;
      this.centre.opened();
      void this.refresh();
    }
    this.showTruceForm({ userid: to.userid, name: to.name }, to);
  }

  /** Invites a player to move onto one of the player's outposts (#205): a new thread. */
  async openInvite(target: InviteTarget): Promise<void> {
    if (this.destroyed) return;
    if (!this.opened) {
      this.opened = true;
      this.element.hidden = false;
      this.centre.opened();
      void this.refresh();
    }
    this.view = { kind: "invite", target };
    this.renderList();
    this.renderPane();
    this.pane.querySelector<HTMLElement>(target.to ? ".mail-writer__text" : ".mail-compose__to")?.focus();
  }

  close(): void {
    if (!this.opened) return;
    const hadFocus = this.element.contains(document.activeElement);
    this.opened = false;
    this.element.hidden = true;
    this.centre.closed();
    this.setStatus(null);
    this.options.onClose?.(hadFocus);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.element.remove();
  }

  /* ── Fetching ───────────────────────────────────────────────────────── */

  /** The thread list and the names in it, fetched together. */
  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    let wasAnyone = this.canMailAnyone;
    this.list.classList.add("mail-list--loading");
    try {
      const [threads, targets, friends, anyone] = await Promise.all([
        this.api.threads(),
        this.api.targets(),
        this.loadFriends(),
        this.loadCanMailAnyone(),
      ]);
      if (this.destroyed || generation !== this.generation) return;
      this.targets = targets;
      this.friends = friends;
      wasAnyone = this.canMailAnyone;
      this.canMailAnyone = anyone;
      this.threads = threadList(threads, targets);
      if (this.loadFailed) this.setStatus(null);
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      this.setStatus("bad", LOAD_FAILED, () => void this.refresh());
      this.loadFailed = true;
    } finally {
      if (generation === this.generation) this.list.classList.remove("mail-list--loading");
    }
    this.renderList();
    this.reportUnread();
    // A new message opened before the recipients came shows "no one to write to": offer them now.
    const waiting = this.view.kind === "compose" || this.view.kind === "invite";
    if (waiting && !this.pane.querySelector(".mail-compose__to, .mail-compose__fixed")) this.renderPane();
    // A moderator's compose opened before the answer: give it the any-player box.
    else if (this.view.kind === "compose" && !this.view.to && this.canMailAnyone && !wasAnyone) this.renderPane();
  }

  /** Whether the player is a moderator; false when the route is not there or fails. */
  private async loadCanMailAnyone(): Promise<boolean> {
    try {
      const status = await this.api.status?.();
      this.isGameTeam = status?.gm ?? false;
      return status?.mod ?? false;
    } catch {
      return false;
    }
  }

  /** The player's friends as recipients; none when there is no list to ask or it fails. */
  private async loadFriends(): Promise<readonly MailContact[]> {
    try {
      return (await this.options.friends?.()) ?? [];
    } catch {
      return [];
    }
  }

  /** Opens a thread: its messages fetched, which marks it read on the server. */
  private async openThread(thread: MailThread): Promise<void> {
    // A note such as "X is blocked." is done with once another thread opens.
    if (!this.loadFailed) this.setStatus(null);
    this.view = { kind: "thread", thread };
    this.panes.classList.add("mail-panes--open");
    this.renderList();
    this.pane.replaceChildren(make("p", "mail-pane__empty", "Loading…"));
    const generation = ++this.generation;
    try {
      const messages = await this.api.thread(thread.threadid);
      if (this.destroyed || generation !== this.generation) return;
      this.threads = this.threads.map((one) =>
        one.threadid === thread.threadid ? { ...one, unread: false } : one,
      );
      this.renderList();
      this.reportUnread();
      this.renderThread(thread, threadItems(messages, this.myId() ?? -1));
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      this.pane.replaceChildren(make("p", "mail-pane__empty", LOAD_FAILED));
    }
  }

  private reportUnread(): void {
    this.options.onUnreadChange?.(unreadThreads(this.threads));
  }

  /* ── Drawing: the list ──────────────────────────────────────────────── */

  private renderList(): void {
    const now = this.now();
    const open = this.view.kind === "thread" ? this.view.thread.threadid : null;
    if (this.threads.length === 0) {
      this.rows.replaceChildren(make("li", "mail-list__empty", "No messages yet."));
      return;
    }
    this.rows.replaceChildren(
      ...this.threads.map((thread) => {
        const item = document.createElement("li");
        const row = buttonOf("mail-row", "", () => void this.openThread(thread));
        row.dataset["thread"] = String(thread.threadid);
        row.classList.toggle("mail-row--unread", thread.unread);
        row.classList.toggle("mail-row--notice", thread.notice);
        if (thread.threadid === open) row.setAttribute("aria-current", "true");
        const head = make("span", "mail-row__head");
        const who = make("span", "mail-row__name", thread.otherName);
        if (thread.otherGm) who.prepend(gmBadge());
        else if (thread.otherMod) who.prepend(modBadge());
        head.append(who, make("span", "mail-row__time", sentText(thread.time, now)));
        row.append(
          head,
          make("span", "mail-row__subject", thread.subject),
          thread.attack ? attackPreview(thread.attack) : make("span", "mail-row__preview", thread.preview),
        );
        const state = truceState(thread.truce, now);
        const invited = inviteState(thread.invite, now);
        const tags = [state ? truceTag(state) : null, invited ? inviteTag(invited) : null].filter(
          (one): one is { label: string; tone: TruceTone } => one !== null,
        );
        for (const tag of tags) row.append(make("span", `mail-row__truce mail-row__truce--${tag.tone}`, tag.label));
        const said = tags.map((tag) => `${tag.label}. `).join("");
        row.setAttribute(
          "aria-label",
          `${thread.unread ? "Unread. " : ""}${thread.otherGm ? "Game team " : thread.otherMod ? "Moderator " : ""}${thread.otherName}: ${thread.subject}. ${said}${sentText(thread.time, now)}`,
        );
        item.append(row);
        return item;
      }),
    );
  }

  /* ── Drawing: the pane ──────────────────────────────────────────────── */

  private renderPane(): void {
    if (this.view.kind === "compose") {
      this.panes.classList.add("mail-panes--open");
      this.renderCompose(this.view.to);
      return;
    }
    if (this.view.kind === "truce") {
      this.panes.classList.add("mail-panes--open");
      this.renderTruceForm(this.view.to, this.view.via);
      return;
    }
    if (this.view.kind === "invite") {
      this.panes.classList.add("mail-panes--open");
      this.renderInviteForm(this.view.target);
      return;
    }
    if (this.view.kind === "none") {
      this.panes.classList.remove("mail-panes--open");
      this.pane.replaceChildren(make("p", "mail-pane__empty", "Pick a thread to read it."));
    }
  }

  /** The phone's way back to the list. */
  private backButton(): HTMLButtonElement {
    return buttonOf("btn btn--ghost mail-pane__back", "‹ All mail", () => {
      this.view = { kind: "none" };
      this.renderList();
      this.renderPane();
      this.rows.querySelector<HTMLElement>(".mail-row")?.focus();
    });
  }

  private renderThread(thread: MailThread, items: readonly MailItem[]): void {
    const head = make("header", "mail-pane__head");
    const titles = make("div", "mail-pane__titles");
    // A name too long for the pane is cut with "…"; the whole of it shows on hover.
    const name = make("h3", "mail-pane__name mail-pane__name--thread", thread.otherName);
    name.title = thread.otherGm
      ? `The game team: ${thread.otherName}`
      : thread.otherMod
        ? `Moderator ${thread.otherName}`
        : thread.otherName;
    if (thread.otherGm) name.prepend(gmBadge());
    else if (thread.otherMod) name.prepend(modBadge());
    titles.append(name, make("p", "mail-pane__subject", thread.subject));
    const main = make("div", "mail-pane__main");
    main.append(titles);
    head.append(this.backButton(), main);
    const now = this.now();
    const state = truceState(thread.truce, now);
    // The thread's truce belongs to its last request, which carries the card.
    const request = state === null ? -1 : requestIndex(items);
    const until = thread.truce?.until ?? null;
    // Propose truce and Block player keep to a row of their own, which goes
    // under the name and subject when the pane has no room beside them.
    if (!thread.notice && !thread.team) {
      const actions = make("div", "mail-pane__actions");
      if (canPropose(state, until, items[request]?.mine ?? false, now)) {
        actions.append(
          buttonOf("btn btn--outline mail-pane__truce", "Propose truce", () =>
            this.showTruceForm({ userid: thread.otherId, name: thread.otherName }, thread),
          ),
        );
      }
      actions.append(this.blockControl(thread));
      main.append(actions);
    }

    // Likewise the thread's latest invitation to move (#205).
    const invitation = inviteIndex(items);

    const messages = make("ol", "mail-messages");
    items.forEach((item, index) => {
      const side = item.notice ? "notice" : item.mine ? "mine" : "theirs";
      const bubble = make("li", `mail-message mail-message--${side}`);
      // The card names its own kind: no label above it as well.
      if (item.label && index !== request && index !== invitation && !item.allianceInvite) {
        bubble.append(make("strong", "mail-message__label", item.label));
      }
      bubble.append(item.attack ? attackText(item.text, item.attack) : make("p", "mail-message__text", item.text));
      if (index === request && state !== null) {
        const card = truceCard(state, until, item.mine, thread.otherName, now);
        bubble.classList.add("mail-message--request");
        bubble.append(
          requestCard({
            title: "Truce request",
            state: card.label,
            tone: card.tone,
            detail: card.detail,
            ...(card.canAnswer && {
              actions: [
                { label: "Accept", style: "primary", run: () => this.answerTruce(thread, true) },
                { label: "Reject", style: "outline", run: () => this.answerTruce(thread, false) },
              ],
            }),
          }),
        );
      }
      const invite = index === invitation ? this.inviteCardFor(thread, item, now) : null;
      if (invite) {
        bubble.classList.add("mail-message--request");
        bubble.append(invite);
      }
      if (item.allianceInvite) {
        bubble.classList.add("mail-message--request");
        bubble.append(this.allianceCardFor(thread, item.allianceInvite, item.mine));
      }
      bubble.append(make("span", "mail-message__time", sentText(item.time, now)));
      if (item.defenceId !== null) {
        const defence = this.defenceButtons(item.defenceId);
        if (defence) bubble.append(defence);
      }
      if (item.notice && item.byUserId !== null && this.options.addFriend) {
        const friend = make("div", "mail-message__friend");
        friend.append(this.options.addFriend(item.byUserId));
        bubble.append(friend);
      }
      const cell = item.cell;
      if (cell && this.options.onShowOnMap) {
        bubble.append(
          buttonOf("btn btn--outline mail-message__map", `Show on map (${cell.col}, ${cell.row})`, () => {
            this.options.onShowOnMap?.(cell);
          }),
        );
      }
      messages.append(bubble);
    });

    this.pane.replaceChildren(head, messages);
    if (thread.notice) {
      this.pane.append(make("p", "mail-pane__note", "A notice from the game. It cannot be answered."));
    } else if (thread.team && !teamAnswerable(items)) {
      this.pane.append(make("p", "mail-pane__note", "A message from the game team. It cannot be answered."));
    } else {
      this.pane.append(
        this.writer({
          label: "Reply",
          send: async (text) => {
            const result = await this.api.send({
              threadid: thread.threadid,
              targetid: thread.otherId,
              subject: thread.subject,
              message: text,
            });
            if (!result.ok) return result.reason;
            await this.refresh();
            const fresh = this.threads.find((one) => one.threadid === thread.threadid) ?? thread;
            await this.openThread(fresh);
            return null;
          },
        }),
      );
    }
    messages.lastElementChild?.scrollIntoView?.({ block: "nearest" });
  }

  /** Block player: one press asks, the second blocks. */
  private blockControl(thread: MailThread): HTMLElement {
    const control = make("div", "mail-block");
    const ask = buttonOf("btn btn--ghost mail-block__ask", "Block player", () => {
      ask.hidden = true;
      confirm.hidden = false;
      yes.focus();
    });
    const confirm = make("div", "mail-block__confirm");
    confirm.hidden = true;
    confirm.append(make("span", "mail-block__question", `Block ${thread.otherName}? Their threads go, and they cannot write to you.`));
    const yes = buttonOf("btn btn--danger mail-block__yes", "Block", () => void this.block(thread));
    const no = buttonOf("btn btn--ghost mail-block__no", "Cancel", () => {
      confirm.hidden = true;
      ask.hidden = false;
      ask.focus();
    });
    confirm.append(yes, no);
    control.append(ask, confirm);
    return control;
  }

  private async block(thread: MailThread): Promise<void> {
    try {
      await this.api.block(thread.threadid);
    } catch (caught) {
      this.setStatus("bad", blockRefusal(caught));
      return;
    }
    this.setStatus("info", `${thread.otherName} is blocked.`);
    this.view = { kind: "none" };
    this.renderPane();
    await this.refresh();
  }

  /* ── Truces (#203) ──────────────────────────────────────────────────── */

  /**
   * Accept or Reject on a thread's request. Its message is what the reply box
   * holds, else Flash's own words; the thread is then drawn again with the
   * truce's new state. Answers the refusal, if any, for the card to show.
   */
  private async answerTruce(thread: MailThread, accept: boolean): Promise<string | null> {
    const box = this.pane.querySelector<HTMLTextAreaElement>(".mail-writer__text");
    const written = box ? sendable(box.value) : null;
    const result = await this.api.send({
      threadid: thread.threadid,
      targetid: thread.otherId,
      subject: thread.subject,
      message: written ?? (accept ? TRUCE_ACCEPT_TEXT : TRUCE_REJECT_TEXT),
      type: accept ? "truceaccept" : "trucereject",
    });
    if (!result.ok) return result.reason;
    if (this.destroyed) return null;
    if (accept) this.options.onTruceAccepted?.();
    await this.refresh();
    const fresh = this.threads.find((one) => one.threadid === thread.threadid) ?? thread;
    await this.openThread(fresh);
    this.setStatus(
      "info",
      accept
        ? `You have a truce with ${thread.otherName}. Neither of you can attack the other for ${TRUCE_DAYS} days.`
        : `You rejected ${thread.otherName}'s truce.`,
    );
    return null;
  }

  /* ── Invitations to move (#205) ─────────────────────────────────────── */

  /**
   * The card on a thread's invitation: its state and what it means; Accept,
   * Decline and View on map for the one invited while it waits, Withdraw for
   * the one who invited.
   */
  /**
   * A Map Room 2 attack notice's Watch and Defences (#363): Watch plays the
   * defence's replay, or says in its place why it cannot; Defences opens the
   * list of them. Null when the scene offers neither.
   */
  private defenceButtons(id: number): HTMLElement | null {
    const { onWatchDefence, onOpenDefences } = this.options;
    if (!onWatchDefence && !onOpenDefences) return null;
    const row = make("div", "mail-message__defence");
    if (onWatchDefence) {
      const watch = buttonOf("btn btn--primary mail-message__watch", "Watch", () => {
        watch.disabled = true;
        watch.textContent = WATCH_LOADING;
        void onWatchDefence(id).then(
          (refusal) => {
            if (refusal === null) {
              watch.disabled = false;
              watch.textContent = "Watch";
              return;
            }
            watch.replaceWith(make("span", "mail-message__defence-note", refusal));
          },
          () => {
            watch.disabled = false;
            watch.textContent = "Watch";
          },
        );
      });
      row.append(watch);
    }
    if (onOpenDefences) {
      row.append(buttonOf("btn btn--outline mail-message__defences", "Defences", () => onOpenDefences()));
    }
    return row;
  }

  private inviteCardFor(thread: MailThread, item: MailItem, now: number): HTMLElement | null {
    const invite = item.invite;
    const state = inviteState(invite, now);
    if (!invite || !state) return null;
    const card = inviteCard(state, invite.until, item.mine, thread.otherName, invite.cell, now);
    const cell = invite.cell;
    const onShowOnMap = this.options.onShowOnMap;
    const view: RequestAction[] =
      cell && onShowOnMap
        ? [
            {
              label: "View on map",
              style: "outline",
              run: async () => {
                onShowOnMap(cell);
                return null;
              },
            },
          ]
        : [];
    let actions: RequestAction[] = [];
    if (card.canAnswer) {
      actions = [
        {
          label: "Accept",
          style: "primary",
          run: async () => {
            node.replaceWith(this.priceChoice(thread, cell));
            return null;
          },
        },
        { label: "Decline", style: "outline", run: () => this.declineInvite(thread) },
        ...view,
      ];
    } else if (card.canWithdraw) {
      actions = [{ label: "Withdraw", style: "outline", run: () => this.withdrawInvite(thread) }];
    }
    const node = requestCard({
      title: "Invitation to move",
      state: card.label,
      tone: card.tone,
      detail: card.detail,
      ...(actions.length > 0 && { actions }),
    });
    return node;
  }

  /**
   * Accept's second step: how to pay. One press pays and moves; there is no
   * further confirm (the owner's rule). Back draws the thread again, with the
   * invitation's own card.
   */
  private priceChoice(thread: MailThread, cell: OffsetCell | null): HTMLElement {
    const pay = (payment: InvitePayment): RequestAction => ({
      label: `Pay ${invitePriceText(payment)}`,
      style: "primary",
      run: () => this.acceptInvite(thread, payment),
    });
    const choice = requestCard({
      title: "Invitation to move",
      state: "Choose how to pay",
      tone: "info",
      detail:
        `Your main yard moves${cell ? ` to (${cell.col}, ${cell.row})` : ""} at once. ` +
        "Your outposts stay yours, and wild monsters claim your old spot. It cannot be undone.",
      actions: [
        pay("resources"),
        pay("shiny"),
        {
          label: "Back",
          style: "outline",
          run: async () => {
            await this.openThread(thread);
            return null;
          },
        },
      ],
    });
    choice.classList.add("mail-request--price");
    return choice;
  }

  private async acceptInvite(thread: MailThread, payment: InvitePayment): Promise<string | null> {
    const result = await this.api.acceptInvite(thread.threadid, payment);
    if (!result.ok) return result.reason;
    if (this.destroyed) return null;
    this.options.onInviteAccepted?.(result.coords);
    await this.reopen(thread);
    const where = result.coords ? ` to (${result.coords[0]}, ${result.coords[1]})` : "";
    this.setStatus("info", `Your main yard has moved${where}.`);
    return null;
  }

  private async declineInvite(thread: MailThread): Promise<string | null> {
    const result = await this.api.declineInvite(thread.threadid);
    if (!result.ok) return result.reason;
    if (this.destroyed) return null;
    await this.reopen(thread);
    this.setStatus("info", `You declined ${thread.otherName}'s invitation.`);
    return null;
  }

  /** Withdraw: its message is what the reply box holds, else Flash's "Never mind.". */
  private async withdrawInvite(thread: MailThread): Promise<string | null> {
    const box = this.pane.querySelector<HTMLTextAreaElement>(".mail-writer__text");
    const written = box ? sendable(box.value) : null;
    const result = await this.api.send({
      threadid: thread.threadid,
      targetid: thread.otherId,
      subject: thread.subject,
      message: written ?? INVITE_WITHDRAW_TEXT,
      type: "migraterevoke",
    });
    if (!result.ok) return result.reason;
    if (this.destroyed) return null;
    this.options.onInviteChanged?.();
    await this.reopen(thread);
    this.setStatus("info", `You withdrew your invitation to ${thread.otherName}.`);
    return null;
  }

  /**
   * An alliance invite (beta 7): the alliance's shield and name, where the
   * invite stands, and Accept / Decline while it waits for this player.
   */
  private allianceCardFor(thread: MailThread, invite: MailAllianceInvite, mine: boolean): HTMLElement {
    const name = invite.allianceName ?? "an alliance";
    const look = ALLIANCE_INVITE_LOOK[invite.state];
    const id = invite.id;
    const canAnswer = invite.state === "pending" && !mine && id !== null;
    const node = requestCard({
      title: "Alliance invite",
      state: mine && invite.state === "pending" ? "Waiting" : look.label,
      tone: look.tone,
      detail:
        invite.state === "closed"
          ? `The invite to ${name} can no longer be answered.`
          : mine
            ? `You invited ${thread.otherName} to ${name}.`
            : `${thread.otherName} invites you to ${name}.`,
      ...(canAnswer && {
        actions: [
          { label: "Accept", style: "primary", run: () => this.answerAllianceInvite(thread, id, name, true) },
          { label: "Decline", style: "outline", run: () => this.answerAllianceInvite(thread, id, name, false) },
        ],
      }),
    });
    node.classList.add("mail-request--alliance");
    if (invite.allianceImage !== null) {
      const shield = make("img", "mail-request__shield");
      shield.src = shieldUrl(invite.allianceImage, "medium");
      shield.alt = "";
      shield.decoding = "async";
      node.querySelector(".mail-request__head")?.prepend(shield);
    }
    return node;
  }

  private async answerAllianceInvite(thread: MailThread, id: number, name: string, accept: boolean): Promise<string | null> {
    const result = await this.allianceApi.answerInvite(id, accept);
    if (!result.ok) return result.message;
    if (this.destroyed) return null;
    if (accept) this.options.onAllianceJoined?.();
    await this.reopen(thread);
    this.setStatus("info", accept ? `You joined ${name}.` : `You declined the invite to ${name}.`);
    return null;
  }

  /** The list fetched again, and the thread drawn again from it. */
  private async reopen(thread: MailThread): Promise<void> {
    await this.refresh();
    const fresh = this.threads.find((one) => one.threadid === thread.threadid) ?? thread;
    await this.openThread(fresh);
  }

  /**
   * An invitation: to whom, onto which outpost, what it means, the box to tick
   * that says the outpost is replaced, and the message, Flash's own to start
   * from. It starts a new thread.
   */
  private renderInviteForm(target: InviteTarget): void {
    const to = target.to;
    const head = make("header", "mail-pane__head");
    const titles = make("div", "mail-pane__titles");
    titles.append(make("h3", "mail-pane__name", to ? `Invite ${to.name} to move` : "Invite a player to move"));
    head.append(this.backButton(), titles);

    if (target.outposts.length === 0) {
      this.pane.replaceChildren(head, make("p", "mail-pane__empty", "You have no outpost to invite anyone to."));
      return;
    }

    const form = make("div", "mail-compose mail-invite");

    let recipient: () => MailContact | null;
    if (to) {
      form.append(make("p", "mail-compose__fixed", `To ${to.name}`));
      recipient = () => ({ userid: to.userid, name: to.name });
    } else {
      const contacts = contactsOf(this.targets, this.friends);
      if (contacts.length === 0) {
        this.pane.replaceChildren(
          head,
          make(
            "p",
            "mail-pane__empty",
            "You have no one to invite yet. Add friends, or invite a player from their yard's panel on the map.",
          ),
        );
        return;
      }
      const select = make("select", "mail-compose__to");
      select.setAttribute("aria-label", "To");
      for (const contact of contacts) {
        const option = document.createElement("option");
        option.value = String(contact.userid);
        option.textContent = contact.name;
        select.append(option);
      }
      const label = make("label", "mail-compose__field");
      label.append(make("span", "mail-compose__caption", "To"), select);
      form.append(label);
      recipient = () => contacts.find((contact) => String(contact.userid) === select.value) ?? null;
    }

    const outpostName = (one: OwnOutpost): string => `your outpost at (${one.cell.col}, ${one.cell.row})`;
    let outpost: () => OwnOutpost | null;
    const only = target.outposts.length === 1 ? target.outposts[0]! : null;
    if (only) {
      form.append(make("p", "mail-compose__fixed", `Onto ${outpostName(only)}`));
      outpost = () => only;
    } else {
      const select = make("select", "mail-invite__outpost");
      select.setAttribute("aria-label", "Outpost");
      for (const one of target.outposts) {
        const option = document.createElement("option");
        option.value = one.baseid;
        option.textContent = `Outpost at (${one.cell.col}, ${one.cell.row})`;
        select.append(option);
      }
      const label = make("label", "mail-compose__field");
      label.append(make("span", "mail-compose__caption", "Onto"), select);
      form.append(label);
      outpost = () => target.outposts.find((one) => one.baseid === select.value) ?? null;
    }

    form.append(
      make(
        "p",
        "mail-truce__about",
        `If they accept, their main yard moves onto the outpost, for ${invitePriceText("resources")} or ` +
          `${invitePriceText("shiny")}, which they pay. They must not be in an alliance. ` +
          `They have ${INVITE_DAYS} days to answer, and you can withdraw it until then.`,
      ),
    );

    const confirm = make("input", "mail-invite__confirm");
    confirm.type = "checkbox";
    const confirmLabel = make("label", "mail-invite__warning");
    confirmLabel.append(confirm, make("span", "", INVITE_WARNING));
    form.append(confirmLabel);

    form.append(
      this.writer({
        label: "Send invitation",
        initial: INVITE_TEXT,
        send: async (text) => {
          const who = recipient();
          const where = outpost();
          if (!who) return "Pick who to invite.";
          if (!where) return "Pick the outpost.";
          if (!confirm.checked) return "Tick the box first: the outpost is replaced if they accept.";
          const result = await this.api.send({
            threadid: 0,
            targetid: who.userid,
            subject: INVITE_SUBJECT,
            message: text,
            type: "migraterequest",
            baseid: where.baseid,
          });
          if (!result.ok) return result.reason;
          this.options.onInviteChanged?.();
          await this.refresh();
          const sent = this.threads.find((one) => one.threadid === result.threadid);
          if (sent) {
            await this.openThread(sent);
          } else {
            this.view = { kind: "none" };
            this.renderPane();
          }
          this.setStatus("info", `Invitation sent to ${who.name}.`);
          return null;
        },
      }),
    );
    this.pane.replaceChildren(head, form);
  }

  private showTruceForm(to: ComposeTarget, via: MailThread | TruceTarget): void {
    this.view = { kind: "truce", to, via };
    this.renderList();
    this.renderPane();
    this.pane.querySelector<HTMLElement>(".mail-writer__text")?.focus();
  }

  /**
   * A truce proposal: what it means, and the message that goes with it, Flash's
   * own words to start from. In a thread it goes into the thread; from the map
   * it starts a new one (`requesttruce`).
   */
  private renderTruceForm(to: ComposeTarget, via: MailThread | TruceTarget): void {
    const inThread = "threadid" in via;
    const head = make("header", "mail-pane__head");
    const titles = make("div", "mail-pane__titles");
    titles.append(make("h3", "mail-pane__name", `Propose a truce to ${to.name}`));
    head.append(this.backButton(), titles);

    const form = make("div", "mail-compose mail-truce");
    form.append(
      make(
        "p",
        "mail-truce__about",
        `If ${to.name} accepts, neither of you can attack the other's yards or outposts for ${TRUCE_DAYS} days. ` +
          `They have ${REQUEST_DAYS} days to answer.`,
      ),
    );
    form.append(
      this.writer({
        label: "Send request",
        initial: TRUCE_REQUEST_TEXT,
        send: async (text) => {
          const result = inThread
            ? await this.api.send({
                threadid: via.threadid,
                targetid: to.userid,
                subject: via.subject,
                message: text,
                type: "trucerequest",
              })
            : await this.api.requestTruce(via.baseid, text);
          if (!result.ok) return result.reason;
          await this.refresh();
          // An older server answers `requesttruce` with no thread id: the newest thread with them is it.
          const sent =
            this.threads.find((one) => one.threadid === (inThread ? via.threadid : result.threadid)) ??
            this.threads.find((one) => one.otherId === to.userid);
          if (sent) {
            await this.openThread(sent);
          } else {
            this.view = { kind: "none" };
            this.renderPane();
          }
          this.setStatus("info", `Truce request sent to ${to.name}.`);
          return null;
        },
      }),
    );
    if (inThread) {
      form.append(buttonOf("btn btn--ghost mail-truce__cancel", "Cancel", () => void this.openThread(via)));
    }
    this.pane.replaceChildren(head, form);
  }

  /** A new message: to whom, a subject, the text. */
  private renderCompose(to: ComposeTarget | null): void {
    const head = make("header", "mail-pane__head");
    const titles = make("div", "mail-pane__titles");
    titles.append(make("h3", "mail-pane__name", "New message"));
    head.append(this.backButton(), titles);

    const form = make("div", "mail-compose");
    /** The recipient, or what to say when there is none. */
    let recipient: () => Promise<MailContact | string>;
    if (to) {
      form.append(make("p", "mail-compose__fixed", `To ${to.name}`));
      recipient = async () => ({ userid: to.userid, name: to.name });
    } else if (this.canMailAnyone) {
      const field = this.anyPlayerField(contactsOf(this.targets, this.friends));
      form.append(field.element);
      recipient = field.recipient;
    } else {
      const contacts = contactsOf(this.targets, this.friends);
      if (contacts.length === 0) {
        this.pane.replaceChildren(
          head,
          make(
            "p",
            "mail-pane__empty",
            "You have no one to write to yet. Add friends, or open a player's yard panel on the map and press Message.",
          ),
        );
        return;
      }
      const select = make("select", "mail-compose__to");
      select.setAttribute("aria-label", "To");
      for (const contact of contacts) {
        const option = document.createElement("option");
        option.value = String(contact.userid);
        option.textContent = contact.name;
        select.append(option);
      }
      const label = make("label", "mail-compose__field");
      label.append(make("span", "mail-compose__caption", "To"), select);
      form.append(label);
      recipient = async () =>
        contacts.find((contact) => String(contact.userid) === select.value) ?? "Pick who to write to.";
    }

    const subject = make("input", "mail-compose__subject");
    subject.maxLength = SUBJECT_LIMIT;
    subject.placeholder = NO_SUBJECT;
    subject.setAttribute("aria-label", "Subject");
    const subjectLabel = make("label", "mail-compose__field");
    subjectLabel.append(make("span", "mail-compose__caption", "Subject"), subject);
    form.append(subjectLabel);

    form.append(
      this.writer({
        label: "Send",
        send: async (text) => {
          const to = await recipient();
          if (typeof to === "string") return to;
          const result = await this.api.send({
            threadid: 0,
            targetid: to.userid,
            subject: subject.value.trim() || NO_SUBJECT,
            message: text,
          });
          if (!result.ok) return result.reason;
          await this.refresh();
          const sent = this.threads.find((one) => one.threadid === result.threadid);
          if (sent) {
            await this.openThread(sent);
          } else {
            this.view = { kind: "none" };
            this.renderPane();
          }
          this.setStatus("info", `Sent to ${to.name}.`);
          return null;
        },
      }),
    );
    this.pane.replaceChildren(head, form);
  }

  /**
   * A moderator's To (owner, beta 7): any player's name or account number,
   * past contacts offered as they type. A contact's name is taken as it is;
   * anything else is looked up on the server, which checks the moderators
   * list again.
   */
  private anyPlayerField(contacts: readonly MailContact[]): {
    element: HTMLElement;
    recipient: () => Promise<MailContact | string>;
  } {
    const input = make("input", "mail-compose__to mail-compose__any");
    input.type = "text";
    input.maxLength = 40;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "Name or #number";
    input.setAttribute("aria-label", "To: any player, by name or account number");
    const label = make("label", "mail-compose__field");
    const caption = make("span", "mail-compose__caption", "To");
    const hint = this.isGameTeam ? gmBadge() : modBadge();
    hint.title = this.isGameTeam
      ? "As the game team you can write to any player"
      : "As a moderator you can write to any player";
    caption.append(" ", hint);
    label.append(caption, input);
    if (contacts.length > 0) {
      const list = make("datalist", "mail-compose__suggest");
      list.id = `mail-any-${++anyPlayerLists}`;
      for (const contact of contacts) {
        const option = document.createElement("option");
        option.value = contact.name;
        list.append(option);
      }
      input.setAttribute("list", list.id);
      label.append(list);
    }
    const recipient = async (): Promise<MailContact | string> => {
      const text = input.value.trim();
      if (text === "") return "Type a player's name or account number.";
      const known = contacts.find((contact) => contact.name.toLowerCase() === text.toLowerCase());
      if (known) return known;
      if (!this.api.findPlayer) return "No player has that name or number.";
      const found = await this.api.findPlayer(text);
      return found.ok ? { userid: found.userid, name: found.name } : found.reason;
    };
    return { element: label, recipient };
  }

  /**
   * A message box with its counter and send button. `send` answers null once
   * the message went, or what to say when it did not. `initial` fills the box to start with.
   */
  private writer(options: {
    label: string;
    initial?: string;
    send: (text: string) => Promise<string | null>;
  }): HTMLElement {
    const box = make("div", "mail-writer");
    const text = make("textarea", "mail-writer__text");
    text.maxLength = MESSAGE_LIMIT;
    text.rows = 3;
    text.setAttribute("aria-label", options.label === "Reply" ? "Your reply" : "Your message");
    const counter = make("span", "mail-writer__counter", counterText(""));
    const refusal = make("p", "mail-writer__refusal");
    refusal.setAttribute("role", "alert");
    refusal.hidden = true;
    const send = buttonOf("btn btn--primary mail-writer__send", options.label, () => void submit());
    send.disabled = true;

    const sync = (): void => {
      counter.textContent = counterText(text.value);
      send.disabled = sendable(text.value) === null;
    };
    text.addEventListener("input", sync);
    text.value = options.initial ?? "";
    sync();

    const submit = async (): Promise<void> => {
      const message = sendable(text.value);
      if (message === null || send.disabled) return;
      send.disabled = true;
      text.disabled = true;
      refusal.hidden = true;
      const reason = await options.send(message);
      if (this.destroyed) return;
      text.disabled = false;
      if (reason === null) {
        text.value = "";
      } else {
        refusal.textContent = reason;
        refusal.hidden = false;
      }
      sync();
    };

    const foot = make("div", "mail-writer__foot");
    foot.append(counter, send);
    box.append(text, refusal, foot);
    return box;
  }

  private setStatus(tone: Tone | null, text = "", retry?: () => void): void {
    this.loadFailed = false;
    this.status.hidden = tone === null;
    this.status.className = tone ? `mail-status mail-status--${tone}` : "mail-status";
    this.status.replaceChildren(text);
    if (retry) this.status.append(" ", buttonOf("btn btn--ghost mail-status__retry", "Try again", retry));
  }
}
