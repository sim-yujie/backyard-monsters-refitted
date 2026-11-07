import { fetchModMail, type ModMailSearch, type ModMailView } from "./api";
import { h, replace } from "./dom";
import { ago, dateTime } from "./format";
import { errorWords } from "./shiny";

/**
 * The Moderator mail section (owner, beta 7): every message a moderator sent
 * to a player, newest first, so the owner can check none is abused. Kept
 * even when the players delete the thread. Search by moderator or recipient
 * (a name, part of one, or an account number); "Load more" pages back.
 * Admin only: moderators never see this.
 */

export interface ModMailOptions {
  say(message: string): void;
}

/** What a message's kind reads as, when it is not plain mail. */
const KIND_WORDS: Record<string, string> = {
  trucerequest: "Truce request",
  truceaccept: "Truce accepted",
  trucereject: "Truce rejected",
};

export class ModMailSection {
  readonly element = h("div", { class: "modmail" });
  private readonly moderatorInput = searchBox("modmail-moderator", "Moderator");
  private readonly recipientInput = searchBox("modmail-recipient", "Player");
  private readonly list = h("div", { class: "modmail-list" }, h("div", { class: "skeleton" }));
  private readonly more = h("button", { class: "button quiet modmail-more", attrs: { type: "button", hidden: "" } }, "Load more");
  private mails: ModMailView[] = [];
  private next: number | null = null;
  /** The search the list shows. */
  private search: ModMailSearch = {};
  /** Bumped by each new search, so a slow older answer is dropped. */
  private asked = 0;

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
      this.element,
      h(
        "p",
        { class: "lede" },
        "Every message a moderator sent a player, kept even if they delete it. Search by a name or account number.",
      ),
      form,
      this.list,
      this.more,
    );
  }

  /** Loads the first page again with the boxes' search (the page's refresh). */
  async refresh(): Promise<void> {
    await this.find();
  }

  private async find(): Promise<void> {
    this.search = {
      moderator: this.moderatorInput.value.trim() || undefined,
      recipient: this.recipientInput.value.trim() || undefined,
    };
    const asked = ++this.asked;
    try {
      const page = await fetchModMail(this.search);
      if (asked !== this.asked) return;
      this.mails = page.mails;
      this.next = page.next;
    } catch (err) {
      if (asked !== this.asked) return;
      this.mails = [];
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
      const page = await fetchModMail({ ...this.search, before: this.next });
      if (asked !== this.asked) return;
      this.mails = [...this.mails, ...page.mails];
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
    if (this.mails.length === 0) {
      const searching = this.search.moderator || this.search.recipient;
      replace(this.list, h("p", { class: "note" }, searching ? "No moderator mail matches." : "No moderator mail yet."));
      return;
    }
    replace(this.list, h("ul", { class: "rows" }, ...this.mails.map((mail) => h("li", {}, mailRow(mail)))));
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

/** One message: when, who to whom, the subject and the words (and what the moderator typed, if the filter changed it). */
const mailRow = (mail: ModMailView): HTMLElement => {
  const kind = KIND_WORDS[mail.messagetype];
  return h(
    "article",
    { class: "row modmail-row" },
    h(
      "div",
      { class: "modmail-row__head" },
      h(
        "span",
        { class: "row-title" },
        h("span", { class: "chip chip-info chat-gm", attrs: { title: "Moderator" } }, "Mod"),
        h("span", { class: "modmail-row__who", attrs: { title: `#${mail.moderatorId}` } }, mail.moderatorName),
        h("span", { class: "modmail-row__arrow", attrs: { "aria-label": "to" } }, "→"),
        h("span", { class: "modmail-row__who", attrs: { title: `#${mail.recipientId}` } }, mail.recipientName),
      ),
      h("time", { class: "chat-time", attrs: { datetime: mail.sentAt, title: dateTime(mail.sentAt) } }, ago(mail.sentAt)),
    ),
    h(
      "span",
      { class: "row-meta" },
      [`#${mail.moderatorId} → #${mail.recipientId}`, mail.newThread ? "new thread" : "reply", kind ?? null, `thread ${mail.threadid}`]
        .filter(Boolean)
        .join(" · "),
    ),
    mail.subject ? h("p", { class: "modmail-row__subject" }, mail.subject) : null,
    h("p", { class: "modmail-row__text" }, mail.message),
    mail.written !== null
      ? h(
          "p",
          { class: "modmail-row__written" },
          h("span", { class: "chip chip-warn" }, "Written as"),
          " ",
          mail.written,
        )
      : null,
  );
};
