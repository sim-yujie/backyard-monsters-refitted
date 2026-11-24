import { fetchModSteps, moderatePlayer, type ModStepState, type ModStepView } from "./api";
import { h, replace } from "./dom";
import { ago, dateTime } from "./format";
import { icon } from "./icons";
import { errorWords } from "./shiny";

/**
 * Moderators' bans and mutes, under the Moderators list (owner, 24 Nov 2026):
 * every one, newest first, with who did it, the reason the player saw, and
 * what became of it. While one is on, Undo lifts it; a ban can also be made
 * permanent (same reason). Both are the dashboard's own player steps, so
 * they show in the player's moderation log. Telegram links here.
 */

export interface ModStepsOptions {
  say(message: string): void;
  /** Asks before a step; tests answer for the owner. */
  confirm?(question: string): boolean;
}

const STATE_CHIP: Record<ModStepState, { word: string; tone: string }> = {
  on: { word: "On", tone: "chip-bad" },
  ended: { word: "Ended", tone: "chip-quiet" },
  undone: { word: "Undone", tone: "chip-good" },
  permanent: { word: "Made permanent", tone: "chip-warn" },
  replaced: { word: "Replaced", tone: "chip-quiet" },
};

/** "banned 3 days", "muted 1 hour". */
export const stepWords = (step: ModStepView): string => {
  const unit = step.kind === "ban" ? "day" : "hour";
  const length =
    step.kind === "mute" && step.length % 24 === 0
      ? `${step.length / 24} day${step.length === 24 ? "" : "s"}`
      : `${step.length} ${unit}${step.length === 1 ? "" : "s"}`;
  return `${step.kind === "ban" ? "Banned" : "Chat muted"} ${length}`;
};

const nameOf = (step: ModStepView): string => step.username ?? `#${step.userid}`;

export class ModStepsView {
  readonly element = h("div", { class: "group mod-steps" });
  private readonly list = h("div", { class: "mod-steps__list" }, h("div", { class: "skeleton" }));
  private readonly more = h("button", { class: "button quiet", attrs: { type: "button", hidden: "" } }, "Show older");
  private steps: ModStepView[] = [];
  private nextOffset: number | null = null;
  private busy = false;

  constructor(private readonly options: ModStepsOptions) {
    this.more.addEventListener("click", () => void this.loadMore());
    replace(
      this.element,
      h("h3", { attrs: { id: "mod-steps" } }, "Bans and mutes by moderators"),
      h(
        "p",
        { class: "lede" },
        "Moderators can ban for 1, 3 or 7 days and mute for up to 7 days. Undo lifts one that is still on; Make permanent turns a ban into one for good.",
      ),
      this.list,
      this.more,
    );
  }

  async refresh(): Promise<void> {
    try {
      const answer = await fetchModSteps();
      this.steps = answer.steps;
      this.nextOffset = answer.nextOffset;
    } catch (err) {
      replace(this.list, h("p", { class: "note" }, `Could not load the moderators' steps: ${errorWords(err)}`));
      return;
    }
    this.render();
  }

  private async loadMore(): Promise<void> {
    if (this.nextOffset === null || this.busy) return;
    this.busy = true;
    this.more.disabled = true;
    try {
      const answer = await fetchModSteps(this.nextOffset);
      this.steps = [...this.steps, ...answer.steps];
      this.nextOffset = answer.nextOffset;
      this.render();
    } catch (err) {
      this.options.say(`Could not load more: ${errorWords(err)}`);
    } finally {
      this.busy = false;
      this.more.disabled = false;
    }
  }

  private ask(question: string): boolean {
    return (this.options.confirm ?? ((words: string) => window.confirm(words)))(question);
  }

  private async act(step: ModStepView, what: "undo" | "permanent", button: HTMLButtonElement): Promise<void> {
    const name = nameOf(step);
    const question =
      what === "permanent"
        ? `Ban ${name} for good? The reason stays: "${step.reason}"`
        : step.kind === "ban"
          ? `Lift ${name}'s ban now?`
          : `Lift ${name}'s chat mute now?`;
    if (!this.ask(question)) return;
    button.disabled = true;
    try {
      if (what === "permanent") {
        await moderatePlayer(step.userid, "ban", { reason: step.reason, days: null });
      } else {
        await moderatePlayer(step.userid, step.kind === "ban" ? "unban" : "unmute", {
          reason: `Undid a moderator's ${step.kind} (${step.moderatorName ?? `#${step.moderatorId}`})`,
        });
      }
    } catch (err) {
      button.disabled = false;
      this.options.say(`Could not change ${name}: ${errorWords(err)}`);
      return;
    }
    this.options.say(
      what === "permanent" ? `${name} is banned for good` : step.kind === "ban" ? `${name}'s ban is lifted` : `${name}'s chat mute is lifted`,
    );
    await this.refresh();
  }

  private button(step: ModStepView, what: "undo" | "permanent"): HTMLButtonElement {
    const label = what === "undo" ? "Undo" : "Make permanent";
    const button = h(
      "button",
      {
        class: `button ${what === "undo" ? "quiet" : "danger"}`,
        attrs: { type: "button", "aria-label": `${label}: ${stepWords(step).toLowerCase()} for ${nameOf(step)}` },
      },
      what === "undo" ? icon("back", 16) : null,
      h("span", {}, label),
    );
    button.addEventListener("click", () => void this.act(step, what, button));
    return button;
  }

  private render(): void {
    this.more.hidden = this.nextOffset === null;
    if (this.steps.length === 0) {
      replace(this.list, h("p", { class: "note" }, "No bans or mutes by moderators yet."));
      return;
    }
    replace(
      this.list,
      h(
        "ul",
        { class: "rows" },
        ...this.steps.map((step) => {
          const chip = STATE_CHIP[step.state];
          const later =
            step.state === "undone" || step.state === "permanent" || step.state === "replaced"
              ? [step.laterByName ? `by ${step.laterByName}` : null, step.laterAt ? ago(step.laterAt) : null].filter(Boolean).join(" ")
              : step.state === "on" && step.until
                ? `until ${dateTime(step.until)}`
                : "";
          return h(
            "li",
            {},
            h(
              "div",
              { class: "row mod-step-row" },
              h(
                "span",
                { class: "row-main" },
                h(
                  "span",
                  { class: "row-title" },
                  h("span", { class: `chip ${chip.tone}` }, chip.word),
                  h("a", { attrs: { href: `#moderation?player=${step.userid}` } }, nameOf(step)),
                  h("span", { class: "mod-step-what" }, stepWords(step)),
                ),
                h("span", { class: "mod-step-reason" }, `Reason: ${step.reason}`),
                h(
                  "span",
                  { class: "row-meta", attrs: { title: dateTime(step.at) } },
                  [`by ${step.moderatorName ?? `#${step.moderatorId}`}`, ago(step.at), later].filter(Boolean).join(" · "),
                ),
              ),
              step.state === "on"
                ? h(
                    "span",
                    { class: "mod-step-actions" },
                    this.button(step, "undo"),
                    step.kind === "ban" ? this.button(step, "permanent") : null,
                  )
                : null,
            ),
          );
        }),
      ),
    );
  }
}
