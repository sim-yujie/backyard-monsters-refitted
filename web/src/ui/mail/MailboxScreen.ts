import { tutTarget, TutTarget } from "@/game/guide/targets";
import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import { getSession } from "@/api/auth";
import { mailApi, type InvitePayment, type MailApi, type MailTarget } from "@/api/mail";
import type { OffsetCell } from "@/game/HexGrid";
import {
  contactsOf,
  counterText,
  MESSAGE_LIMIT,
  NO_SUBJECT,
  sendable,
  sentText,
  threadItems,
  threadList,
  unreadThreads,
  type MailContact,
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
import { Panel } from "@/ui/Panel";
import { requestCard, type RequestAction } from "./RequestCard";
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
 * - New message writes to a past contact, or to the player whose yard the map
 *   opened it from (`openCompose`). There is no player search: the server has
 *   no route for one.
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
const SUBJECT_LIMIT = 60;

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

export class MailboxScreen {
  readonly element: HTMLElement;

  private readonly api: MailApi;
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
  private view: View = { kind: "none" };
  private opened = false;
  private destroyed = false;
  /** Bumped by every fetch, so an answer that arrives late for an old view is dropped. */
  private generation = 0;
  /** The status line says the list could not load: the next good fetch clears it, and nothing else does. */
  private loadFailed = false;

  constructor(options: MailboxScreenOptions = {}) {
    this.options = options;
    this.api = options.api ?? mailApi;
    this.myId = options.myId ?? (() => getSession()?.userId ?? null);
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));

    // Not Panel's own close, which removes the element for good: the screen
    // opens and closes many times over one scene.
    const panel = new Panel({ title: "Mail", className: "mail-screen", closable: false });
    this.element = panel.element;
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
    tutTarget(this.list, TutTarget.MAIL_THREADS);
    const listHead = make("div", "mail-list__head");
    listHead.append(
      tutTarget(
        buttonOf("btn btn--primary mail-list__new", "New message", () => this.openCompose()),
        TutTarget.MAIL_NEW,
      ),
    );
    this.rows = make("ul", "mail-list__rows");
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
      void this.refresh();
    }
    this.view = { kind: "compose", to };
    this.renderList();
    this.renderPane();
    this.pane.querySelector<HTMLElement>(to ? ".mail-compose__subject" : ".mail-compose__to")?.focus();
  }

  /** Proposes a truce to the owner of a yard the map showed (#203): a new thread. */
  async openTruce(to: TruceTarget): Promise<void> {
    if (this.destroyed) return;
    if (!this.opened) {
      this.opened = true;
      this.element.hidden = false;
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
    this.list.classList.add("mail-list--loading");
    try {
      const [threads, targets] = await Promise.all([this.api.threads(), this.api.targets()]);
      if (this.destroyed || generation !== this.generation) return;
      this.targets = targets;
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
        head.append(make("span", "mail-row__name", thread.otherName), make("span", "mail-row__time", sentText(thread.time, now)));
        row.append(
          head,
          make("span", "mail-row__subject", thread.subject),
          make("span", "mail-row__preview", thread.preview),
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
          `${thread.unread ? "Unread. " : ""}${thread.otherName}: ${thread.subject}. ${said}${sentText(thread.time, now)}`,
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
    titles.append(make("h3", "mail-pane__name", thread.otherName), make("p", "mail-pane__subject", thread.subject));
    head.append(this.backButton(), titles);
    const now = this.now();
    const state = truceState(thread.truce, now);
    // The thread's truce belongs to its last request, which carries the card.
    const request = state === null ? -1 : requestIndex(items);
    const until = thread.truce?.until ?? null;
    if (!thread.notice && canPropose(state, until, items[request]?.mine ?? false, now)) {
      head.append(
        buttonOf("btn btn--outline mail-pane__truce", "Propose truce", () =>
          this.showTruceForm({ userid: thread.otherId, name: thread.otherName }, thread),
        ),
      );
    }
    if (!thread.notice) head.append(this.blockControl(thread));

    // Likewise the thread's latest invitation to move (#205).
    const invitation = inviteIndex(items);

    const messages = make("ol", "mail-messages");
    items.forEach((item, index) => {
      const side = item.notice ? "notice" : item.mine ? "mine" : "theirs";
      const bubble = make("li", `mail-message mail-message--${side}`);
      if (item.label && index !== request && index !== invitation) {
        bubble.append(make("strong", "mail-message__label", item.label));
      }
      bubble.append(make("p", "mail-message__text", item.text));
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
      bubble.append(make("span", "mail-message__time", sentText(item.time, now)));
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
    } catch {
      this.setStatus("bad", "Could not block that player. Try again.");
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
      const contacts = contactsOf(this.targets);
      if (contacts.length === 0) {
        this.pane.replaceChildren(
          head,
          make(
            "p",
            "mail-pane__empty",
            "You have no one to invite yet. Invite a player from their yard's panel on the map, or write to them first.",
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
    let recipient: () => MailContact | null;
    if (to) {
      form.append(make("p", "mail-compose__fixed", `To ${to.name}`));
      recipient = () => ({ userid: to.userid, name: to.name });
    } else {
      const contacts = contactsOf(this.targets);
      if (contacts.length === 0) {
        this.pane.replaceChildren(
          head,
          make(
            "p",
            "mail-pane__empty",
            "You have no one to write to yet. To write to a player, open their yard's panel on the map and press Message.",
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
          const to = recipient();
          if (!to) return "Pick who to write to.";
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
