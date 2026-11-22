import { changeMaintenance, fetchMaintenancePanel, type MaintenanceChange, type MaintenancePanelView } from "./api";
import { h, replace } from "./dom";

/**
 * The maintenance switch (owner, 22 Nov 2026), at the top of Server health
 * (`server/src/controllers/admin/maintenance.ts`).
 *
 * Off: a message (the default if empty), an optional back-at time (this
 * browser's time; players see it in theirs) and a countdown of 1, 5, 10 or
 * 15 minutes, then Turn on. From that moment nobody but the owner can sign
 * in; players already in see the countdown, and at zero they are signed out.
 *
 * On: what players see, the time left (or that they are out), Turn off
 * (which also cancels a countdown) and the words to change. It never turns
 * itself off; the back-at time is only shown to players.
 */

/** "4:59". */
export const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** A time in this browser's clock: "Sun 22 Nov, 15:30". */
const when = (ms: number): string =>
  new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The panel's one sentence: off, counting down, or players out. */
export const maintenanceSentence = (panel: MaintenancePanelView, remainingMs: number): string => {
  if (!panel.on) return "Off. Everyone can play.";
  if (remainingMs > 0) return `On. New sign-ins blocked. Players signed out in ${clock(remainingMs)}.`;
  return "On. Players are signed out. Only you can play.";
};

/** `datetime-local`'s value for a time, in this browser's zone. */
const localInput = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface MaintenanceViewOptions {
  readonly say: (message: string) => void;
  /** Asks before On and Off; the browser's confirm unless a test hands one in. */
  readonly confirm?: (question: string) => boolean;
  readonly now?: () => number;
}

export class MaintenanceView {
  readonly element = h("section", { class: "group maint-admin", attrs: { "aria-labelledby": "maint-admin-title" } });
  private panel: MaintenancePanelView | null = null;
  /** Local clock when the panel arrived, to count down between answers. */
  private arrivedAt = 0;
  private loadError: string | null = null;
  private busy = false;
  private minutes = 5;
  private sentence: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: MaintenanceViewOptions) {
    this.now = options.now ?? (() => Date.now());
    this.render();
  }

  async refresh(): Promise<void> {
    try {
      this.take(await fetchMaintenancePanel());
      this.loadError = null;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  /** Time left now, from the server's answer and this browser's clock since. */
  remaining(): number {
    if (!this.panel?.on) return 0;
    return Math.max(0, this.panel.remainingMs - (this.now() - this.arrivedAt));
  }

  private take(panel: MaintenancePanelView): void {
    this.panel = panel;
    this.arrivedAt = this.now();
    if (!panel.on) this.minutes = panel.limits.defaultMinutes;
  }

  private async send(change: MaintenanceChange, question: string | null, done: string): Promise<void> {
    if (this.busy) return;
    if (question && !(this.options.confirm ?? ((words: string) => window.confirm(words)))(question)) return;
    this.busy = true;
    this.render();
    try {
      this.take(await changeMaintenance(change));
      this.options.say(done);
    } catch (err) {
      this.options.say(err instanceof Error ? err.message : String(err));
      await this.refresh();
    }
    this.busy = false;
    this.render();
  }

  private tick(): void {
    const panel = this.panel;
    if (this.sentence && panel) this.sentence.textContent = maintenanceSentence(panel, this.remaining());
    // The countdown just ended: the sentence above says so; stop ticking.
    if (!panel?.on || this.remaining() <= 0) this.stopTicking();
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private render(): void {
    this.stopTicking();
    const panel = this.panel;
    const title = h("h3", { attrs: { id: "maint-admin-title" } }, "Maintenance");
    if (!panel) {
      replace(
        this.element,
        title,
        this.loadError ? h("p", { class: "form-error" }, this.loadError) : h("div", { class: "skeleton" }),
      );
      return;
    }
    this.element.classList.toggle("is-on", panel.on);

    const remaining = this.remaining();
    this.sentence = h(
      "p",
      { class: panel.on ? "maint-admin__sentence is-on" : "maint-admin__sentence", attrs: { role: "status" } },
      maintenanceSentence(panel, remaining),
    );

    // The words: message and back-at time, for On and for changing them while on.
    const message = h("input", {
      class: "field-input",
      attrs: {
        id: "maint-message",
        type: "text",
        maxlength: String(panel.limits.messageMax),
        placeholder: panel.limits.defaultMessage,
        autocomplete: "off",
      },
    });
    message.value = panel.on ? panel.message : "";
    const backAt = h("input", { class: "field-input", attrs: { id: "maint-back", type: "datetime-local" } });
    if (panel.on && panel.backAt) backAt.value = localInput(panel.backAt);
    const words = (): { message: string; backAt: string | null } => {
      const local = backAt.value ? new Date(backAt.value) : null;
      return {
        message: message.value.trim(),
        backAt: local && !Number.isNaN(local.getTime()) ? local.toISOString() : null,
      };
    };

    const fields = [
      h("div", { class: "field" }, h("label", { attrs: { for: "maint-message" } }, "Message to players"), message),
      h(
        "div",
        { class: "field" },
        h("label", { attrs: { for: "maint-back" } }, "Back at (optional, your time)"),
        backAt,
      ),
    ];

    if (!panel.on) {
      const segments = h(
        "div",
        { class: "segmented", attrs: { role: "group", "aria-labelledby": "maint-minutes-label" } },
        ...panel.limits.minutes.map((m) =>
          h(
            "button",
            {
              class: "seg",
              attrs: { type: "button", "aria-pressed": String(m === this.minutes), "data-minutes": String(m) },
              onClick: () => {
                this.minutes = m;
                for (const seg of segments.querySelectorAll<HTMLButtonElement>(".seg")) {
                  seg.setAttribute("aria-pressed", String(seg.dataset["minutes"] === String(m)));
                }
                turnOn.textContent = `Turn on (${m} min)`;
              },
            },
            `${m} min`,
          ),
        ),
      );
      const turnOn = h(
        "button",
        {
          class: "button danger",
          attrs: { type: "button" },
          onClick: () =>
            void this.send(
              { action: "on", ...words(), minutes: this.minutes },
              `Turn maintenance on? New sign-ins stop now; players in the game are signed out in ${this.minutes} min.`,
              "Maintenance on",
            ),
        },
        `Turn on (${this.minutes} min)`,
      );
      turnOn.disabled = this.busy;
      replace(
        this.element,
        title,
        this.sentence,
        h("p", { class: "hint" }, "Only you can sign in while it is on. Players in the game see a countdown, then are signed out. It stays on until you turn it off."),
        ...fields,
        h(
          "div",
          { class: "field" },
          h("span", { class: "field-label", attrs: { id: "maint-minutes-label" } }, "Countdown"),
          segments,
        ),
        h("div", { class: "actions" }, turnOn),
      );
      return;
    }

    const off = h(
      "button",
      {
        class: "button primary",
        attrs: { type: "button" },
        onClick: () =>
          void this.send(
            { action: "off" },
            remaining > 0 ? "Turn maintenance off? The countdown stops and players stay in." : "Turn maintenance off? Everyone can sign in again.",
            "Maintenance off",
          ),
      },
      remaining > 0 ? "Turn off (cancel countdown)" : "Turn off",
    );
    const save = h(
      "button",
      {
        class: "button quiet",
        attrs: { type: "button" },
        onClick: () => void this.send({ action: "on", ...words() }, null, "Words saved"),
      },
      "Save words",
    );
    off.disabled = this.busy;
    save.disabled = this.busy;
    replace(
      this.element,
      title,
      this.sentence,
      h(
        "p",
        { class: "hint" },
        `Since ${panel.startedAt ? when(panel.startedAt) : "?"}${panel.cutoffAt ? `; players out from ${when(panel.cutoffAt)}` : ""} (your time).`,
      ),
      ...fields,
      h("div", { class: "actions split" }, save, off),
    );
    if (remaining > 0) this.timer = setInterval(() => this.tick(), 1000);
  }
}
