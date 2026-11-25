import { liveOptions, type LiveOption } from "@/game/maproom/live/liveProto";
import { isPhoneLayout } from "@/ui/phoneLayout";

/**
 * PROTOTYPE (proto/live-map-ux), Q3: the small mark that says the map is not live right now.
 *
 * Shows only after the live connection has been down 5 s (short drops never show), says
 * "Not live" with a broken-signal icon (placeholder art), and retries on a tap. When the
 * connection comes back after it showed, it says "Live" in green for 1.5 s, then fades.
 *
 * A: a chip at the top centre, where the map's notices go.
 * B: docked in the top bar beside Map/Yard on a desktop; an icon button in the tool row on a phone.
 * C: beside Bob's "?" in the top-left corner (an icon under it on a phone).
 */

export interface LiveMarkHosts {
  /** The top-centre notice dock. */
  notices: HTMLElement;
  /** The top bar. */
  hud: HTMLElement;
  /** The map's tool row (Mail, Filter, Key...). */
  tools: HTMLElement | null;
  /** The overlay layer the docks sit in. */
  layer: HTMLElement;
}

type MarkState = "hidden" | "down" | "retrying" | "back";

const SHOW_AFTER_MS = 5000;
const STABLE_MS = 2000;
const BACK_MS = 1500;

export class LiveMark {
  readonly element: HTMLButtonElement;
  private readonly text: HTMLElement;
  private readonly glyph: HTMLElement;
  private state: MarkState = "hidden";
  private down = false;
  private option: LiveOption | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private backTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAt = 0;

  constructor(
    private readonly hosts: () => LiveMarkHosts | null,
    private readonly onRetry: () => void,
  ) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "mr2-live-mark";
    this.element.hidden = true;
    this.glyph = document.createElement("span");
    this.glyph.className = "mr2-live-mark__icon";
    this.glyph.setAttribute("aria-hidden", "true");
    this.text = document.createElement("span");
    this.text.className = "mr2-live-mark__text";
    this.element.append(this.glyph, this.text);
    this.element.addEventListener("click", () => this.retry());
  }

  /** Puts the mark where the chosen option wants it (again after a resize or an option change). */
  place(): void {
    const hosts = this.hosts();
    if (!hosts) return;
    const option = liveOptions().q3;
    this.option = option;
    const phone = isPhoneLayout();
    this.element.dataset.option = option;
    this.element.dataset.phone = phone ? "1" : "0";
    if (option === "A") {
      hosts.notices.prepend(this.element);
    } else if (option === "B") {
      if (phone && hosts.tools) hosts.tools.prepend(this.element);
      else hosts.hud.insertBefore(this.element, hosts.hud.querySelector(".hud__scenes"));
    } else {
      hosts.layer.append(this.element);
    }
    this.render();
  }

  /** The live connection went down (`instant`: shots skip the 5 s wait) or came back. */
  setDown(down: boolean, instant = false): void {
    if (down === this.down && !instant) return;
    this.down = down;
    this.clearTimers();
    if (down) {
      if (this.state === "back") this.state = "down";
      if (this.state !== "hidden") {
        this.render();
        return;
      }
      if (instant) {
        this.state = "down";
        this.render();
      } else {
        this.showTimer = setTimeout(() => {
          this.state = "down";
          this.render();
        }, SHOW_AFTER_MS);
      }
      return;
    }
    // Back: only a mark that showed says so, after the connection held a moment.
    if (this.state === "hidden") return;
    this.showTimer = setTimeout(
      () => {
        this.state = "back";
        this.render();
        this.backTimer = setTimeout(() => {
          this.state = "hidden";
          this.render();
        }, BACK_MS);
      },
      instant ? 0 : STABLE_MS,
    );
  }

  /** Shots: hold "Live" on screen. */
  showBack(): void {
    this.clearTimers();
    this.down = false;
    this.state = "back";
    this.render();
  }

  destroy(): void {
    this.clearTimers();
    this.element.remove();
  }

  private retry(): void {
    if (this.state !== "down" || performance.now() < this.retryAt) return;
    this.retryAt = performance.now() + 2000;
    this.state = "retrying";
    this.render();
    this.onRetry();
    setTimeout(() => {
      if (this.state === "retrying") {
        this.state = this.down ? "down" : "hidden";
        this.render();
      }
    }, 1200);
  }

  private clearTimers(): void {
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.backTimer) clearTimeout(this.backTimer);
    this.showTimer = null;
    this.backTimer = null;
  }

  private render(): void {
    const state = this.state;
    this.element.hidden = state === "hidden";
    this.element.dataset.state = state;
    const iconOnly = this.option === "B" || this.option === "C" ? isPhoneLayout() : false;
    this.glyph.innerHTML = state === "back" ? LIVE_SVG : state === "retrying" ? RETRY_SVG : OFF_SVG;
    const words = state === "back" ? "Live" : state === "retrying" ? "Retrying…" : "Not live";
    this.text.textContent = words;
    this.text.hidden = iconOnly;
    this.element.setAttribute(
      "aria-label",
      state === "back"
        ? "The map is live again."
        : state === "retrying"
          ? "Reconnecting the live map."
          : "The map is not live: it updates every few minutes. Tap to reconnect.",
    );
    this.element.title = this.element.getAttribute("aria-label") ?? "";
    // The retry arrow on the chip (A and the desktop B/C pills).
    this.element.querySelector(".mr2-live-mark__retry")?.remove();
    if (state === "down" && !iconOnly) {
      const retry = document.createElement("span");
      retry.className = "mr2-live-mark__retry";
      retry.setAttribute("aria-hidden", "true");
      retry.innerHTML = RETRY_SVG;
      this.element.append(retry);
    }
  }
}

// Placeholder icons (line art, not the painted set): a signal with a slash, a turning arrow, a full signal.
const OFF_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M6 12.6a9 9 0 0 1 12 0"/><path d="M9.4 16.1a4 4 0 0 1 5.2 0"/><circle cx="12" cy="19.6" r="1.2" fill="currentColor"/><path d="M4 3.5 20 20.5" stroke-width="2.6"/></svg>';
const LIVE_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M6 12.6a9 9 0 0 1 12 0"/><path d="M9.4 16.1a4 4 0 0 1 5.2 0"/><circle cx="12" cy="19.6" r="1.2" fill="currentColor"/></svg>';
const RETRY_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';
