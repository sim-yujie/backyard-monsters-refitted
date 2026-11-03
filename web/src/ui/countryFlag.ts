import { countryFlagUrl, countryName, isCountryCode } from "@/game/account/countries";
import "@/ui/styles/country.css";

/** The two letters ("PH"), shown when the flag picture cannot load. */
const letters = (code: string): HTMLSpanElement => {
  const span = document.createElement("span");
  span.className = "country-flag country-flag--letters";
  span.textContent = code;
  return span;
};

/**
 * A country's small flag picture (owner 3 Nov 2026: flags, not letters).
 * Loaded lazily; the two letters stand in if the picture fails.
 */
export const countryFlagImage = (code: string): HTMLElement => {
  const url = countryFlagUrl(code);
  if (!url) return letters(code);
  const img = document.createElement("img");
  img.className = "country-flag";
  img.src = url;
  img.alt = code;
  img.width = 20;
  img.height = 15;
  img.loading = "lazy";
  img.decoding = "async";
  img.draggable = false;
  img.addEventListener("error", () => img.replaceWith(letters(code)), { once: true });
  return img;
};

/** Flag picture then the country's name, e.g. [PH flag] "Philippines". */
export const countryLabelNodes = (code: string): Node[] =>
  isCountryCode(code)
    ? [countryFlagImage(code), document.createTextNode(countryName(code))]
    : [document.createTextNode(code)];
