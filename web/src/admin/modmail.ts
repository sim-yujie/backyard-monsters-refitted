import {
  fetchModConversation,
  fetchModConversations,
  type ModConversation,
  type ModConversationMessage,
  type ModConversationSummary,
  type ModMailSearch,
} from "./api";
import { h, replace } from "./dom";
import { ago, count, dateTime } from "./format";
import { icon } from "./icons";
import { errorWords } from "./shiny";

/**
 * The Moderator mail section (owner, beta 7; conversations 8 Nov: "normally
 * its a conversation between mod and player rather than a single email"):
 * one row per conversation a moderator is in, the one with the newest
 * message first, so the owner can check none is abused. Opening a row shows
 * the whole conversation as a chat, both sides in order, kept even when the
 * players delete the thread. Search by moderator or player (a name, part of
 * one, or an account number); "Load more" pages back. Admin only: moderators
 * never see this.
 */

export interface ModMailOptions {
  say(message: string): void;
  /** Called when the section switches between the list and an open conversation (its height changes). */
  onViewChange?(): void;
}

/** A subject without a leading "Re: " (any number), for comparing. */
const bareSubject = (subject: string): string => subject.replace(/^(\s*re:\s*)+/i, "").trim().toLowerCase();

/** The subject a thread is known by: the first message that has one. */
const threadSubject = (conversation: ModConversation): string =>
  conversation.messages.find((message) => message.subject.trim())?.subject.trim() ?? "";

/** What a message's kind reads as, when it is not plain mail. */
const KIND_WORDS: Record<string, string> = {
  trucerequest: "Truce request",
  truceaccept: "Truce accepted",
  trucereject: "Truce rejected",
  migraterequest: "Invitation",
  migraterevoke: "Invitation withdrawn",
};

export class ModMailSection {
  readonly element = h("div", { class: "modmail" });
  private readonly moderatorInput = searchBox("modmail-moderator", "Moderator");
  private readonly recipientInput = searchBox("modmail-recipient", "Player");
  private readonly list = h("div", { class: "modmail-list" }, h("div", { class: "skeleton" }));
  private readonly more = h("button", { class: "button quiet modmail-more", attrs: { type: "button", hidden: "" } }, "Load more");
  /** The list, its search and Load more: hidden while a conversation is open. */
  private readonly listView = h("div", { class: "modmail-view" });
  /** One open conversation. */
  private readonly openView = h("div", { class: "modmail-view modmail-open", attrs: { hidden: "" } });
  private conversations: ModConversationSummary[] = [];
  private next: number | null = null;
  /** The search the list shows. */
  private search: ModMailSearch = {};
  /** Bumped by each new search, so a slow older answer is dropped. */
  private asked = 0;
  /** The open conversation's thread, or null for the list. */
  private openThread: number | null = null;
  /** Bumped by each conversation opened, so a slow older answer is dropped. */
  private opened = 0;

  constructor(private readonly options: ModMailOptions) {
    const form = h(
      "form",
      { class: "group finder modmail-search", attrs: { novalidate: "", role: "search" } },
      h(
        "div",
        { class: "modmail-search__row" },
        h("label", { class: "field-label", attrs: { for: "modmail-moderator" } }, "Moderator"),
        this.moderatorInput,
        h("label", { class: "field-label", attrs: { for: "modmail-recipient" } }, "Player"),
        this.recipientInput,
        h("button", { class: "button primary", attrs: { type: "submit" } }, "Search"),
      ),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.find();
    });
    this.more.addEventListener("click", () => void this.loadMore());
    replace(
      this.listView,
      h(
        "p",
        { class: "lede" },
        "Every conversation a moderator had with a player, both sides, kept even if they delete it. Search by a name or account number.",
      ),
      form,
      this.list,
      this.more,
    );
    replace(this.element, this.listView, this.openView);
  }

  /** Loads the first page again with the boxes' search, and the open conversation (the page's refresh). */
  async refresh(): Promise<void> {
    await Promise.all([this.find(), this.openThread !== null ? this.load(this.openThread) : null]);
  }

  private async find(): Promise<void> {
    this.search = {
      moderator: this.moderatorInput.value.trim() || undefined,
      recipient: this.recipientInput.value.trim() || undefined,
    };
    const asked = ++this.asked;
    try {
      const page = await fetchModConversations(this.search);
      if (asked !== this.asked) return;
      this.conversations = page.conversations;
      this.next = page.next;
    } catch (err) {
      if (asked !== this.asked) return;
      this.conversations = [];
      this.next = null;
      this.more.hidden = true;
      replace(this.list, h("p", { class: "note" }, `Could not load moderator mail: ${errorWords(err)}`));
      return;
    }
    this.render();
  }

  private async loadMore(): Promise<void> {
    if (this.next === null) return;
    const asked = this.asked;
    this.more.disabled = true;
    try {
      const page = await fetchModConversations({ ...this.search, before: this.next });
      if (asked !== this.asked) return;
      this.conversations = [...this.conversations, ...page.conversations];
      this.next = page.next;
      this.render();
    } catch (err) {
      this.options.say(`Could not load more moderator mail: ${errorWords(err)}`);
    } finally {
      this.more.disabled = false;
    }
  }

  private render(): void {
    this.more.hidden = this.next === null;
    if (this.conversations.length === 0) {
      const searching = this.search.moderator || this.search.recipient;
      replace(this.list, h("p", { class: "note" }, searching ? "No moderator mail matches." : "No moderator mail yet."));
      return;
    }
    replace(
      this.list,
      h(
        "ul",
        { class: "rows" },
        ...this.conversations.map((conversation) =>
          h("li", {}, conversationRow(conversation, () => void this.open(conversation.threadid))),
        ),
      ),
    );
  }

  /** Shows one conversation in place of the list. */
  private async open(threadid: number): Promise<void> {
    this.openThread = threadid;
    this.listView.hidden = true;
    this.openView.hidden = false;
    this.options.onViewChange?.();
    replace(this.openView, this.backButton(), h("div", { class: "skeleton" }));
    this.openView.querySelector<HTMLButtonElement>(".back")?.focus();
    await this.load(threadid);
  }

  private async load(threadid: number): Promise<void> {
    const opened = ++this.opened;
    try {
      const { conversation } = await fetchModConversation(threadid);
      if (opened !== this.opened || this.openThread !== threadid) return;
      replace(this.openView, this.backButton(), conversationView(conversation));
      this.options.onViewChange?.();
    } catch (err) {
      if (opened !== this.opened || this.openThread !== threadid) return;
      replace(
        this.openView,
        this.backButton(),
        h("p", { class: "note" }, `Could not load this conversation: ${errorWords(err)}`),
      );
    }
  }

  /** Back to the list as it was, the row just read in focus. */
  private close(): void {
    const threadid = this.openThread;
    this.openThread = null;
    this.opened++;
    this.openView.hidden = true;
    this.listView.hidden = false;
    replace(this.openView);
    this.options.onViewChange?.();
    this.list.querySelector<HTMLButtonElement>(`[data-thread="${threadid}"]`)?.focus();
  }

  private backButton(): HTMLElement {
    return h(
      "button",
      { class: "button quiet back", attrs: { type: "button" }, onClick: () => this.close() },
      icon("back", 18),
      "All conversations",
    );
  }
}

const searchBox = (id: string, label: string): HTMLInputElement =>
  h("input", {
    class: "field-input",
    attrs: {
      id,
      type: "search",
      autocomplete: "off",
      spellcheck: "false",
      maxlength: "40",
      placeholder: "Name or #number",
      "aria-label": `${label}: name or account number`,
    },
  });

/** "Mod" chip, the moderator, an arrow, the player: who the conversation is between. */
const between = (moderatorId: number, moderatorName: string, playerId: number, playerName: string): HTMLElement =>
  h(
    "span",
    { class: "modmail-between" },
    h("span", { class: "chip chip-info chat-gm", attrs: { title: "Moderator" } }, "Mod"),
    h("span", { class: "modmail-who", attrs: { title: `#${moderatorId}` } }, moderatorName),
    h("span", { class: "modmail-arrow", attrs: { "aria-label": "with" } }, "→"),
    h("span", { class: "modmail-who", attrs: { title: `#${playerId}` } }, playerName),
  );

const messagesWord = (n: number): string => (n === 1 ? "1 message" : `${count(n)} messages`);

/** One conversation in the list: who, how many messages, when the last was, and a line of it. */
const conversationRow = (conversation: ModConversationSummary, onOpen: () => void): HTMLElement => {
  const lastBy = conversation.lastSender === "player" ? conversation.playerName : conversation.moderatorName;
  const kind = KIND_WORDS[conversation.lastType];
  const preview = conversation.lastMessage.replace(/\s+/g, " ").trim() || conversation.lastSubject || "(no text)";
  const fromPlayer = conversation.messages - conversation.fromModerator;
  return h(
    "button",
    {
      class: "row modmail-convo",
      attrs: { type: "button", "data-thread": String(conversation.threadid) },
      onClick: onOpen,
    },
    h(
      "span",
      { class: "modmail-convo__head" },
      between(conversation.moderatorId, conversation.moderatorName, conversation.playerId, conversation.playerName),
      h(
        "time",
        { class: "chat-time", attrs: { datetime: conversation.lastAt, title: dateTime(conversation.lastAt) } },
        ago(conversation.lastAt),
      ),
    ),
    h(
      "span",
      { class: "modmail-convo__preview" },
      h("span", { class: "modmail-convo__by" }, `${lastBy}: `),
      kind ? `${kind} · ${preview}` : preview,
    ),
    h(
      "span",
      { class: "row-meta" },
      [
        messagesWord(conversation.messages),
        `${count(conversation.fromModerator)} from the moderator, ${count(fromPlayer)} from the player`,
        `started ${ago(conversation.startedAt)}`,
      ].join(" · "),
    ),
    icon("chevron", 18),
  );
};

/** One conversation whole: who, then every message as a chat, the moderator on the right. */
const conversationView = (conversation: ModConversation): HTMLElement => {
  const answered = conversation.messages.some((message) => message.sender === "player");
  const subject = threadSubject(conversation);
  return h(
    "article",
    { class: "modmail-thread" },
    h(
      "header",
      { class: "modmail-thread__head" },
      h(
        "h3",
        { class: "modmail-thread__title" },
        between(conversation.moderatorId, conversation.moderatorName, conversation.playerId, conversation.playerName),
      ),
      subject ? h("p", { class: "modmail-thread__subject" }, subject) : null,
      h(
        "span",
        { class: "row-meta" },
        [
          `#${conversation.moderatorId} and #${conversation.playerId}`,
          messagesWord(conversation.messages.length),
          `thread ${conversation.threadid}`,
        ].join(" · "),
      ),
    ),
    h(
      "ol",
      { class: "thread", attrs: { "aria-label": `Messages between ${conversation.moderatorName} and ${conversation.playerName}` } },
      ...conversation.messages.map((message) => bubble(message, subject)),
    ),
    conversation.cut ? h("p", { class: "note" }, "Only the first messages are shown: this conversation is very long.") : null,
    answered
      ? null
      : h(
          "p",
          { class: "note" },
          "No answer from the player is logged. Answers sent before the log kept both sides are not in it.",
        ),
  );
};

/** One message: who and when, its kind and subject, the words, and what was typed if the word filter changed it. */
const bubble = (message: ModConversationMessage, threadSubjectText: string): HTMLElement => {
  const own = message.subject.trim();
  const showSubject = own !== "" && bareSubject(own) !== bareSubject(threadSubjectText);
  const byModerator = message.sender === "moderator";
  const kind = KIND_WORDS[message.messagetype];
  return h(
    "li",
    { class: `bubble modmail-bubble ${byModerator ? "bubble-mod" : "bubble-player"}` },
    h(
      "span",
      { class: "bubble-who" },
      byModerator ? h("span", { class: "chip chip-info chat-gm", attrs: { title: "Moderator" } }, "Mod") : null,
      h("span", { attrs: { title: `#${message.senderId}` } }, message.senderName),
      " · ",
      h("time", { attrs: { datetime: message.sentAt, title: dateTime(message.sentAt) } }, ago(message.sentAt)),
      kind ? h("span", { class: "chip" }, kind) : null,
      message.newThread ? h("span", { class: "modmail-started" }, "started the conversation") : null,
    ),
    showSubject ? h("span", { class: "modmail-subject" }, own) : null,
    h("span", { class: "bubble-text" }, message.message),
    message.written !== null
      ? h("span", { class: "modmail-written" }, h("span", { class: "chip chip-warn" }, "Written as"), " ", message.written)
      : null,
  );
};
