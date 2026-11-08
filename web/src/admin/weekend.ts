import {
  changeWeekend,
  fetchWeekend,
  type WeekendChange,
  type WeekendEventId,
  type WeekendPanelView,
  type WeekendPlanRowView,
  type WeekendRunView,
} from "./api";
import { h, replace } from "./dom";
import { duration } from "./format";

/**
 * The Weekend events section (`#weekend`): the mini weekend event, one boost
 * each weekend (`server/src/controllers/admin/weekend.ts`).
 *
 * Top: what is on now or next, one sentence, and the on/off switch. Then the
 * next 8 weekends, each with a choice (the rotation's event, another, or
 * skip). Then "Run now" (any event, for some hours, from now) and Stop. The
 * rarely changed settings (percentages, rotation order, first weekend, time
 * zone, length, announce time, reset) are folded at the foot. Every change
 * saves at once and the server answers the whole panel again; it reaches
 * players within a minute without a release.
 */

const SHORT: Record<WeekendEventId, string> = {
  builders: "Builder's Weekend",
  plunder: "Tribe Plunder",
  study: "Study Weekend",
  hatch: "Hatch Rush",
};

/** The event's name from the panel's list, or the built-in one. */
const titleOf = (panel: WeekendPanelView, id: WeekendEventId): string =>
  panel.events.find((event) => event.id === id)?.title ?? SHORT[id];

/** "Sat 14 Nov" from a Saturday's `YYYY-MM-DD`. */
export const saturdayLabel = (key: string): string => {
  const date = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

/** A unix time in this browser's clock: "Sun 15 Nov, 23:59". */
const when = (t: number): string =>
  new Date(t * 1000).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "2 d 0 h" with no-break spaces: a narrow screen wraps it whole, never "h." alone. */
const unbroken = (seconds: number): string => duration(seconds).replace(/ /g, "\u00a0");

/** One sentence: what runs now, or what comes next, or that it is off. */
export const weekendSentence = (panel: WeekendPanelView): string => {
  const { active, next } = panel.state;
  const run = (r: WeekendRunView) => `${r.title} (${r.line})`;
  if (active) {
    const by = active.forced ? " (run by hand)" : "";
    return `On now: ${run(active)}${by}. Ends in ${unbroken(active.endsAt - panel.now)}.`;
  }
  if (!panel.settings.enabled) return "Weekend events are off. No event runs or is announced.";
  if (next) return `Next: ${run(next)}, starts in ${unbroken(next.startsAt - panel.now)}.`;
  return "Nothing planned in the next 8 weekends.";
};

/** The value of a weekend's choice: "" follows the rotation. */
export const planChoice = (row: WeekendPlanRowView): string => row.override ?? "";

/** The change a weekend's choice makes. */
export const planChange = (key: string, value: string): WeekendChange => ({
  action: "weekend",
  weekend: key,
  event: value === "" ? null : (value as WeekendEventId | "skip"),
});

/** The rotation with entry `index` moved one place up (-1) or down (+1). */
export const moveInRotation = (
  rotation: readonly WeekendEventId[],
  index: number,
  step: -1 | 1,
): WeekendEventId[] => {
  const to = index + step;
  const out = [...rotation];
  if (index < 0 || index >= out.length || to < 0 || to >= out.length) return out;
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
};

/** Why a whole number is not allowed in [min, max], or null. */
export const numberProblem = (raw: string, min: number, max: number, what: string): string | null => {
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) return `${what}: type a whole number.`;
  const value = Number(text);
  if (value < min || value > max) return `${what}: between ${min} and ${max}.`;
  return null;
};

/** Whether `date` (`YYYY-MM-DD`) is a Saturday. */
export const isSaturday = (date: string): boolean => {
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 6;
};

export interface WeekendViewOptions {
  readonly say: (message: string) => void;
}

export class WeekendView {
  readonly element = h("div", { class: "weekend-admin" });
  private panel: WeekendPanelView | null = null;
  private loadError: string | null = null;
  private busy = false;
  private settingsOpen = false;

  constructor(private readonly options: WeekendViewOptions) {
    this.render();
  }

  async refresh(): Promise<void> {
    try {
      this.panel = await fetchWeekend();
      this.loadError = null;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  /** Sends one change; the answer is the whole panel again. */
  private async send(change: WeekendChange, said: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      this.panel = await changeWeekend(change);
      this.options.say(said);
    } catch (err) {
      this.options.say(err instanceof Error ? err.message : String(err));
    }
    this.busy = false;
    this.render();
  }

  private render(): void {
    const panel = this.panel;
    if (!panel) {
      replace(
        this.element,
        this.loadError ? h("p", { class: "form-error" }, this.loadError) : h("div", { class: "skeleton" }),
      );
      return;
    }
    replace(this.element, this.renderNow(panel), this.renderPlan(panel), this.renderForce(panel), this.renderSettings(panel));
  }

  private renderNow(panel: WeekendPanelView): HTMLElement {
    const toggle = h("input", { attrs: { type: "checkbox", id: "weekend-enabled" } });
    toggle.checked = panel.settings.enabled;
    toggle.disabled = this.busy;
    toggle.addEventListener("change", () =>
      void this.send(
        { action: "settings", enabled: toggle.checked },
        toggle.checked ? "Weekend events on" : "Weekend events off",
      ),
    );
    const active = panel.state.active;
    return h(
      "div",
      { class: "group weekend-now" },
      h(
        "p",
        { class: active ? "weekend-sentence is-on" : "weekend-sentence" },
        weekendSentence(panel),
      ),
      active ? h("p", { class: "hint" }, `Runs ${when(active.startsAt)} to ${when(active.endsAt)} (your time).`) : null,
      panel.envForced
        ? h(
            "p",
            { class: "note" },
            `This server was started with WEEKEND_FORCE=${panel.envForced}: players here get it whatever is saved below.`,
          )
        : null,
      h("label", { class: "weekend-switch", attrs: { for: "weekend-enabled" } }, toggle, " Weekend events on"),
    );
  }

  private renderPlan(panel: WeekendPanelView): HTMLElement {
    const rows = panel.plan.map((row) => {
      const select = h("select", {
        class: "field-input",
        attrs: { "aria-label": `Event for the weekend of ${saturdayLabel(row.key)}` },
      });
      const rotationName = row.rotation ? titleOf(panel, row.rotation) : "nothing";
      const options: [string, string][] = [
        ["", `Rotation: ${rotationName}`],
        ...panel.events.map((event): [string, string] => [event.id, event.title]),
        ["skip", "Skip (no event)"],
      ];
      for (const [value, label] of options) {
        const option = h("option", { attrs: { value } }, label);
        select.append(option);
      }
      select.value = planChoice(row);
      select.disabled = this.busy || !panel.settings.enabled;
      select.addEventListener("change", () =>
        void this.send(planChange(row.key, select.value), `Weekend of ${saturdayLabel(row.key)} saved`),
      );
      const running = panel.state.active?.key === row.key;
      return h(
        "li",
        { class: running ? "weekend-row is-on" : "weekend-row" },
        h("span", { class: "row-title" }, saturdayLabel(row.key), running ? h("span", { class: "chip chip-good" }, "On now") : null),
        select,
      );
    });
    return h(
      "div",
      { class: "group" },
      h("h3", {}, "Next 8 weekends"),
      h("p", { class: "hint" }, "Swap a weekend's event or skip it. Saturday 00:00 to Sunday 23:59 server time."),
      h("ul", { class: "rows weekend-plan" }, ...rows),
    );
  }

  private renderForce(panel: WeekendPanelView): HTMLElement {
    const forced = panel.settings.forced;
    const event = h("select", { class: "field-input", attrs: { id: "weekend-force-event" } });
    for (const item of panel.events) event.append(h("option", { attrs: { value: item.id } }, item.title));
    const hours = h("input", {
      class: "field-input",
      attrs: {
        id: "weekend-force-hours",
        type: "number",
        min: "1",
        max: String(panel.limits.maxForceHours),
        step: "1",
        inputmode: "numeric",
      },
    });
    hours.value = "48";
    const problem = h("p", { class: "form-error" });
    problem.hidden = true;
    const run = h(
      "button",
      {
        class: "button primary",
        attrs: { type: "button" },
        onClick: () => {
          const why = numberProblem(hours.value, 1, panel.limits.maxForceHours, "Hours");
          problem.hidden = why === null;
          problem.textContent = why ?? "";
          if (why) return;
          const id = event.value as WeekendEventId;
          void this.send({ action: "force", event: id, hours: Number(hours.value) }, `${titleOf(panel, id)} running now`);
        },
      },
      "Run now",
    );
    run.disabled = this.busy || !panel.settings.enabled;
    const stop = forced
      ? h(
          "button",
          {
            class: "button danger",
            attrs: { type: "button" },
            onClick: () => void this.send({ action: "stopForce" }, "Stopped"),
          },
          `Stop ${titleOf(panel, forced.id)}`,
        )
      : null;
    if (stop) stop.disabled = this.busy;
    return h(
      "div",
      { class: "group" },
      h("h3", {}, "Run one now"),
      h("p", { class: "hint" }, "Starts at once, whatever the day, for the hours you pick. It replaces the weekend's own event while it runs."),
      forced ? h("p", { class: "note" }, `Running by hand until ${when(forced.until)} (your time).`) : null,
      h(
        "div",
        { class: "weekend-force" },
        h("div", { class: "field" }, h("label", { attrs: { for: "weekend-force-event" } }, "Event"), event),
        h("div", { class: "field" }, h("label", { attrs: { for: "weekend-force-hours" } }, "Hours"), hours),
      ),
      problem,
      h("div", { class: "actions" }, run, stop),
    );
  }

  private renderSettings(panel: WeekendPanelView): HTMLElement {
    const settings = panel.settings;
    const limits = panel.limits;
    const details = h("details", { class: "group weekend-settings" });
    details.open = this.settingsOpen;
    details.addEventListener("toggle", () => {
      this.settingsOpen = details.open;
    });
    details.append(h("summary", {}, "Settings"));

    const numberField = (id: string, label: string, value: number, min: number, max: number) => {
      const input = h("input", {
        class: "field-input",
        attrs: { id, type: "number", min: String(min), max: String(max), step: "1", inputmode: "numeric" },
      });
      input.value = String(value);
      return { input, field: h("div", { class: "field" }, h("label", { attrs: { for: id } }, label), input) };
    };

    const percents = panel.events.map((event) => ({
      id: event.id,
      ...numberField(`weekend-pct-${event.id}`, `${event.title} %`, settings.percent[event.id], limits.minPercent, limits.maxPercent),
    }));

    let rotation = [...settings.rotation];
    const rotationList = h("ol", { class: "weekend-rotation" });
    const drawRotation = () => {
      replace(
        rotationList,
        ...rotation.map((id, index) =>
          h(
            "li",
            {},
            h("span", {}, titleOf(panel, id)),
            h(
              "button",
              {
                class: "button quiet",
                attrs: { type: "button", "aria-label": `Move ${titleOf(panel, id)} up` },
                onClick: () => {
                  rotation = moveInRotation(rotation, index, -1);
                  drawRotation();
                },
              },
              "↑",
            ),
            h(
              "button",
              {
                class: "button quiet",
                attrs: { type: "button", "aria-label": `Move ${titleOf(panel, id)} down` },
                onClick: () => {
                  rotation = moveInRotation(rotation, index, 1);
                  drawRotation();
                },
              },
              "↓",
            ),
          ),
        ),
      );
    };
    drawRotation();

    const first = h("input", { class: "field-input", attrs: { id: "weekend-first", type: "date" } });
    first.value = settings.firstWeekend;
    const offset = numberField(
      "weekend-offset",
      "Server time zone (hours from UTC)",
      Math.round(settings.utcOffsetMinutes / 60),
      Math.ceil(limits.minOffsetMinutes / 60),
      Math.floor(limits.maxOffsetMinutes / 60),
    );
    const length = numberField("weekend-length", "Length (hours from Saturday 00:00)", settings.lengthHours, limits.minLengthHours, limits.maxLengthHours);
    const announce = numberField("weekend-announce", "Pop-up before the start (hours)", settings.announceHours, 0, limits.maxAnnounceHours);

    const problem = h("p", { class: "form-error" });
    problem.hidden = true;
    const save = h(
      "button",
      {
        class: "button primary",
        attrs: { type: "button" },
        onClick: () => {
          const problems = [
            ...percents.map((p) => numberProblem(p.input.value, limits.minPercent, limits.maxPercent, SHORT[p.id])),
            isSaturday(first.value) ? null : "First weekend: pick a Saturday.",
            numberProblem(offset.input.value, Math.ceil(limits.minOffsetMinutes / 60), Math.floor(limits.maxOffsetMinutes / 60), "Time zone"),
            numberProblem(length.input.value, limits.minLengthHours, limits.maxLengthHours, "Length"),
            numberProblem(announce.input.value, 0, limits.maxAnnounceHours, "Pop-up"),
          ].filter((p): p is string => p !== null);
          problem.hidden = problems.length === 0;
          problem.textContent = problems[0] ?? "";
          if (problems.length > 0) return;
          void this.send(
            {
              action: "settings",
              rotation,
              percent: Object.fromEntries(percents.map((p) => [p.id, Number(p.input.value)])),
              firstWeekend: first.value,
              utcOffsetMinutes: Number(offset.input.value) * 60,
              lengthHours: Number(length.input.value),
              announceHours: Number(announce.input.value),
            },
            "Settings saved",
          );
        },
      },
      "Save settings",
    );
    save.disabled = this.busy;
    const reset = h(
      "button",
      {
        class: "button quiet",
        attrs: { type: "button" },
        onClick: () => {
          if (!window.confirm("Put every weekend setting back to the default, and clear the swaps and skips?")) return;
          void this.send({ action: "reset" }, "Back to the defaults");
        },
      },
      "Reset to defaults",
    );
    reset.disabled = this.busy;

    details.append(
      h("div", { class: "weekend-percents" }, ...percents.map((p) => p.field)),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Rotation order"), rotationList),
      h("div", { class: "field" }, h("label", { attrs: { for: "weekend-first" } }, "First weekend (Saturday) of the rotation"), first),
      offset.field,
      length.field,
      announce.field,
      problem,
      h("div", { class: "actions split" }, reset, save),
    );
    return details;
  }
}
