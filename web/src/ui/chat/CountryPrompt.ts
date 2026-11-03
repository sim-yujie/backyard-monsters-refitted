import { putOffCountryPrompt, setCountry, type CountrySettings } from "@/api/country";
import { CountryPicker } from "@/ui/CountryPicker";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/country.css";

/**
 * "Where are you playing from?" (country chat rooms, owner 3 Nov 2026): a
 * small popup the own yard shows once, after login, to a player who has not
 * set a country and has not put the question off (`countryask` on the load).
 *
 * Picking a country saves it and closes; "Not now", the close button, Escape
 * or the scrim put it off for good (the server marks it asked), so it is never
 * shown again. Either way Account settings can change it later.
 */

export const PROMPT_TEXT = {
  // Short, so it fits the popup's title plate (the longer question was cut off).
  title: "Your country",
  line: "\u{1F4AC} Where do you play from? Some countries have their own chat room. You can change this any time in Account settings.",
  notNow: "Not now",
  failed: "Could not save that. Try again.",
} as const;

export interface CountryPromptApi {
  readonly setCountry: (country: string | null) => Promise<CountrySettings>;
  readonly putOff: () => Promise<CountrySettings>;
}

const defaultApi: CountryPromptApi = { setCountry, putOff: putOffCountryPrompt };

export interface CountryPromptOptions {
  readonly container: HTMLElement;
  /** Called with what the server stored, after a pick (not after "Not now"). */
  readonly onSaved: (settings: CountrySettings) => void;
  readonly api?: CountryPromptApi;
}

/** Shown already in this page: one ask per sign-in, whatever the yard loads say. */
let askedThisPage = false;

/** Forgets the page's ask, for tests. */
export const resetCountryPrompt = (): void => {
  askedThisPage = false;
};

/** Opens the prompt unless it was already shown in this page; returns it, or null. */
export const openCountryPrompt = (options: CountryPromptOptions): Popup | null => {
  if (askedThisPage) return null;
  askedThisPage = true;
  const api = options.api ?? defaultApi;

  let picked = false;
  const popup = new Popup({
    title: PROMPT_TEXT.title,
    className: "country-prompt-popup",
    closeOnBackdrop: true,
    onClose: () => {
      // Closed without a pick: put off for good. A failed save is let go; the
      // prompt comes back on a later sign-in at worst.
      if (!picked) void api.putOff().catch(() => undefined);
    },
  });

  const body = document.createElement("div");
  body.className = "country-prompt";
  const line = document.createElement("p");
  line.className = "country-prompt__line field__hint";
  line.setAttribute("aria-live", "polite");
  line.textContent = PROMPT_TEXT.line;

  const picker = new CountryPicker({
    selected: null,
    notSet: false,
    onPick: (code) => {
      if (!code) return;
      picker.setDisabled(true);
      line.classList.remove("field__hint--error");
      api.setCountry(code).then(
        (settings) => {
          picked = true;
          popup.close();
          options.onSaved(settings);
        },
        () => {
          picker.setDisabled(false);
          line.textContent = PROMPT_TEXT.failed;
          line.classList.add("field__hint--error");
        },
      );
    },
  });

  const actions = document.createElement("div");
  actions.className = "country-prompt__actions";
  const notNow = document.createElement("button");
  notNow.type = "button";
  notNow.className = "btn country-prompt__not-now";
  notNow.textContent = PROMPT_TEXT.notNow;
  notNow.addEventListener("click", () => popup.close());
  actions.append(notNow);

  body.append(line, picker.element, actions);
  popup.setContent(body).mount(options.container);
  return popup;
};
