/**
 * The account settings dialog: change username and the Shiny Lock switch,
 * opened from the account menu.
 *
 * Both are server rules this only fronts. A rename keeps the game's username
 * rules and a long cooldown (`changeUsername.ts`); Shiny Lock makes the server
 * refuse every Shiny spend until it is turned off again (`shinyLock.ts`).
 */

import { changeUsername, fetchAccount, setShinyLocked, type AccountInfo } from "@/api/account";
import { ApiError, NetworkError } from "@/api/http";
import { usernameProblem } from "@/game/account/rules/accountRules";
import { Popup } from "@/ui/Popup";

export const SETTINGS_TEXT = {
  title: "Account settings",
  loadFailed: "Could not load your account. Try again.",
  usernameLabel: "Username",
  usernameHint: "2 to 12 letters, numbers or underscores. You can change it once every 6 months.",
  change: "Change username",
  shinyLabel: "Shiny Lock",
  shinyHint: "While on, Shiny cannot be spent, so a stray click never costs you any.",
  shinyFailed: "Could not save the Shiny Lock setting. Try again.",
} as const;

/** "You can change your username again on 3 Mar 2027." for the cooldown line. */
export const cooldownText = (nextChangeAt: string): string =>
  `You can change your username again on ${new Date(nextChangeAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}.`;

/** What a failed save says. */
export const settingsFailure = (caught: unknown): string => {
  if (caught instanceof NetworkError) return "Could not reach the server. Try again.";
  if (caught instanceof ApiError) return caught.message;
  return "Something went wrong. Try again.";
};

export interface AccountSettingsOptions {
  /** Where the dialog is mounted: the overlay's modal layer. */
  readonly container: HTMLElement;
  /** Called with the new name after a successful rename. */
  readonly onRenamed?: (username: string) => void;
}

/** Opens the dialog; returns it so a caller can close it. */
export const openAccountSettings = (options: AccountSettingsOptions): Popup => {
  const popup = new Popup({ title: SETTINGS_TEXT.title, className: "account-settings-popup" });
  const body = document.createElement("div");
  body.className = "account-settings";
  const status = document.createElement("p");
  status.className = "field__hint";
  status.textContent = "Loading…";
  body.append(status);
  popup.setContent(body).mount(options.container);

  fetchAccount().then(
    (account) => {
      body.replaceChildren(usernameSection(account, options), shinySection(account));
      popup.focusFirst();
    },
    () => {
      status.textContent = SETTINGS_TEXT.loadFailed;
      status.classList.add("field__hint--error");
    },
  );
  return popup;
};

const usernameSection = (account: AccountInfo, options: AccountSettingsOptions): HTMLElement => {
  const section = document.createElement("form");
  section.className = "account-settings__section";
  section.noValidate = true;

  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const label = document.createElement("label");
  label.className = "field__label";
  label.htmlFor = "settings-username";
  label.textContent = SETTINGS_TEXT.usernameLabel;
  const input = document.createElement("input");
  input.className = "field__input";
  input.id = "settings-username";
  input.value = account.username;
  input.autocapitalize = "none";
  input.spellcheck = false;
  input.autocomplete = "off";
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-username-hint";
  hint.setAttribute("aria-live", "polite");
  input.setAttribute("aria-describedby", hint.id);
  wrapper.append(label, input, hint);

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "btn btn--primary";
  button.textContent = SETTINGS_TEXT.change;

  const setHint = (text: string, kind: "error" | "ok" | null): void => {
    hint.textContent = text;
    hint.classList.toggle("field__hint--error", kind === "error");
    hint.classList.toggle("field__hint--ok", kind === "ok");
  };
  const lock = (until: string, prefix = ""): void => {
    input.disabled = true;
    button.disabled = true;
    setHint(`${prefix}${cooldownText(until)}`, prefix ? "ok" : null);
  };

  if (!account.canChangeUsername && account.nextChangeAt) lock(account.nextChangeAt);
  else setHint(SETTINGS_TEXT.usernameHint, null);

  section.append(wrapper, button);
  section.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (name === account.username) return;
    const problem = usernameProblem(name);
    if (problem) {
      input.setAttribute("aria-invalid", "true");
      setHint(problem, "error");
      return;
    }
    input.removeAttribute("aria-invalid");
    button.disabled = true;
    changeUsername(name).then(
      (result) => {
        options.onRenamed?.(result.username);
        input.value = result.username;
        lock(result.nextChangeAt, `Your username is now ${result.username}. `);
      },
      (caught: unknown) => {
        input.setAttribute("aria-invalid", "true");
        setHint(settingsFailure(caught), "error");
        button.disabled = false;
      },
    );
  });
  return section;
};

const shinySection = (account: AccountInfo): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";

  const row = document.createElement("label");
  row.className = "account-settings__toggle";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.id = "settings-shiny-lock";
  box.checked = account.shinyLocked;
  const words = document.createElement("span");
  words.textContent = SETTINGS_TEXT.shinyLabel;
  row.append(box, words);

  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-shiny-hint";
  hint.setAttribute("aria-live", "polite");
  hint.textContent = SETTINGS_TEXT.shinyHint;
  box.setAttribute("aria-describedby", hint.id);

  box.addEventListener("change", () => {
    const wanted = box.checked;
    box.disabled = true;
    hint.classList.remove("field__hint--error");
    setShinyLocked(wanted).then(
      (stored) => {
        box.checked = stored;
        hint.textContent = SETTINGS_TEXT.shinyHint;
        box.disabled = false;
      },
      () => {
        box.checked = !wanted;
        hint.textContent = SETTINGS_TEXT.shinyFailed;
        hint.classList.add("field__hint--error");
        box.disabled = false;
      },
    );
  });

  section.append(row, hint);
  return section;
};
