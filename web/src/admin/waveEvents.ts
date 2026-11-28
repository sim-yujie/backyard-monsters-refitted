import { changeWaveEvents, fetchWaveEvents, type WaveEventsPanelView } from "./api";
import { h, replace } from "./dom";
import { duration } from "./format";

/**
 * The wave events box (`#events`, above Monster Madness): Start / Stop per
 * wave event (server `controllers/admin/waveEvents.ts`). Owner, 27 Nov 2026:
 * Wild Monster Invasion 1 and 2 run only when started here, one wave event at
 * a time, for a week from that moment (Flash's length); later wave events
 * (Monster Blitzkrieg, Brukkarg War's waves, Christmas) appear here by
 * themselves. Players call each of the 30 waves and 2 bonus waves on their own
 * yard; every wave beaten pays Glimmers and the totem waves raise the totem.
 * Both buttons ask first; a change reaches players within a minute.
 */

const when = (t: number): string =>
  new Date(t * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const unbroken = (seconds: number): string => duration(seconds).replace(/ /g, " ");

/** One sentence for one event: on now, or off and when it last ran. */
export const waveEventSentence = (panel: WaveEventsPanelView, key: string): string => {
  const event = panel.events.find((one) => one.key === key);
  if (panel.running?.event === key) return `On now. Ends in ${unbroken(panel.running.endsAt - panel.now)}.`;
  if (event?.last) return `Off. Last run ended ${when(event.last.endsAt)}.`;
  return "Off. It has never run.";
};

export interface WaveEventsViewOptions {
  readonly say: (message: string) => void;
  readonly confirm?: (question: string) => boolean;
}

export class WaveEventsView {
  readonly element = h("div", { class: "group mm-admin wave-admin" });
  private panel: WaveEventsPanelView | null = null;
  private loadError: string | null = null;
  private busy = false;

  constructor(private readonly options: WaveEventsViewOptions) {
    this.render();
  }

  async refresh(): Promise<void> {
    try {
      this.panel = await fetchWaveEvents();
      this.loadError = null;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  private async send(change: { action: "start"; event: string; title: string; days: number } | { action: "stop"; title: string }): Promise<void> {
    if (this.busy || !this.panel) return;
    const question =
      change.action === "start"
        ? `Start ${change.title} now, for ${change.days} days? Every player sees it at once.`
        : `Stop ${change.title} now? Players can no longer call waves.`;
    if (!(this.options.confirm ?? ((words: string) => window.confirm(words)))(question)) return;
    this.busy = true;
    this.render();
    try {
      this.panel = await changeWaveEvents(change.action === "start" ? { action: "start", event: change.event } : { action: "stop" });
      this.options.say(`${change.title} ${change.action === "start" ? "started" : "stopped"}`);
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
        h("h3", {}, "Wave events"),
        this.loadError ? h("p", { class: "form-error" }, this.loadError) : h("div", { class: "skeleton" }),
      );
      return;
    }
    const rows = panel.events.map((event) => {
      const on = panel.running?.event === event.key;
      const other = panel.running !== null && !on;
      const button = on
        ? h("button", { class: "button danger", attrs: { type: "button" }, onClick: () => void this.send({ action: "stop", title: event.title }) }, "Stop")
        : h(
            "button",
            {
              class: "button primary",
              attrs: { type: "button" },
              onClick: () => void this.send({ action: "start", event: event.key, title: event.title, days: event.days }),
            },
            `Start ${event.days} days`,
          );
      button.disabled = this.busy || other;
      if (other) button.title = "Another wave event is on. Stop it first.";
      return h(
        "div",
        { class: "wave-admin__event" },
        h("h4", {}, event.title),
        h("p", { class: on ? "weekend-sentence is-on" : "weekend-sentence" }, waveEventSentence(panel, event.key)),
        on && panel.running ? h("p", { class: "hint" }, `Runs ${when(panel.running.startsAt)} to ${when(panel.running.endsAt)} (your time).`) : null,
        h("div", { class: "mm-admin__actions" }, button),
      );
    });
    replace(
      this.element,
      h("h3", {}, "Wave events"),
      h("p", { class: "hint" }, "One at a time. Players call 30 waves and 2 bonus waves on their own yard; every wave beaten pays Glimmers, totem waves raise the totem."),
      ...rows,
    );
  }
}
