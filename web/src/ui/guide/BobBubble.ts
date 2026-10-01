import { bobBust, BOB_ICON, type BobMood } from "./guideArt";
import "@/ui/styles/guide.css";

/**
 * Bob's speech bubble (issue #227, `docs/design/tutorial.md` §2.1, §3): his
 * painted bust (or, for a screen tip, his head), a cream bubble with what he
 * says, the step's buttons, the step dots, and Skip.
 *
 * Bottom left on a desktop, above the dock; a strip above the dock on a
 * phone (`guide.css`, at or below 620 px, the attack scene's phone width).
 * It never decides anything: every button calls back. The guided start and
 * the tip runner both draw through it, usually by way of `GuideOverlay`.
 */

/** A button in the bubble. */
export interface BobAction {
  label: string;
  /** The step's main button (Next, Finish, Got it, Try again). */
  primary?: boolean;
  onClick: () => void;
}

/** What the bubble shows. */
export interface BobLine {
  /** What Bob says. A string is set as text; a node goes in as it is. */
  text: string | Node;
  /** The bust's mood; ignored when `icon` is set. */
  mood?: BobMood;
  /** The small head instead of the bust (screen tips). */
  icon?: boolean;
  /** The buttons, left to right. */
  actions?: readonly BobAction[];
  /** "Step 2 of 3" as dots. */
  dots?: { index: number; count: number };
  /** The quiet Skip link ("Skip", "Skip tips"); absent for none. */
  skip?: { label: string; onClick: () => void };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  return element;
};

export class BobBubble {
  readonly element: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly speech: HTMLElement;
  private readonly text: HTMLElement;
  private readonly controls: HTMLElement;

  constructor() {
    this.element = el("section", "guide-bob");
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-live", "polite");
    this.element.setAttribute("aria-label", "Bob");
    this.element.hidden = true;

    this.portrait = el("img", "guide-bob__portrait");
    this.portrait.alt = "";
    this.portrait.decoding = "async";

    this.speech = el("div", "guide-bob__speech");
    this.text = el("p", "guide-bob__text");
    this.controls = el("div", "guide-bob__controls");
    this.speech.append(this.text, this.controls);
    this.element.append(this.portrait, this.speech);
  }

  mount(parent: HTMLElement): this {
    parent.append(this.element);
    return this;
  }

  get isShown(): boolean {
    return !this.element.hidden;
  }

  /** Shows a line, replacing the last one. */
  show(line: BobLine): void {
    const icon = line.icon === true;
    this.element.classList.toggle("guide-bob--tip", icon);
    this.portrait.src = icon ? BOB_ICON : bobBust(line.mood);
    this.portrait.dataset.mood = icon ? "icon" : (line.mood ?? "happy");

    this.text.replaceChildren(typeof line.text === "string" ? document.createTextNode(line.text) : line.text);

    const controls: HTMLElement[] = [];
    if (line.skip) {
      const skip = el("button", "guide-bob__skip");
      skip.type = "button";
      skip.textContent = line.skip.label;
      skip.addEventListener("click", line.skip.onClick);
      controls.push(skip);
    }
    if (line.dots && line.dots.count > 1) {
      const dots = el("span", "guide-bob__dots");
      dots.setAttribute("aria-label", `${line.dots.index + 1} of ${line.dots.count}`);
      for (let i = 0; i < line.dots.count; i++) {
        const dot = el("span", "guide-bob__dot");
        if (i === line.dots.index) dot.classList.add("guide-bob__dot--on");
        dots.append(dot);
      }
      controls.push(dots);
    }
    for (const action of line.actions ?? []) {
      const button = el("button", action.primary ? "btn btn--primary guide-bob__action" : "btn guide-bob__action");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      controls.push(button);
    }
    this.controls.replaceChildren(...controls);
    this.controls.hidden = controls.length === 0;
    this.element.hidden = false;
  }

  /**
   * Moves the bubble out of the way of what it points at: to the top of the
   * screen when the target sits where the bubble would (bottom left).
   */
  setAlternate(alternate: boolean): void {
    this.element.classList.toggle("guide-bob--alt", alternate);
  }

  hide(): void {
    this.element.hidden = true;
  }

  destroy(): void {
    this.element.remove();
  }
}
