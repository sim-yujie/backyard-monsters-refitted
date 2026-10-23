import { h } from "./dom";
import { icon } from "./icons";

/**
 * Light or dark: Auto follows the device (the default), or the owner picks
 * Light or Dark, remembered on this device only. The colours are the same
 * tokens either way (admin.css): `data-theme` on <html> picks the set.
 */

export type ThemeChoice = "auto" | "light" | "dark";

export const THEME_STORAGE_KEY = "bymr-admin-theme";

const CHOICES: readonly [ThemeChoice, string][] = [
  ["auto", "Auto"],
  ["light", "Light"],
  ["dark", "Dark"],
];

const isChoice = (value: unknown): value is ThemeChoice =>
  value === "auto" || value === "light" || value === "dark";

/** The saved choice, or Auto when there is none or storage is blocked. */
export const readTheme = (): ThemeChoice => {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isChoice(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
};

/** Shows the page in `choice` and remembers it (when the browser lets it). */
export const applyTheme = (choice: ThemeChoice, save = true): void => {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  if (!save) return;
  try {
    if (choice === "auto") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private windows and blocked storage: it still applies until the page closes.
  }
};

const ICONS = { auto: "auto", light: "sun", dark: "moon" } as const;

/**
 * The switch in the header (the sidebar on a computer): the phone's own
 * picker under an icon, so it fits next to Refresh; with its word on a computer.
 */
export const themePicker = (): HTMLElement => {
  const current = readTheme();
  const select = h(
    "select",
    { class: "theme-select", attrs: { "aria-label": "Light or dark" } },
    ...CHOICES.map(([value, label]) =>
      h(
        "option",
        { attrs: { value, ...(value === current && { selected: "" }) } },
        value === "auto" ? `${label} (like this device)` : label,
      ),
    ),
  );
  const shown = h("span", { class: "theme-shown" });
  const show = (choice: ThemeChoice) => {
    shown.replaceChildren(
      icon(ICONS[choice], 18),
      h("span", { class: "theme-word" }, CHOICES.find(([value]) => value === choice)![1]),
      icon("down", 16),
    );
  };
  show(current);
  select.addEventListener("change", () => {
    const choice = isChoice(select.value) ? select.value : "auto";
    applyTheme(choice);
    show(choice);
  });
  return h("label", { class: "theme-pick", attrs: { title: "Light or dark" } }, shown, select);
};
