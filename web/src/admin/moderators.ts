import { addModerator, fetchModerators, removeModerator, type ModeratorView } from "./api";
import { h, replace } from "./dom";
import { ago, dateTime } from "./format";
import { icon } from "./icons";
import { errorWords } from "./shiny";

/**
 * The Moderators section (owner, 7 Nov 2026): the players whose chat lines
 * show a blue Mod badge in the game. Type a name or account number to add
 * one; Remove takes them off. Either takes effect in chat straight away.
 * Moderators get nothing else: no powers, no dashboard.
 */

export interface ModeratorsOptions {
  say(message: string): void;
}

export class ModeratorsView {
  readonly element = h("div", { class: "moderators" });
  private readonly input = h("input", {
    class: "field-input",
    attrs: {
      id: "moderator-player",
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      enterkeyhint: "done",
      maxlength: "40",
      placeholder: "Name or account number",
      "aria-describedby": "moderator-problem",
    },
  });
  private readonly addButton = h("button", { class: "button primary", attrs: { type: "submit" } }, "Add");
  private readonly problem = h("p", {
    class: "form-error",
    attrs: { id: "moderator-problem", role: "alert", hidden: "" },
  });
  private readonly list = h("div", { class: "moderator-list" }, h("div", { class: "skeleton" }));
  private moderators: ModeratorView[] = [];
  private busy = false;

  constructor(private readonly options: ModeratorsOptions) {
    const form = h(
      "form",
      { class: "group finder moderator-add", attrs: { novalidate: "" } },
      h("label", { class: "field-label", attrs: { for: "moderator-player" } }, "Add a moderator"),
      h("div", { class: "moderator-add__row" }, this.input, this.addButton),
      this.problem,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.add();
    });
    this.input.addEventListener("input", () => this.setProblem(null));
    replace(
      this.element,
      h(
        "p",
        { class: "lede" },
        "A moderator's lines in game chat show a blue Mod badge and a blue name. Nothing else changes for them.",
      ),
      form,
      this.list,
    );
  }

  /** Loads the list again (the page's refresh). */
  async refresh(): Promise<void> {
    try {
      this.moderators = (await fetchModerators()).moderators;
    } catch (err) {
      replace(this.list, h("p", { class: "note" }, `Could not load the moderators: ${errorWords(err)}`));
      return;
    }
    this.render();
  }

  private setProblem(text: string | null): void {
    this.problem.hidden = text === null;
    this.problem.textContent = text ?? "";
  }

  private async add(): Promise<void> {
    if (this.busy) return;
    const player = this.input.value.trim();
    if (!player) {
      this.setProblem("Type a player's name or account number.");
      this.input.focus();
      return;
    }
    this.busy = true;
    this.input.disabled = true;
    this.addButton.disabled = true;
    try {
      const { moderator } = await addModerator(player);
      this.moderators = [...this.moderators.filter((m) => m.userid !== moderator.userid), moderator].sort((a, b) =>
        a.username.localeCompare(b.username, undefined, { sensitivity: "base" }),
      );
      this.input.value = "";
      this.setProblem(null);
      this.render();
      this.options.say(`${moderator.username} is now a moderator`);
    } catch (err) {
      this.setProblem(errorWords(err));
    } finally {
      this.busy = false;
      this.input.disabled = false;
      this.addButton.disabled = false;
      this.input.focus();
    }
  }

  private async remove(moderator: ModeratorView, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await removeModerator(moderator.userid);
    } catch (err) {
      button.disabled = false;
      this.options.say(`Could not remove ${moderator.username}: ${errorWords(err)}`);
      return;
    }
    this.moderators = this.moderators.filter((m) => m.userid !== moderator.userid);
    this.render();
    this.options.say(`${moderator.username} is no longer a moderator`);
  }

  private render(): void {
    if (this.moderators.length === 0) {
      replace(this.list, h("p", { class: "note" }, "No moderators yet."));
      return;
    }
    replace(
      this.list,
      h(
        "ul",
        { class: "rows" },
        ...this.moderators.map((moderator) => {
          const remove = h(
            "button",
            {
              class: "button quiet",
              attrs: { type: "button", "aria-label": `Remove ${moderator.username} as a moderator` },
            },
            icon("x", 16),
            h("span", {}, "Remove"),
          );
          remove.addEventListener("click", () => void this.remove(moderator, remove));
          return h(
            "li",
            {},
            h(
              "div",
              { class: "row moderator-row" },
              h(
                "span",
                { class: "row-main" },
                h(
                  "span",
                  { class: "row-title" },
                  h("span", { class: "chip chip-info chat-gm", attrs: { title: "Moderator" } }, "Mod"),
                  moderator.username,
                ),
                h(
                  "span",
                  { class: "row-meta", attrs: { title: dateTime(moderator.addedAt) } },
                  [`#${moderator.userid}`, `added ${ago(moderator.addedAt)}`, moderator.addedByName ? `by ${moderator.addedByName}` : null]
                    .filter(Boolean)
                    .join(" · "),
                ),
              ),
              remove,
            ),
          );
        }),
      ),
    );
  }
}
