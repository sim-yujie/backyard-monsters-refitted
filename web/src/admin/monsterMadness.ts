import { changeMonsterMadness, fetchMonsterMadness, type MonsterMadnessPanelView } from "./api";
import { h, replace } from "./dom";
import { duration } from "./format";

/**
 * The Monster Madness box (`#events`, above the weekend events): one sentence
 * and Start / Stop (server `controllers/admin/monsterMadness.ts`).
 *
 * The event is on no calendar (owner, 11 Nov 2026): it runs only when started
 * here, for its set days from that moment. Players take over Map Room 2
 * outposts for points; three goals pay Korath's powers, claimed on the Events
 * page until a week after the run ends. Stop ends the run at once. Both ask
 * first; a change reaches players within a minute without a release.
 */

/** "Sun 15 Nov, 23:59" in this browser's clock. */
const when = (t: number): string =>
  new Date(t * 1000).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "2 d 0 h" kept whole on a narrow screen. */
const unbroken = (seconds: number): string => duration(seconds).replace(/ /g, " ");

/** 42M, 94.5M, 160.125M. */
const millions = (points: number): string => `${Number((points / 1_000_000).toFixed(3))}M`;

/** One sentence: on now and for how long, or off (and when it last ran). */
export const monsterMadnessSentence = (panel: MonsterMadnessPanelView): string => {
  if (panel.running) return `On now. Ends in ${unbroken(panel.running.endsAt - panel.now)}.`;
  if (panel.last) return `Off. Last run ended ${when(panel.last.endsAt)}.`;
  return "Off. It has never run.";
};

/** What a run pays, in one line: "Goals 42M / 94.5M / 160.125M points: Burn, Breath of Fire, Fists of Doom." */
export const monsterMadnessGoalsLine = (panel: MonsterMadnessPanelView): string =>
  `Goals ${panel.goals.map(millions).join(" / ")} points: Korath's Burn, Breath of Fire, Fists of Doom.`;

export interface MonsterMadnessViewOptions {
  readonly say: (message: string) => void;
  /** Asks before a start or stop; the browser's confirm unless a test hands one in. */
  readonly confirm?: (question: string) => boolean;
}

export class MonsterMadnessView {
  readonly element = h("div", { class: "group mm-admin" });
  private panel: MonsterMadnessPanelView | null = null;
  private loadError: string | null = null;
  private busy = false;

  constructor(private readonly options: MonsterMadnessViewOptions) {
    this.render();
  }

  async refresh(): Promise<void> {
    try {
      this.panel = await fetchMonsterMadness();
      this.loadError = null;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  private async send(action: "start" | "stop"): Promise<void> {
    if (this.busy || !this.panel) return;
    const question =
      action === "start"
        ? `Start Monster Madness now, for ${this.panel.days} days? Every player sees it at once.`
        : "Stop Monster Madness now? Players keep a week to claim goals they reached.";
    if (!(this.options.confirm ?? ((words: string) => window.confirm(words)))(question)) return;
    this.busy = true;
    this.render();
    try {
      this.panel = await changeMonsterMadness(action);
      this.options.say(action === "start" ? "Monster Madness started" : "Monster Madness stopped");
    } catch (err) {
      this.options.say(err instanceof Error ? err.message : String(err));
      await this.refresh();
    }
    this.busy = false;
    this.render();
  }

  private render(): void {
    const panel = this.panel;
    if (!panel) {
      replace(
        this.element,
        h("h3", {}, "Monster Madness"),
        this.loadError ? h("p", { class: "form-error" }, this.loadError) : h("div", { class: "skeleton" }),
      );
      return;
    }
    const running = panel.running;
    const button = running
      ? h("button", { class: "button danger", attrs: { type: "button" }, onClick: () => void this.send("stop") }, "Stop")
      : h(
          "button",
          { class: "button primary", attrs: { type: "button" }, onClick: () => void this.send("start") },
          `Start ${panel.days} days`,
        );
    button.disabled = this.busy;
    replace(
      this.element,
      h("h3", {}, "Monster Madness"),
      h("p", { class: running ? "weekend-sentence is-on" : "weekend-sentence" }, monsterMadnessSentence(panel)),
      running ? h("p", { class: "hint" }, `Runs ${when(running.startsAt)} to ${when(running.endsAt)} (your time).`) : null,
      h("p", { class: "hint" }, `Map Room 2 takeovers score points. ${monsterMadnessGoalsLine(panel)}`),
      h("div", { class: "mm-admin__actions" }, button),
    );
  }
}
