import { searchCountries } from "@/game/account/countries";
import { countryFlagImage } from "@/ui/countryFlag";
import "@/ui/styles/country.css";

/**
 * A searchable list of every country, with its flag (country chat rooms,
 * owner 3 Nov 2026): a search box over a scrolling list, "Not set" first.
 * Used by the one-time prompt after login and by Account settings. Picking
 * only calls back; the caller saves.
 */

export const PICKER_TEXT = {
  search: "Search countries",
  notSet: "Not set",
  none: "No country matches that.",
} as const;

export interface CountryPickerOptions {
  /** The stored country, marked in the list; null for "Not set". */
  readonly selected: string | null;
  /** Called with the picked code, or null for "Not set". */
  readonly onPick: (code: string | null) => void;
  /** Offer "Not set" at the top. Defaults to true. */
  readonly notSet?: boolean;
}

export class CountryPicker {
  readonly element: HTMLElement;
  readonly search: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private selected: string | null;
  private disabled = false;

  constructor(private readonly options: CountryPickerOptions) {
    this.selected = options.selected;

    this.element = document.createElement("div");
    this.element.className = "country-picker";

    this.search = document.createElement("input");
    this.search.type = "search";
    this.search.className = "field__input country-picker__search";
    this.search.placeholder = `\u{1F50D} ${PICKER_TEXT.search}`;
    this.search.setAttribute("aria-label", PICKER_TEXT.search);
    this.search.autocomplete = "off";
    this.search.addEventListener("input", () => this.render());
    this.search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const first = this.list.querySelector<HTMLButtonElement>("button[data-code]");
      first?.click();
    });

    this.list = document.createElement("ul");
    this.list.className = "country-picker__list";
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", "Countries");
    this.list.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-code]") : null;
      if (!button || this.disabled) return;
      const code = button.dataset["code"] || null;
      this.options.onPick(code);
    });

    this.element.append(this.search, this.list);
    this.render();
  }

  /** Marks another country as the stored one. */
  setSelected(code: string | null): void {
    this.selected = code;
    this.render();
  }

  /** Greys the list while a save is on its way. */
  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.element.classList.toggle("country-picker--busy", disabled);
    for (const button of this.list.querySelectorAll("button")) button.disabled = disabled;
  }

  /** Brings the stored country into view. */
  revealSelected(): void {
    this.list.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView?.({ block: "nearest" });
  }

  private render(): void {
    const query = this.search.value;
    const items: HTMLLIElement[] = [];
    if ((this.options.notSet ?? true) && !query.trim()) {
      items.push(this.item("", PICKER_TEXT.notSet));
    }
    for (const country of searchCountries(query)) items.push(this.item(country.code, country.name));
    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "country-picker__none";
      empty.textContent = PICKER_TEXT.none;
      items.push(empty);
    }
    this.list.replaceChildren(...items);
  }

  private item(code: string, name: string): HTMLLIElement {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "country-picker__option";
    button.dataset["code"] = code;
    button.disabled = this.disabled;
    const selected = (code || null) === this.selected;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selected));
    const mark = document.createElement("span");
    mark.className = "country-picker__flag";
    if (code) mark.append(countryFlagImage(code));
    else mark.textContent = "\u{2014}";
    mark.setAttribute("aria-hidden", "true");
    const words = document.createElement("span");
    words.className = "country-picker__name";
    words.textContent = name;
    button.append(mark, words);
    item.append(button);
    return item;
  }
}
