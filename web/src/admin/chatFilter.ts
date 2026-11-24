import { addWatchWord, fetchWatchWords, removeWatchWord, type WatchKind, type WatchWordView } from "./api";
import { h, replace } from "./dom";
import { icon } from "./icons";
import { errorWords } from "./shiny";

/**
 * The Chat filter tab (owner, 24 Nov 2026, desk pick "dashboard A"): the
 * chat filter's watched words in two cards, "Always watched" and "Only next
 * to these words", each word with how many lines had it in the last 7 days.
 * A change reaches the chat server at once (and within a minute at worst):
 * no restart, no release. The rules themselves (links, new players) are in
 * the server (`services/chat/chatFilter.ts`); only the words are edited here.
 */

export interface ChatFilterOptions {
  say(message: string): void;
}

export const CHAT_FILTER_TEXT = {
  live: "Live · changes apply within 1 min",
  alwaysTitle: "Always watched",
  alwaysLede: "A new player's line (yard under 3 days) with one of these is hidden from everyone else; older players' lines still post. Both are flagged to moderators.",
  nearTitle: "Only next to these words",
  nearLede: "“FB” alone is mostly nostalgia, so it only counts right beside a context word, either side.",
  nextTo: "next to",
  placeholder: "Word or phrase",
  oneWord: "One word",
  add: "Add",
  hits: (n: number, days: number) => `${n} ${n === 1 ? "hit" : "hits"} in ${days} days`,
  empty: "No words yet.",
} as const;

export class ChatFilterView {
  readonly element = h("div", { class: "chat-filter" });
  private words: WatchWordView[] = [];
  private days = 7;
  private loaded = false;
  private problem: { kind: WatchKind; text: string } | null = null;

  constructor(private readonly options: ChatFilterOptions) {
    replace(this.element, h("div", { class: "skeleton" }));
  }

  async refresh(): Promise<void> {
    try {
      const answer = await fetchWatchWords();
      this.words = answer.words;
      this.days = answer.days || 7;
      this.loaded = true;
    } catch (err) {
      replace(this.element, h("p", { class: "note" }, `Could not load the watched words: ${errorWords(err)}`));
      return;
    }
    this.render();
  }

  private of(kind: WatchKind): WatchWordView[] {
    return this.words.filter((word) => word.kind === kind);
  }

  private async add(kind: WatchKind, input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
    const word = input.value.trim();
    if (!word) {
      this.problem = { kind, text: kind === "always" ? "Type a word or phrase." : "Type one word." };
      this.render();
      return;
    }
    input.disabled = true;
    button.disabled = true;
    try {
      const answer = await addWatchWord(word, kind);
      this.words = [...this.words, answer.word];
      this.problem = null;
      this.options.say(`“${answer.word.word}” is now watched`);
    } catch (err) {
      this.problem = { kind, text: errorWords(err) };
    }
    this.render();
    this.element.querySelector<HTMLInputElement>(`[data-add="${kind}"] input`)?.focus();
  }

  private async remove(word: WatchWordView, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await removeWatchWord(word.id);
    } catch (err) {
      button.disabled = false;
      this.options.say(`Could not remove “${word.word}”: ${errorWords(err)}`);
      return;
    }
    this.words = this.words.filter((other) => other.id !== word.id);
    this.render();
    this.options.say(`“${word.word}” is no longer watched`);
  }

  /** The add box for one kind of word. */
  private addForm(kind: WatchKind, compact: boolean): HTMLElement {
    const id = `watch-add-${kind}`;
    const input = h("input", {
      class: "field-input",
      attrs: {
        id,
        type: "text",
        autocomplete: "off",
        spellcheck: "false",
        maxlength: "40",
        placeholder: kind === "always" ? CHAT_FILTER_TEXT.placeholder : CHAT_FILTER_TEXT.oneWord,
        "aria-label": kind === "always" ? "Add an always-watched word or phrase" : kind === "near" ? "Add a word watched only next to a context word" : "Add a context word",
      },
    });
    const button = h("button", { class: compact ? "button quiet" : "button primary", attrs: { type: "submit" } }, compact ? "+ Add" : CHAT_FILTER_TEXT.add);
    const form = h("form", { class: compact ? "watch-add watch-add--chip" : "watch-add", attrs: { novalidate: "", "data-add": kind } }, input, button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.add(kind, input, button);
    });
    input.addEventListener("input", () => {
      if (this.problem?.kind !== kind) return;
      this.problem = null;
      form.parentElement?.querySelector(".form-error")?.remove();
    });
    return form;
  }

  private problemLine(kind: WatchKind): HTMLElement | null {
    return this.problem?.kind === kind ? h("p", { class: "form-error", attrs: { role: "alert" } }, this.problem.text) : null;
  }

  private removeButton(word: WatchWordView, label: string, chip: boolean): HTMLButtonElement {
    const button = h(
      "button",
      { class: chip ? "watch-chip__remove" : "button quiet", attrs: { type: "button", "aria-label": `Remove “${word.word}”` } },
      icon("x", chip ? 14 : 16),
      chip ? null : h("span", {}, label),
    );
    button.addEventListener("click", () => void this.remove(word, button));
    return button;
  }

  private chips(kind: "near" | "context"): HTMLElement {
    return h(
      "div",
      { class: `watch-chips watch-chips--${kind}`, attrs: { role: "list" } },
      ...this.of(kind).map((word) =>
        h("span", { class: `watch-chip watch-chip--${kind}`, attrs: { role: "listitem" } }, h("span", {}, word.word), this.removeButton(word, "Remove", true)),
      ),
      this.addForm(kind, true),
    );
  }

  private render(): void {
    if (!this.loaded) return;
    const always = this.of("always");
    const alwaysCard = h(
      "section",
      { class: "group watch-card", attrs: { "aria-labelledby": "watch-always-title" } },
      h("h2", { class: "watch-card__title", attrs: { id: "watch-always-title" } }, CHAT_FILTER_TEXT.alwaysTitle),
      h("p", { class: "lede" }, CHAT_FILTER_TEXT.alwaysLede),
      this.addForm("always", false),
      this.problemLine("always"),
      always.length
        ? h(
            "ul",
            { class: "rows watch-rows" },
            ...always.map((word) =>
              h(
                "li",
                {},
                h(
                  "div",
                  { class: "row watch-row" },
                  h(
                    "span",
                    { class: "row-main" },
                    h("span", { class: "row-title" }, word.word),
                    h("span", { class: "row-meta" }, CHAT_FILTER_TEXT.hits(word.hits ?? 0, this.days)),
                  ),
                  this.removeButton(word, "Remove", false),
                ),
              ),
            ),
          )
        : h("p", { class: "note" }, CHAT_FILTER_TEXT.empty),
    );
    const nearHits = this.of("near").reduce((sum, word) => sum + (word.hits ?? 0), 0);
    const nearCard = h(
      "section",
      { class: "group watch-card", attrs: { "aria-labelledby": "watch-near-title" } },
      h("h2", { class: "watch-card__title", attrs: { id: "watch-near-title" } }, CHAT_FILTER_TEXT.nearTitle),
      h("p", { class: "lede" }, CHAT_FILTER_TEXT.nearLede),
      this.chips("near"),
      this.problemLine("near"),
      h("p", { class: "watch-next-to" }, CHAT_FILTER_TEXT.nextTo),
      this.chips("context"),
      this.problemLine("context"),
      h(
        "p",
        { class: "row-meta watch-near-hits" },
        CHAT_FILTER_TEXT.hits(nearHits, this.days),
        this.of("near").length > 1 ? ` (${this.of("near").map((word) => `${word.word} ${word.hits ?? 0}`).join(", ")})` : "",
      ),
    );
    replace(this.element, h("p", { class: "chip chip-good watch-live" }, CHAT_FILTER_TEXT.live), alwaysCard, nearCard);
  }
}
