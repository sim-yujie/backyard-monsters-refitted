/**
 * The account settings dialog: change username and the Shiny Lock switch,
 * opened from the account menu. Its "Game effects" and "Building art" parts
 * are kept in this browser only: no server.
 *
 * Both are server rules this only fronts. A rename keeps the game's username
 * rules and a long cooldown (`changeUsername.ts`); Shiny Lock makes the server
 * refuse every Shiny spend until it is turned off again (`shinyLock.ts`).
 */

import { changeUsername, fetchAccount, setShinyLocked, type AccountInfo } from "@/api/account";
import { fetchBlocked, setPrivacy, unblockPlayer, type BlockedPlayer, type PrivacySettings } from "@/api/privacy";
import { ApiError, NetworkError } from "@/api/http";
import { usernameProblem } from "@/game/account/rules/accountRules";
import { saveClassicArt, savedClassicArt } from "@/game/classicArt";
import { effectsQuality, screenShakeOn, setEffectsQuality, setScreenShake, type EffectsQuality } from "@/game/attack/juice";
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
  privacyTitle: "Privacy",
  hideOnlineLabel: "Show when I'm online",
  hideOnlineHint: "When off, friends see no online dot or last-seen time.",
  friendRequestsLabel: "Accept friend requests",
  friendRequestsHint: "When off, nobody can send you a friend request.",
  privacyFailed: "Could not save that privacy setting. Try again.",
  blockedTitle: "Blocked players",
  blockedNone: "You have not blocked anyone.",
  blockedLoadFailed: "Could not load your blocked players.",
  unblock: "Unblock",
  unblockFailed: "Could not unblock that player. Try again.",
  effectsTitle: "Game effects",
  shakeLabel: "Screen shake",
  shakeHint: "The screen jolts on big hits in a fight.",
  shakeReducedHint: "Off, because your device asks for less motion.",
  qualityLabel: "Effects",
  qualityFull: "Full",
  qualityLow: "Low",
  qualityHint: "Low draws fewer sparks and glows, for slower phones. Phones start on Low.",
  artTitle: "Art",
  classicArtLabel: "Classic art (original Flash look)",
  classicArtHint: "Buildings, monsters and champions as they looked in the original game.",
  classicArtSaved: "Saved. Reload the page to see the change.",
  classicArtFailed: "Could not save this in your browser. Check that site data is allowed.",
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
      body.replaceChildren(
        usernameSection(account, options),
        shinySection(account),
        privacySection(account.privacy),
        effectsSection(),
        artSection(),
      );
      popup.focusFirst();
    },
    () => {
      status.textContent = SETTINGS_TEXT.loadFailed;
      status.classList.add("field__hint--error");
      // Kept in this browser, so they work without the server.
      body.append(effectsSection(), artSection());
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

/** One switch that saves as soon as it is flipped and goes back if the save fails. */
const privacyToggle = (
  id: string,
  label: string,
  hintText: string,
  checked: boolean,
  save: (wanted: boolean) => Promise<boolean>,
): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const row = document.createElement("label");
  row.className = "account-settings__toggle";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.id = id;
  box.checked = checked;
  const words = document.createElement("span");
  words.textContent = label;
  row.append(box, words);
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = `${id}-hint`;
  hint.setAttribute("aria-live", "polite");
  hint.textContent = hintText;
  box.setAttribute("aria-describedby", hint.id);
  box.addEventListener("change", () => {
    const wanted = box.checked;
    box.disabled = true;
    hint.classList.remove("field__hint--error");
    save(wanted).then(
      (stored) => {
        box.checked = stored;
        hint.textContent = hintText;
        box.disabled = false;
      },
      () => {
        box.checked = !wanted;
        hint.textContent = SETTINGS_TEXT.privacyFailed;
        hint.classList.add("field__hint--error");
        box.disabled = false;
      },
    );
  });
  section.append(row, hint);
  return section;
};

/** Whether the device asks for less motion: the shake stays off then, whatever the switch says. */
const osReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Game effects (beta.5 tower attack effects): the "Screen shake" switch and "Effects: Full / Low". */
const effectsSection = (): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const heading = document.createElement("h3");
  heading.className = "account-settings__heading";
  heading.textContent = SETTINGS_TEXT.effectsTitle;

  const shakeRow = document.createElement("label");
  shakeRow.className = "account-settings__toggle";
  const shake = document.createElement("input");
  shake.type = "checkbox";
  shake.id = "settings-screen-shake";
  const still = osReducedMotion();
  shake.checked = !still && screenShakeOn();
  shake.disabled = still;
  const shakeWords = document.createElement("span");
  shakeWords.textContent = SETTINGS_TEXT.shakeLabel;
  shakeRow.append(shake, shakeWords);
  const shakeHint = document.createElement("p");
  shakeHint.className = "field__hint";
  shakeHint.id = "settings-screen-shake-hint";
  shakeHint.textContent = still ? SETTINGS_TEXT.shakeReducedHint : SETTINGS_TEXT.shakeHint;
  shake.setAttribute("aria-describedby", shakeHint.id);
  shake.addEventListener("change", () => setScreenShake(shake.checked));

  const qualityRow = document.createElement("label");
  qualityRow.className = "account-settings__toggle";
  const qualityWords = document.createElement("span");
  qualityWords.textContent = SETTINGS_TEXT.qualityLabel;
  const quality = document.createElement("select");
  quality.id = "settings-effects-quality";
  quality.className = "account-settings__select";
  for (const [value, text] of [
    ["full", SETTINGS_TEXT.qualityFull],
    ["low", SETTINGS_TEXT.qualityLow],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    quality.append(option);
  }
  quality.value = effectsQuality();
  qualityRow.append(qualityWords, quality);
  const qualityHint = document.createElement("p");
  qualityHint.className = "field__hint";
  qualityHint.id = "settings-effects-quality-hint";
  qualityHint.textContent = SETTINGS_TEXT.qualityHint;
  quality.setAttribute("aria-describedby", qualityHint.id);
  quality.addEventListener("change", () => setEffectsQuality(quality.value as EffectsQuality));

  section.append(heading, shakeRow, shakeHint, qualityRow, qualityHint);
  return section;
};

/**
 * Art: "Classic art" brings back the Flash look for everything the revamp
 * repainted, buildings, monsters, champions and their portraits (owner, 28 Oct
 * 2026; `game/classicArt.ts`). The yard is already drawn, so the choice shows
 * from the next load.
 */
const artSection = (): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const heading = document.createElement("h3");
  heading.className = "account-settings__heading";
  heading.textContent = SETTINGS_TEXT.artTitle;

  const row = document.createElement("label");
  row.className = "account-settings__toggle";
  const classic = document.createElement("input");
  classic.type = "checkbox";
  classic.id = "settings-classic-art";
  classic.checked = savedClassicArt();
  const words = document.createElement("span");
  words.textContent = SETTINGS_TEXT.classicArtLabel;
  row.append(classic, words);
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-classic-art-hint";
  hint.setAttribute("aria-live", "polite");
  hint.textContent = SETTINGS_TEXT.classicArtHint;
  classic.setAttribute("aria-describedby", hint.id);
  classic.addEventListener("change", () => {
    const saved = saveClassicArt(classic.checked);
    hint.textContent = saved ? SETTINGS_TEXT.classicArtSaved : SETTINGS_TEXT.classicArtFailed;
    hint.classList.toggle("field__hint--error", !saved);
  });

  section.append(heading, row, hint);
  return section;
};

/** Privacy: the two switches and the blocked players with Unblock (friends WP9). */
const privacySection = (privacy: PrivacySettings): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const heading = document.createElement("h3");
  heading.className = "account-settings__heading";
  heading.textContent = SETTINGS_TEXT.privacyTitle;
  section.append(
    heading,
    // The switch says "show", the server stores "hide".
    privacyToggle("settings-show-online", SETTINGS_TEXT.hideOnlineLabel, SETTINGS_TEXT.hideOnlineHint, !privacy.hideOnline, async (wanted) =>
      !(await setPrivacy({ hideOnline: !wanted })).hideOnline,
    ),
    privacyToggle("settings-friend-requests", SETTINGS_TEXT.friendRequestsLabel, SETTINGS_TEXT.friendRequestsHint, privacy.friendRequests, async (wanted) =>
      (await setPrivacy({ friendRequests: wanted })).friendRequests,
    ),
    blockedSection(),
  );
  return section;
};

const blockedSection = (): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const heading = document.createElement("h3");
  heading.className = "account-settings__heading";
  heading.textContent = SETTINGS_TEXT.blockedTitle;
  const list = document.createElement("ul");
  list.className = "account-settings__blocked";
  list.id = "settings-blocked";
  const note = document.createElement("p");
  note.className = "field__hint";
  note.setAttribute("aria-live", "polite");
  note.textContent = "Loading…";
  section.append(heading, list, note);

  const show = (blocked: BlockedPlayer[]): void => {
    list.replaceChildren(...blocked.map((player) => blockedRow(player, note, list)));
    note.classList.remove("field__hint--error");
    note.textContent = blocked.length === 0 ? SETTINGS_TEXT.blockedNone : "";
  };
  fetchBlocked().then(show, () => {
    note.textContent = SETTINGS_TEXT.blockedLoadFailed;
    note.classList.add("field__hint--error");
  });
  return section;
};

const blockedRow = (
  player: BlockedPlayer,
  note: HTMLElement,
  list: HTMLElement,
): HTMLElement => {
  const row = document.createElement("li");
  row.className = "account-settings__blocked-row";
  row.dataset["userid"] = String(player.userid);
  const name = document.createElement("span");
  name.textContent = player.username;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--ghost";
  button.textContent = SETTINGS_TEXT.unblock;
  button.addEventListener("click", () => {
    button.disabled = true;
    unblockPlayer(player.userid).then(
      () => {
        row.remove();
        const left = list.children.length;
        note.classList.remove("field__hint--error");
        note.textContent = left === 0 ? SETTINGS_TEXT.blockedNone : "";
      },
      () => {
        button.disabled = false;
        note.textContent = SETTINGS_TEXT.unblockFailed;
        note.classList.add("field__hint--error");
      },
    );
  });
  row.append(name, button);
  return row;
};
