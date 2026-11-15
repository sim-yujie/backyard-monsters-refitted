import { helpAllCountText } from "@/game/friends/helpModel";
import { gameIcon } from "../gameIcon";
import { make } from "./rows";
import "./help.css";

/**
 * The Help all bar on a friend's yard (beta 8, owner 15 Nov 2026, mock-up
 * "D without Next"), under the "Helping Bob" line: the painted tools, "3 to
 * speed up" and **Help all**, which gives every help the visitor can still
 * give, one after another. While it runs the button reads "2/3"; after, one
 * short line says what it came to ("Helped 3 · saved 1h 12m · earned …")
 * for a few seconds. With nothing left to help, and no line to show, the
 * bar is hidden.
 */

export const HELP_ALL_TEXT = {
  button: "Help all",
  label: "Buildings you can help",
} as const;

/** How long the result line stays, in milliseconds. */
export const HELP_ALL_RESULT_MS = 7000;

export interface HelpAllBarOptions {
  /** Runs Help all; resolves with the line to show after. */
  readonly onHelpAll: () => Promise<{ text: string; kind: "thanks" | "error" }>;
}

export class HelpAllBar {
  readonly element: HTMLElement;

  private readonly count: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly result: HTMLElement;
  private total = 0;
  private busy = false;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: HelpAllBarOptions) {
    this.element = make("div", "help-all-bar");
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", HELP_ALL_TEXT.label);
    const icon = gameIcon("tools", { size: 24, decorative: true, className: "help-all-bar__icon" });
    this.count = make("span", "help-all-bar__count");
    this.button = make("button", "btn btn--primary help-all-bar__button", HELP_ALL_TEXT.button);
    this.button.type = "button";
    this.button.addEventListener("click", () => void this.run());
    this.result = make("p", "help-all-bar__result");
    this.result.setAttribute("role", "status");
    this.result.hidden = true;
    const row = make("div", "help-all-bar__row");
    row.append(icon, this.count, this.button);
    this.element.append(row, this.result);
    this.render();
  }

  /** The buildings left to help: "3 to speed up". */
  setCount(count: number): void {
    this.total = Math.max(0, Math.floor(count));
    this.render();
  }

  /** While Help all runs: how many of how many are done. */
  setProgress(done: number, total: number): void {
    if (this.busy) this.button.textContent = `${done}/${total}`;
  }

  /** Whether Help all is running. */
  get running(): boolean {
    return this.busy;
  }

  /** The line after Help all, for a test; empty when none shows. */
  get resultText(): string {
    return this.result.hidden ? "" : (this.result.textContent ?? "");
  }

  /** Shows the line after Help all for {@link HELP_ALL_RESULT_MS}. */
  showResult(text: string, kind: "thanks" | "error"): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.result.textContent = text;
    this.result.hidden = false;
    this.result.classList.toggle("help-all-bar__result--error", kind === "error");
    this.resultTimer = setTimeout(() => {
      this.resultTimer = null;
      this.result.hidden = true;
      this.render();
    }, HELP_ALL_RESULT_MS);
    this.render();
  }

  destroy(): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = null;
    this.element.remove();
  }

  private render(): void {
    const row = this.element.querySelector<HTMLElement>(".help-all-bar__row");
    const nothing = this.total === 0 && !this.busy;
    if (row) row.hidden = nothing;
    this.element.hidden = nothing && this.result.hidden;
    this.count.textContent = helpAllCountText(this.total);
    if (!this.busy) this.button.textContent = HELP_ALL_TEXT.button;
    this.button.disabled = this.busy || this.total === 0;
  }

  private async run(): Promise<void> {
    if (this.busy || this.total === 0) return;
    this.busy = true;
    this.result.hidden = true;
    this.render();
    let line: { text: string; kind: "thanks" | "error" } | null = null;
    try {
      line = await this.options.onHelpAll();
    } finally {
      this.busy = false;
      this.render();
    }
    if (line) this.showResult(line.text, line.kind);
  }
}
