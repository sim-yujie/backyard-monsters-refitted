import {
  CONFIRM_SHINY_ABOVE,
  MAX_AWARD_REASON,
  MAX_SHINY_AWARD,
  fetchShinyAwards,
  giveShiny,
  searchPlayers,
  type BugReportDetail,
  type PlayerMatch,
  type ShinyAwardView,
} from "./api";
import { h, replace } from "./dom";
import { ago, count, dateTime, plural } from "./format";
import { icon } from "./icons";

/**
 * Giving Shiny: the form (on a bug report, and in the Shiny section after
 * picking a player by name), and the log of what was given.
 *
 * The player gets it straight away, with a mail from "The game team" saying
 * why. More than {@link CONFIRM_SHINY_ABOVE} asks once more, in place. Each
 * press of Give has an id the server keeps, so a retry after a dropped
 * connection cannot give it twice.
 */

/** The words for a failed request: the server's own plain words when it sent some. */
export const errorWords = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** A fresh id for one press of Give. */
export const newRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** Why the amount cannot be given, or null when it can. */
export const amountProblem = (raw: string): string | null => {
  const text = raw.trim();
  if (!text) return "Type how much Shiny to give.";
  if (!/^\d+$/.test(text)) return "Give a whole number of Shiny, like 250.";
  const amount = Number(text);
  if (amount < 1) return "Give at least 1 Shiny.";
  if (amount > MAX_SHINY_AWARD) return `One gift can be at most ${count(MAX_SHINY_AWARD)} Shiny.`;
  return null;
};

/** Whether an amount needs the "are you sure?" step. */
export const needsConfirm = (amount: number): boolean => amount > CONFIRM_SHINY_ABOVE;

export interface AwardTarget {
  userid: number;
  username: string;
}

export interface AwardFormOptions {
  player: AwardTarget;
  /** The report it is given from: the mail goes into that report's thread. */
  bugReportId?: number;
  /** Typed values kept from before the page was drawn again. */
  draft?: { amount: string; reason: string };
  onDraft?(draft: { amount: string; reason: string }): void;
  onGiven(award: ShinyAwardView, already: boolean, report: BugReportDetail | undefined): void;
}

let formCount = 0;

/** The amount, the reason and Give, with the in-place check for big amounts. */
export const awardForm = (options: AwardFormOptions): HTMLFormElement => {
  const n = ++formCount;
  const { player } = options;
  const amount = h("input", {
    class: "field-input amount-input",
    attrs: {
      id: `award-amount-${n}`,
      type: "text",
      inputmode: "numeric",
      autocomplete: "off",
      enterkeyhint: "next",
      "aria-describedby": `award-amount-hint-${n}`,
    },
  });
  const reason = h("input", {
    class: "field-input",
    attrs: {
      id: `award-reason-${n}`,
      type: "text",
      maxlength: String(MAX_AWARD_REASON),
      autocomplete: "off",
      enterkeyhint: "done",
      placeholder: "For example: sorry for the lost troops",
      "aria-describedby": `award-reason-count-${n}`,
    },
  });
  amount.value = options.draft?.amount ?? "";
  reason.value = options.draft?.reason ?? "";
  const reasonCount = h("span", { class: "counter", attrs: { id: `award-reason-count-${n}` } });
  const problem = h("p", { class: "form-error", attrs: { role: "alert", hidden: "" } });
  const give = h(
    "button",
    { class: "button primary", attrs: { type: "submit" } },
    "Give Shiny",
  );
  const yes = h("button", { class: "button primary", attrs: { type: "button" } });
  const cancel = h("button", { class: "button quiet", attrs: { type: "button" } }, "Cancel");
  const question = h("p", { class: "confirm-question" });
  const confirm = h(
    "div",
    { class: "confirm", attrs: { hidden: "" } },
    question,
    h(
      "p",
      { class: "note" },
      "It goes into their game at once, with a mail saying why. It cannot be taken back here.",
    ),
    h("div", { class: "actions" }, cancel, yes),
  );
  const giveRow = h("div", { class: "actions" }, give);

  // One id per press: kept for a retry of the very same gift, new once anything changes.
  let request = { key: "", id: "" };
  let busy = false;

  const updateCount = () => {
    reasonCount.textContent = `${reason.value.length} / ${MAX_AWARD_REASON}`;
  };
  updateCount();
  const say = (text: string | null) => {
    problem.hidden = text === null;
    problem.textContent = text ?? "";
  };
  const setConfirming = (on: boolean) => {
    confirm.hidden = !on;
    giveRow.hidden = on;
  };
  const setBusy = (on: boolean) => {
    busy = on;
    for (const el of [amount, reason, give, yes, cancel]) el.disabled = on;
    give.textContent = on ? "Giving…" : "Give Shiny";
    if (!confirm.hidden) yes.textContent = on ? "Giving…" : yes.dataset["label"] ?? "";
  };
  const changed = () => {
    say(null);
    setConfirming(false);
    updateCount();
    options.onDraft?.({ amount: amount.value, reason: reason.value });
  };
  amount.addEventListener("input", changed);
  reason.addEventListener("input", changed);

  const send = async () => {
    const value = Number(amount.value.trim());
    const why = reason.value.trim();
    const key = `${player.userid}|${value}|${why}|${options.bugReportId ?? ""}`;
    if (request.key !== key) request = { key, id: newRequestId() };
    setBusy(true);
    try {
      const answer = await giveShiny({
        userid: player.userid,
        amount: value,
        reason: why,
        requestId: request.id,
        ...(options.bugReportId !== undefined && { bugReportId: options.bugReportId }),
      });
      request = { key: "", id: "" };
      amount.value = "";
      reason.value = "";
      options.onDraft?.({ amount: "", reason: "" });
      setBusy(false);
      setConfirming(false);
      updateCount();
      options.onGiven(answer.award, answer.already, answer.report);
    } catch (err) {
      setBusy(false);
      say(`Not given: ${errorWords(err)}`);
    }
  };

  cancel.addEventListener("click", () => {
    setConfirming(false);
    amount.focus();
  });
  yes.addEventListener("click", () => void send());

  const form = h(
    "form",
    { class: "award", attrs: { novalidate: "", "aria-label": `Give Shiny to ${player.username}` } },
    h(
      "div",
      { class: "field" },
      h("label", { attrs: { for: amount.id } }, "How much Shiny"),
      amount,
      h(
        "span",
        { class: "hint", attrs: { id: `award-amount-hint-${n}` } },
        `1 to ${count(MAX_SHINY_AWARD)}. Over ${count(CONFIRM_SHINY_ABOVE)} asks you once more.`,
      ),
    ),
    h(
      "div",
      { class: "field" },
      h(
        "span",
        { class: "field-label" },
        h("label", { attrs: { for: reason.id } }, "Why"),
        h("span", { class: "hint" }, " the player sees this"),
      ),
      reason,
      reasonCount,
    ),
    problem,
    giveRow,
    confirm,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    const bad = amountProblem(amount.value);
    if (bad) {
      say(bad);
      amount.focus();
      return;
    }
    if (!reason.value.trim()) {
      say("Say why: the player sees it in the mail.");
      reason.focus();
      return;
    }
    const value = Number(amount.value.trim());
    if (needsConfirm(value)) {
      const label = `Yes, give ${count(value)}`;
      yes.dataset["label"] = label;
      yes.textContent = label;
      question.textContent = `Give ${count(value)} Shiny to ${player.username}?`;
      setConfirming(true);
      yes.focus();
      return;
    }
    void send();
  });
  return form;
};

/** One gift in a log: how much, to whom, why, when, and from which report. */
export const awardRow = (
  award: ShinyAwardView,
  openReport?: (id: number) => void,
  showPlayer = true,
): HTMLElement =>
  h(
    "li",
    { class: "award-row" },
    h("span", { class: "award-amount" }, `+${count(award.amount)}`),
    h(
      "span",
      { class: "row-main" },
      showPlayer
        ? h("span", { class: "row-title" }, `${award.username} (#${award.userid})`)
        : null,
      h("span", { class: "award-reason" }, award.reason),
      h(
        "span",
        { class: "row-meta" },
        h("time", { attrs: { datetime: award.at, title: dateTime(award.at) } }, ago(award.at)),
        ...(award.bugReportId !== null && openReport
          ? [
              " · ",
              h(
                "a",
                {
                  attrs: { href: `?bug=${award.bugReportId}#bugs` },
                  onClick: (event) => {
                    event.preventDefault();
                    openReport(award.bugReportId!);
                  },
                },
                `from bug report #${award.bugReportId}`,
              ),
            ]
          : []),
      ),
    ),
  );

export interface ShinyOptions {
  openReport(id: number): void;
  say(message: string): void;
}

/** The Shiny section: find a player, give, and everything given so far. */
export class ShinyView {
  readonly element = h("div", { class: "shiny" });
  private readonly search = h("input", {
    class: "field-input",
    attrs: {
      id: "player-search",
      type: "search",
      autocomplete: "off",
      spellcheck: "false",
      enterkeyhint: "search",
      placeholder: "Name or account number",
    },
  });
  private readonly results = h("div", { class: "results", attrs: { "aria-live": "polite" } });
  private readonly picked = h("div", { class: "picked" });
  private readonly log = h("div", { class: "group" }, h("div", { class: "skeleton" }));
  private awards: ShinyAwardView[] = [];
  private nextBefore: number | null = null;
  private total = { awards: 0, shiny: 0 };
  private searchTimer = 0;
  private searchSeq = 0;
  private draft = { amount: "", reason: "" };

  constructor(private readonly options: ShinyOptions) {
    this.search.addEventListener("input", () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => void this.find(), 250);
    });
    this.search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      window.clearTimeout(this.searchTimer);
      void this.find();
    });
    replace(
      this.element,
      h(
        "p",
        { class: "lede" },
        "Shiny goes into the player's game at once, with a mail from The game team saying why. " +
          "They cannot answer that mail: to talk with them, give it from their bug report instead.",
      ),
      h(
        "div",
        { class: "group finder" },
        h("label", { class: "field-label", attrs: { for: "player-search" } }, "Find a player"),
        this.search,
        this.results,
      ),
      this.picked,
      this.log,
    );
  }

  /** Loads the log again (the page's refresh). */
  async refresh(): Promise<void> {
    await this.loadLog();
  }

  private async find(): Promise<void> {
    const query = this.search.value.trim();
    const seq = ++this.searchSeq;
    if (!query) {
      replace(this.results);
      return;
    }
    let players: PlayerMatch[];
    try {
      players = (await searchPlayers(query)).players;
    } catch (err) {
      if (seq === this.searchSeq)
        replace(this.results, h("p", { class: "note" }, `Could not search: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.searchSeq) return;
    replace(
      this.results,
      players.length
        ? h(
            "ul",
            { class: "rows" },
            ...players.map((player) =>
              h(
                "li",
                {},
                h(
                  "button",
                  {
                    class: "row player-row",
                    attrs: { type: "button" },
                    onClick: () => this.pick(player),
                  },
                  h(
                    "span",
                    { class: "row-main" },
                    h("span", { class: "row-title" }, player.username),
                    h(
                      "span",
                      { class: "row-meta" },
                      [
                        `#${player.userid}`,
                        player.formerName ? `was called ${player.formerName}` : null,
                        player.lastSeenAt ? `last played ${ago(player.lastSeenAt)}` : "never played",
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    ),
                  ),
                  icon("chevron", 18),
                ),
              ),
            ),
          )
        : h(
            "p",
            { class: "note" },
            `No player called “${query}”. Try part of the name, or the account number.`,
          ),
    );
  }

  private pick(player: PlayerMatch | null): void {
    if (player === null) {
      replace(this.picked);
      this.search.focus();
      return;
    }
    replace(this.results);
    this.search.value = "";
    const form = awardForm({
      player,
      draft: this.draft,
      onDraft: (draft) => (this.draft = draft),
      onGiven: (award, already) => {
        this.options.say(
          already
            ? "That gift was already given"
            : `Gave ${count(award.amount)} Shiny to ${award.username}`,
        );
        replace(
          this.picked,
          h(
            "p",
            { class: "done", attrs: { role: "status" } },
            icon("ok", 18),
            `${already ? "Already given" : "Given"}: ${count(award.amount)} Shiny to ${award.username}. They have a mail saying why.`,
          ),
        );
        void this.loadLog();
      },
    });
    replace(
      this.picked,
      h(
        "div",
        { class: "picked-card" },
        h(
          "div",
          { class: "picked-head" },
          h(
            "div",
            { class: "row-main" },
            h("span", { class: "hint" }, "Giving to"),
            h("strong", {}, `${player.username} (#${player.userid})`),
          ),
          h(
            "button",
            {
              class: "button quiet",
              attrs: { type: "button" },
              onClick: () => this.pick(null),
            },
            "Someone else",
          ),
        ),
        form,
      ),
    );
    form.querySelector<HTMLInputElement>("input")?.focus();
  }

  private async loadLog(more = false): Promise<void> {
    try {
      const answer = await fetchShinyAwards(more ? (this.nextBefore ?? undefined) : undefined);
      this.awards = more ? [...this.awards, ...answer.awards] : answer.awards;
      this.nextBefore = answer.nextBefore;
      this.total = answer.total;
    } catch (err) {
      replace(
        this.log,
        h("h3", {}, "Given so far"),
        h("p", { class: "note" }, `The list could not be loaded: ${errorWords(err)}`),
      );
      return;
    }
    replace(
      this.log,
      h(
        "div",
        { class: "log-head" },
        h("h3", {}, "Given so far"),
        this.total.awards
          ? h(
              "span",
              { class: "hint" },
              `${plural(this.total.awards, "gift")} · ${count(this.total.shiny)} Shiny in all`,
            )
          : null,
      ),
      this.awards.length
        ? h(
            "ul",
            { class: "rows award-log" },
            ...this.awards.map((award) => awardRow(award, this.options.openReport)),
          )
        : h(
            "div",
            { class: "empty" },
            h("strong", {}, "No Shiny given yet"),
            h("p", {}, "Every gift shows up here: who got it, how much, why and when."),
          ),
      this.nextBefore !== null
        ? h(
            "button",
            {
              class: "button wide quiet",
              attrs: { type: "button" },
              onClick: () => void this.loadLog(true),
            },
            "Show older",
          )
        : null,
    );
  }
}
