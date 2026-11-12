import { cellsText, type RangeSource } from "@/game/maproom/attackRange";
import { button, el, icon } from "@/ui/maproom1/icons";

/**
 * "My range" (issue #177): the legend that opens while the player's attack
 * range is drawn on the map (the approved R-MR2-Range board). Its own switch
 * turns the range off; the own yard's cell panel turns it on. The "My range"
 * button beside the zoom went in beta 6 (owner: with fog of war it showed
 * little the player could use).
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
  /** Opens above the map's tool row while the range is shown. */
  readonly legend: HTMLElement;

  private readonly toggle: HTMLButtonElement;
  private readonly sources: HTMLElement;
  private readonly note: HTMLElement;
  private on = false;

  constructor(private readonly options: RangeControlOptions) {
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

  /** The flingers the range is drawn from. */
  setSources(sources: readonly RangeSource[]): void {
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
        : "A higher Flinger reaches further: 4, 6, 8, 10 cells for a yard; 1 to 4 for an outpost.";
  }

  private set(on: boolean): void {
    this.on = on;
    this.render();
    this.options.onToggle(on);
  }

  private render(): void {
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
