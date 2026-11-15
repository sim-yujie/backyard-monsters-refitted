import { helpAllCountText } from "@/game/friends/helpModel";
import { gameIcon } from "../gameIcon";
import { make } from "./rows";
import "./help.css";

/**
 * The one bar on a friend's yard (beta 8, owner 15 Nov 2026: "why are there
 * so many bars?"). One row at the top of the yard: whose yard it is, the
 * painted tools with the number of buildings to speed up, and **Help all**,
 * which gives every help the visitor can still give, one after another.
 * While it runs the button reads "2/3"; after, the same row shows one short
 * line ("Helped 3 · -1h 12m · +1.2K each") for a few seconds in place of the
 * count and the button, then the name alone, or the name, count and button
 * again if any help is left. It replaces the old "Helping Bob" line above it
 * and the yard's name in the status line at the bottom.
 */

export const HELP_ALL_TEXT = {
  button: "Help all",
  label: "Visiting a friend",
} as const;

/** The end of "Bob's yard". */
const YARD_SUFFIX = "'s yard";

/** How long the result line stays, in milliseconds. */
export const HELP_ALL_RESULT_MS = 7000;

/** What Help all came to: the short line the bar shows, and the full one behind it. */
export interface HelpAllLine {
  readonly text: string;
  readonly full?: string;
  readonly kind: "thanks" | "error";
  /** Shown in place of the words (icons and numbers), the words kept for a screen reader. */
  readonly node?: HTMLElement;
  /** How long it stays; {@link HELP_ALL_RESULT_MS} unless said. 0 shows nothing. */
  readonly ms?: number;
}

export interface HelpAllBarOptions {
  /** Runs Help all; resolves with the line to show after. */
  readonly onHelpAll: () => Promise<HelpAllLine>;
}

export class HelpAllBar {
  readonly element: HTMLElement;

  private readonly name: HTMLElement;
  private readonly help: HTMLElement;
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
    this.name = make("span", "help-all-bar__name");
    const icon = gameIcon("tools", { size: 24, decorative: true, className: "help-all-bar__icon" });
    this.count = make("span", "help-all-bar__count");
    this.button = make("button", "btn btn--primary help-all-bar__button", HELP_ALL_TEXT.button);
    this.button.type = "button";
    this.button.addEventListener("click", () => void this.run());
    this.help = make("span", "help-all-bar__help");
    this.help.append(icon, this.count, this.button);
    this.result = make("span", "help-all-bar__result");
    this.result.setAttribute("role", "status");
    this.result.hidden = true;
    this.element.append(this.name, this.help, this.result);
    this.render();
  }

  /** Whose yard it is: "Bob's yard". */
  setName(text: string): void {
    // "'s yard" in a piece of its own: an upright phone's visit bar shows the name alone.
    const cut = text.endsWith(YARD_SUFFIX) ? text.length - YARD_SUFFIX.length : text.length;
    this.name.replaceChildren(text.slice(0, cut));
    if (cut < text.length) this.name.append(make("span", "help-all-bar__name-rest", YARD_SUFFIX));
    this.name.title = text;
    this.render();
  }

  /** The buildings left to help: the tools and "3". */
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
    if (this.result.hidden) return "";
    return this.result.querySelector(".help-all-bar__words")?.textContent ?? this.result.textContent ?? "";
  }

  /** Shows the line after Help all for {@link HELP_ALL_RESULT_MS}, in place of the count and the button. */
  showResult(line: HelpAllLine): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    const ms = line.ms ?? HELP_ALL_RESULT_MS;
    if (ms <= 0) {
      this.result.hidden = true;
      this.render();
      return;
    }
    if (line.node) {
      line.node.setAttribute("aria-hidden", "true");
      this.result.replaceChildren(line.node, make("span", "help-all-bar__words", line.text));
    } else {
      this.result.textContent = line.text;
    }
    this.result.classList.toggle("help-all-bar__result--node", line.node !== undefined);
    this.result.title = line.full ?? line.text;
    this.result.hidden = false;
    this.result.classList.toggle("help-all-bar__result--error", line.kind === "error");
    this.resultTimer = setTimeout(() => {
      this.resultTimer = null;
      this.result.hidden = true;
      this.render();
    }, ms);
    this.render();
  }

  destroy(): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = null;
    this.element.remove();
  }

  private render(): void {
    // The count and the button: while there is something to help, and not
    // while the line after Help all shows.
    this.help.hidden = !this.result.hidden || (this.total === 0 && !this.busy);
    this.element.classList.toggle("help-all-bar--result", !this.result.hidden);
    this.name.hidden = this.name.textContent === "";
    // "3" and the words for a screen reader; the screen shows the number by the tools.
    const number = make("span", "help-all-bar__number", String(this.total));
    const words = make("span", "help-all-bar__words", " to speed up");
    this.count.replaceChildren(number, words);
    this.count.title = helpAllCountText(this.total);
    if (!this.busy) this.button.textContent = HELP_ALL_TEXT.button;
    this.button.disabled = this.busy || this.total === 0;
  }

  private async run(): Promise<void> {
    if (this.busy || this.total === 0) return;
    this.busy = true;
    this.result.hidden = true;
    this.render();
    let line: HelpAllLine | null = null;
    try {
      line = await this.options.onHelpAll();
    } finally {
      this.busy = false;
      this.render();
    }
    if (line) this.showResult(line);
  }
}
