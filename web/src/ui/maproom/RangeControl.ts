import { cellsText, type RangeSource } from "@/game/maproom/attackRange";
import { DECLARE_WAR_RANGE } from "@/game/maproom/rules/range";
import { button, el, icon } from "@/ui/maproom1/icons";

/**
 * "My range" (issue #177): the button that shows the player's attack range on
 * the map, and the legend that opens with it (the approved R-MR2-Range board).
 *
 * The legend says what the line means and lists each flinger with its reach,
 * so "why can I not attack that camp" has an answer on screen. A view only:
 * the scene decides what the range is and draws it.
 */

export interface RangeControlOptions {
  /** The player turned the overlay on or off. */
  readonly onToggle: (on: boolean) => void;
}

export class RangeControl {
  /** Goes beside the zoom buttons. */
  readonly button: HTMLButtonElement;
  /** Opens above the button while the range is shown. */
  readonly legend: HTMLElement;

  private readonly toggle: HTMLButtonElement;
  private readonly sources: HTMLElement;
  private readonly note: HTMLElement;
  private on = false;

  constructor(private readonly options: RangeControlOptions) {
    this.button = button("mr2-tool mr2-range-button");
    this.button.append(icon("range", 20, "map-icon"), el("span", "mr2-tool__label", "My range"));
    this.button.title = "Show which cells your Flingers reach";
    this.button.addEventListener("click", () => this.set(!this.on));

    this.legend = el("section", "mr2-float mr2-range-legend");
    this.legend.setAttribute("aria-label", "My attack range");

    const head = el("div", "mr2-range-legend__head");
    const title = el("h2", "mr2-range-legend__title", "My attack range");
    this.toggle = button("mr2-switch");
    this.toggle.setAttribute("role", "switch");
    this.toggle.setAttribute("aria-label", "Show my attack range");
    this.toggle.append(el("span", "mr2-switch__track"), el("span", "mr2-switch__text", "On"));
    this.toggle.addEventListener("click", () => this.set(!this.on));
    head.append(title, this.toggle);

    const key = el("div", "mr2-range-legend__key");
    key.append(
      keyRow("mr2-range-swatch mr2-range-swatch--inside", "You can attack anything inside the line"),
      keyRow("mr2-range-swatch mr2-range-swatch--outside", "Darker: out of reach", true),
    );

    this.sources = el("div", "mr2-range-legend__sources");
    this.note = el("p", "mr2-range-legend__note");
    const reaches = el("div", "mr2-range-legend__reaches");
    reaches.append(this.sources, this.note);

    this.legend.append(head, key, reaches);
    this.render();
  }

  get isOn(): boolean {
    return this.on;
  }

  /** Sets the switch without telling the scene, for its first state. */
  setOn(on: boolean): void {
    this.on = on;
    this.render();
  }

  /** The flingers the range is drawn from, and whether Declare War adds to them. */
  setSources(sources: readonly RangeSource[], declareWar: boolean): void {
    this.sources.replaceChildren(
      ...sources.map((source) => {
        const row = el("div", "mr2-range-legend__source");
        const where =
          source.kind === "main"
            ? "Your yard"
            : `Outpost ${source.col}, ${source.row}`;
        row.append(
          icon(source.kind === "main" ? "home" : "pin", 16, "map-icon mr2-range-legend__icon"),
          el("span", "mr2-range-legend__where", `${where} · Flinger level ${source.flinger}`),
          el("span", "mr2-range-legend__cells", cellsText(source.reach)),
        );
        return row;
      }),
    );
    this.note.textContent =
      sources.length === 0
        ? "None of your yards has a Flinger that reaches anything yet."
        : (declareWar
            ? `Declare War is on: each includes ${DECLARE_WAR_RANGE} bonus cells. `
            : "") +
          "A higher Flinger reaches further: 4, 6, 8, 10 cells for a yard; 1 to 4 for an outpost.";
  }

  private set(on: boolean): void {
    this.on = on;
    this.render();
    this.options.onToggle(on);
  }

  private render(): void {
    this.button.setAttribute("aria-pressed", String(this.on));
    this.toggle.setAttribute("aria-checked", String(this.on));
    this.legend.hidden = !this.on;
  }
}

const keyRow = (swatchClass: string, text: string, quiet = false): HTMLElement => {
  const row = el("div", "mr2-range-legend__row");
  const swatch = el("span", swatchClass);
  swatch.setAttribute("aria-hidden", "true");
  row.append(swatch, el("span", quiet ? "mr2-range-legend__quiet" : "", text));
  return row;
};
