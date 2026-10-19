import type { HelpKind } from "@/api/friends";
import {
  helpersOf,
  helpersText,
  repairText,
  speedupText,
  type BuildingHelpView,
  type HelpChoice,
} from "@/game/friends/helpModel";
import type { YardBuilding } from "@/game/yard/yardModel";
import { Panel } from "../Panel";
import { make } from "./rows";
import "./help.css";

/**
 * The help panel on a friend's yard (`docs/design/friends.md` §3.3, issue
 * #374): pressing a building with a wrench opens it, docked where the
 * building panel docks.
 *
 * - **Speed up**: "Takes 6m 30s off the Storage Silo upgrade (5% of the time
 *   left)" and "3 of 5 friends have helped".
 * - **Repair**: "Repairs this Cannon Tower now."
 *
 * Each button is disabled with the server's reason, in words, when the help
 * cannot go. The scene does the call (`onHelp`) and shows the panel again
 * with what the server said, plus the thank-you or the refusal.
 */

export const HELP_PANEL_TEXT = {
  speedup: "Speed up",
  repair: "Repair",
  working: "Helping…",
  nothing: "There is nothing to help with here.",
} as const;

export interface HelpPanelOptions {
  /** Runs one help; resolves once the scene has shown the outcome. */
  readonly onHelp: (building: YardBuilding, kind: HelpKind) => Promise<void>;
  readonly onClose?: () => void;
  /** Unix seconds now, for the speed-up's line; the clock by default. */
  readonly now?: () => number;
}

export class HelpPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly options: HelpPanelOptions;
  private readonly choices: HTMLElement;
  private readonly status: HTMLElement;
  private building: YardBuilding | null = null;
  private help: BuildingHelpView | null = null;
  private busy = false;

  constructor(options: HelpPanelOptions) {
    this.options = options;
    this.panel = new Panel({
      title: "Help",
      className: "map-panel help-panel",
      closeOnEscape: true,
      ...(options.onClose && { onClose: options.onClose }),
    });
    this.element = this.panel.element;
    this.choices = make("div", "help-panel__choices");
    this.status = make("p", "help-panel__status");
    this.status.setAttribute("role", "status");
    this.status.hidden = true;
    this.panel.setContent(this.choices, this.status);
  }

  /** The building shown now. */
  get shown(): YardBuilding | null {
    return this.building;
  }

  mount(container: HTMLElement): this {
    this.panel.mount(container);
    return this;
  }

  /** Shows a building and what can be done for it; keeps any message unless `clear`. */
  show(building: YardBuilding, help: BuildingHelpView | null, options: { clear?: boolean } = {}): void {
    const other = this.building?.id !== building.id;
    this.building = building;
    this.help = help;
    if (other || options.clear) this.setMessage(null);
    this.panel.setTitle(building.level > 0 ? `${building.name}, level ${building.level}` : building.name);
    this.render();
  }

  /** A thank-you (`thanks`) or a refusal (`error`) under the buttons; null hides it. */
  setMessage(text: string | null, kind: "thanks" | "error" = "thanks"): void {
    this.status.hidden = text === null;
    this.status.textContent = text ?? "";
    this.status.classList.toggle("help-panel__status--error", text !== null && kind === "error");
    this.status.classList.toggle("help-panel__status--thanks", text !== null && kind === "thanks");
  }

  /** The words under the buttons now, for a test. */
  get message(): string {
    return this.status.hidden ? "" : (this.status.textContent ?? "");
  }

  close(): void {
    this.panel.close();
  }

  private render(): void {
    const building = this.building;
    const help = this.help;
    this.choices.replaceChildren();
    if (!building) return;
    if (!help || (!help.speedup && !help.repair)) {
      this.choices.append(make("p", "help-panel__line", HELP_PANEL_TEXT.nothing));
      return;
    }
    const now = this.options.now?.() ?? Date.now() / 1000;
    if (help.speedup) {
      this.choices.append(
        this.choice("speedup", help.speedup, speedupText(building, now), helpersText(helpersOf(building))),
      );
    }
    if (help.repair) this.choices.append(this.choice("repair", help.repair, repairText(building)));
  }

  private choice(kind: HelpKind, choice: HelpChoice, line: string, note?: string): HTMLElement {
    const box = make("div", `help-panel__choice help-panel__choice--${kind}`);
    box.dataset["kind"] = kind;
    box.append(make("p", "help-panel__line", line));
    if (note) box.append(make("p", "help-panel__note", note));
    const press = make(
      "button",
      `btn ${choice.allowed ? "btn--primary" : "btn--outline"} help-panel__button`,
      this.busy ? HELP_PANEL_TEXT.working : HELP_PANEL_TEXT[kind],
    );
    press.type = "button";
    press.disabled = !choice.allowed || this.busy;
    if (choice.allowed) press.addEventListener("click", () => void this.run(kind));
    box.append(press);
    if (!choice.allowed) {
      const why = make("p", "help-panel__reason", choice.text);
      box.append(why);
      press.title = choice.text;
    }
    return box;
  }

  private async run(kind: HelpKind): Promise<void> {
    const building = this.building;
    if (!building || this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.options.onHelp(building, kind);
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
