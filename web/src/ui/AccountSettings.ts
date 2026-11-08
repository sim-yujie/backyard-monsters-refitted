/**
 * The Settings dialog, opened from the account menu, in three tabs (owner,
 * 5 Nov 2026): Account (avatar, username, Shiny Lock), Look and sound, and
 * Social (world chat, country, the privacy switches, blocked and muted players). "World
 * chat", "Game effects" and "Look and sound" are kept in this browser only: no
 * server, except the volume sliders, which the account menu has too
 * (`ui/SoundSliders.ts`).
 *
 * Both are server rules this only fronts. A rename keeps the game's username
 * rules and a long cooldown (`changeUsername.ts`); Shiny Lock makes the server
 * refuse every Shiny spend until it is turned off again (`shinyLock.ts`).
 */

import { reduceEffects, setReduceEffects } from "@/game/attack/juice";
import type { AvatarPicker } from "@/ui/AvatarPicker";
import { SoundSliders } from "@/ui/SoundSliders";
import { changeUsername, fetchAccount, setShinyLocked, type AccountInfo } from "@/api/account";
import {
  fetchBlocked,
  fetchMuted,
  setPrivacy,
  unblockPlayer,
  unmutePlayer,
  type BlockedPlayer,
  type PrivacySettings,
} from "@/api/privacy";
import { setCountry, type CountrySettings } from "@/api/country";
import { countryLabelNodes } from "@/ui/countryFlag";
import { worldChat } from "@/game/chat/chatSession";
import { CountryPicker } from "@/ui/CountryPicker";
import "@/ui/styles/country.css";
import { ApiError, NetworkError } from "@/api/http";
import { usernameProblem } from "@/game/account/rules/accountRules";
import { saveClassicLook, savedClassicLook, saveMusicChoice, savedMusicChoice, type MusicChoice } from "@/game/classicLook";
import { setWorldChatOn, worldChatOn } from "@/game/chat/worldChatSetting";
import { effectsQuality, screenShakeOn, setEffectsQuality, setScreenShake, type EffectsQuality } from "@/game/attack/juice";
import { quality as downloadQuality, setQuality, type Quality } from "@/game/quality";
import { noteShinyLock } from "@/game/shinyLock";
import { savedFontChoice, setFontChoice, type FontChoice } from "@/ui/fontChoice";
import { Popup } from "@/ui/Popup";
import { reportLook } from "@/app/lookReport";

export const SETTINGS_TEXT = {
  title: "Settings",
  tabAccount: "Account",
  tabLook: "Look and sound",
  tabSocial: "Social",
  reduceLabel: "Reduce effects",
  reduceHint: "Turns off screen shake, hit pauses and slow motion in attacks, with fewer particles.",
  loadFailed: "Could not load your account. Try again.",
  usernameLabel: "Username",
  usernameHint: "2 to 12 letters, numbers or underscores. You can change it once every 6 months.",
  change: "Change username",
  shinyLabel: "Shiny Lock",
  shinyHint: "Hides your Shiny (the counter shows a lock) and stops you spending it. Your Shiny is kept.",
  shinyFailed: "Could not save the Shiny Lock setting. Try again.",
  privacyTitle: "Privacy",
  hideOnlineLabel: "Show when I'm online",
  hideOnlineHint: "When off, friends see no online dot or last-seen time.",
  friendRequestsLabel: "Accept friend requests",
  friendRequestsHint: "When off, nobody can send you a friend request.",
  privacyFailed: "Could not save that privacy setting. Try again.",
  chatLabel: "World chat",
  chatHint: "Off hides the chat box and stops chat messages.",
  countryTitle: "Country",
  countryNotSet: "Not set",
  countryHint: "Pick your country to get its own chat room beside Global.",
  countryRoom: "Your country has its own chat room, next to Global in the chat box.",
  countryFailed: "Could not save your country. Try again.",
  blockedTitle: "Blocked players",
  blockedNone: "You have not blocked anyone.",
  blockedLoadFailed: "Could not load your blocked players.",
  blockedSearch: "Search blocked players",
  unblock: "Unblock",
  unblockAsk: (name: string) => `Unblock ${name}?`,
  unblockFailed: "Could not unblock that player. Try again.",
  mutedTitle: "Muted players",
  mutedNone: "You have not muted anyone.",
  mutedLoadFailed: "Could not load your muted players.",
  mutedSearch: "Search muted players",
  unmute: "Unmute",
  unmuteAsk: (name: string) => `Unmute ${name}?`,
  unmuteFailed: "Could not unmute that player. Try again.",
  noMatch: "No match.",
  confirm: "Confirm",
  cancel: "Cancel",
  effectsTitle: "Game effects",
  shakeLabel: "Screen shake",
  shakeHint: "The screen jolts on big hits in a fight.",
  shakeReducedHint: "Off, because your device asks for less motion.",
  qualityLabel: "Effects",
  qualityFull: "Full",
  qualityLow: "Low",
  qualityHint: "Low draws fewer sparks and glows, for slower phones. Phones start on Low.",
  lookTitle: "Look and sound",
  lookLabel: "Style",
  lookModern: "Modern",
  lookClassic: "Classic (original Flash)",
  lookHint: "Classic shows and plays the game as the original did. Applies after a reload.",
  lookSaved: "Saved. Reload the page to see the change.",
  musicLabel: "Music",
  musicStyle: "Same as Style",
  musicNew: "New",
  musicFlash: "Original Flash",
  musicHint: "The yard tune, whatever the Style.",
  musicSaved: "Saved. Reload the page to hear the change.",
  lookFailed: "Could not save this in your browser. Check that site data is allowed.",
  fontLabel: "Font",
  fontGame: "Game font",
  fontClear: "Clear",
  fontReadable: "Extra readable",
  fontHint: {
    game: "The game's own round letters everywhere.",
    clear: "Game letters for titles, plainer letters for the rest.",
    readable: "Plain letters that are easy to tell apart, everywhere.",
  },
  downloadLabel: "Quality",
  downloadHigh: "High",
  downloadMedium: "Medium",
  downloadLow: "Low",
  downloadHint: {
    high: "Sharpest monsters. Music plays at once.",
    medium: "Lighter monsters and music. Music waits until you turn it on.",
    low: "For slow internet: lightest monsters, music off, slower map updates.",
  },
  downloadSaved: "Saved. Monsters already on screen change after a reload.",
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
  /** The account menu's avatar picker; without it the Account tab has none. */
  readonly avatarPicker?: AvatarPicker;
}

const SETTINGS_TABS = [
  { id: "account", label: SETTINGS_TEXT.tabAccount },
  { id: "look", label: SETTINGS_TEXT.tabLook },
  { id: "social", label: SETTINGS_TEXT.tabSocial },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

/**
 * The tab strip and its three panes, the Account tab showing; returns the
 * panes. Only the panes scroll, in their own box under the strip, so the tabs
 * never scroll out of sight (owner, 6 Nov 2026).
 */
const settingsTabs = (body: HTMLElement): Record<SettingsTab, HTMLElement> => {
  const strip = document.createElement("div");
  strip.className = "tabs tab-row account-settings__tabs";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", SETTINGS_TEXT.title);
  const tabs = new Map<SettingsTab, HTMLButtonElement>();
  const panes = {} as Record<SettingsTab, HTMLElement>;
  const scroll = document.createElement("div");
  scroll.className = "tab-scroll account-settings__scroll";
  let active: SettingsTab = "account";
  const show = (id: SettingsTab): void => {
    // Another tab opens at its top.
    if (id !== active) scroll.scrollTop = 0;
    active = id;
    for (const [tabId, tab] of tabs) {
      const on = tabId === id;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      panes[tabId].hidden = !on;
    }
  };
  for (const { id, label } of SETTINGS_TABS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tabs__tab account-settings__tab";
    tab.id = `account-settings-tab-${id}`;
    tab.dataset["tab"] = id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `account-settings-pane-${id}`);
    tab.textContent = label;
    tab.addEventListener("click", () => show(id));
    strip.append(tab);
    tabs.set(id, tab);
    const pane = document.createElement("div");
    pane.className = "account-settings__pane";
    pane.id = `account-settings-pane-${id}`;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", tab.id);
    panes[id] = pane;
  }
  strip.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const ids = SETTINGS_TABS.map((tab) => tab.id);
    const at = ids.indexOf(active);
    const next = ids[(at + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]!;
    show(next);
    tabs.get(next)?.focus();
    event.preventDefault();
  });
  scroll.append(panes.account, panes.look, panes.social);
  body.append(strip, scroll);
  show(active);
  return panes;
};

/** Opens the dialog; returns it so a caller can close it. */
export const openAccountSettings = (options: AccountSettingsOptions): Popup => {
  const popup = new Popup({ title: SETTINGS_TEXT.title, className: "account-settings-popup" });
  const body = document.createElement("div");
  body.className = "account-settings";
  const status = document.createElement("p");
  status.className = "field__hint";
  status.textContent = "Loading…";
  const panes = settingsTabs(body);
  // The avatar and the Look and sound tab need nothing from this load.
  if (options.avatarPicker) panes.account.append(options.avatarPicker.element);
  panes.account.append(status);
  panes.look.append(lookSection(), effectsSection());
  popup.setContent(body).mount(options.container);

  fetchAccount().then(
    (account) => {
      noteShinyLock(account.shinyLocked);
      status.remove();
      panes.account.append(usernameSection(account, options), shinySection(account));
      // Country last: its long list would push the switches out of sight.
      panes.social.append(chatSection(), privacySection(account.privacy), countrySection(account.country));
    },
    () => {
      status.textContent = SETTINGS_TEXT.loadFailed;
      status.classList.add("field__hint--error");
      // Kept in this browser, so it works without the server.
      panes.social.append(chatSection());
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
        noteShinyLock(stored);
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

/**
 * The player's country (owner 3 Nov 2026): what is stored now, and a
 * searchable list that saves on a pick. A country with a room switches the
 * chat box to it at once (`worldChat.setCountryRoom`).
 */
const countrySection = (stored: CountrySettings): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const heading = document.createElement("h3");
  heading.className = "account-settings__heading";
  heading.textContent = SETTINGS_TEXT.countryTitle;

  const now = document.createElement("p");
  now.className = "account-settings__country-now";
  now.id = "settings-country-now";
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-country-hint";
  hint.setAttribute("aria-live", "polite");

  const show = (settings: CountrySettings): void => {
    if (settings.country) now.replaceChildren(...countryLabelNodes(settings.country));
    else now.textContent = SETTINGS_TEXT.countryNotSet;
    hint.textContent = settings.countryChannel ? SETTINGS_TEXT.countryRoom : SETTINGS_TEXT.countryHint;
    hint.classList.remove("field__hint--error");
  };
  show(stored);

  const picker = new CountryPicker({
    selected: stored.country,
    onPick: (code) => {
      picker.setDisabled(true);
      setCountry(code).then(
        (settings) => {
          picker.setSelected(settings.country);
          picker.setDisabled(false);
          show(settings);
          worldChat.setCountryRoom(settings.countryChannel, settings.country);
        },
        () => {
          picker.setDisabled(false);
          hint.textContent = SETTINGS_TEXT.countryFailed;
          hint.classList.add("field__hint--error");
        },
      );
    },
  });
  picker.search.id = "settings-country-search";
  picker.search.setAttribute("aria-describedby", hint.id);

  section.append(heading, now, hint, picker.element);
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

/**
 * "World chat" (owner, 1 Nov 2026): off takes the chat box away and closes
 * world chat's connection at once (`game/chat/worldChatSetting.ts`); on brings
 * both back, no reload.
 */
const chatSection = (): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const row = document.createElement("label");
  row.className = "account-settings__toggle";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.id = "settings-world-chat";
  box.checked = worldChatOn();
  const words = document.createElement("span");
  words.textContent = SETTINGS_TEXT.chatLabel;
  row.append(box, words);
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-world-chat-hint";
  hint.setAttribute("aria-live", "polite");
  hint.textContent = SETTINGS_TEXT.chatHint;
  box.setAttribute("aria-describedby", hint.id);
  box.addEventListener("change", () => {
    const saved = setWorldChatOn(box.checked);
    hint.textContent = saved ? SETTINGS_TEXT.chatHint : SETTINGS_TEXT.lookFailed;
    hint.classList.toggle("field__hint--error", !saved);
  });
  section.append(row, hint);
  return section;
};

/** Whether the device asks for less motion: the shake stays off then, whatever the switch says. */
const osReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Game effects (beta.5 tower attack effects): the "Screen shake" switch and
 * "Effects: Full / Low"; and "Quality: High / Medium / Low", how much the game
 * downloads (`game/quality.ts`, owner 28 Oct 2026).
 */
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

  const reduceRow = document.createElement("label");
  reduceRow.className = "account-settings__toggle";
  const reduce = document.createElement("input");
  reduce.type = "checkbox";
  reduce.id = "settings-reduce-effects";
  reduce.checked = reduceEffects();
  const reduceWords = document.createElement("span");
  reduceWords.textContent = SETTINGS_TEXT.reduceLabel;
  reduceRow.append(reduce, reduceWords);
  const reduceHint = document.createElement("p");
  reduceHint.className = "field__hint";
  reduceHint.id = "settings-reduce-effects-hint";
  reduceHint.textContent = SETTINGS_TEXT.reduceHint;
  reduce.setAttribute("aria-describedby", reduceHint.id);
  reduce.addEventListener("change", () => setReduceEffects(reduce.checked));

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

  section.append(heading, reduceRow, reduceHint, shakeRow, shakeHint, qualityRow, qualityHint, ...downloadRow());
  return section;
};

/** "Quality: High / Medium / Low", with a line saying what the chosen level does. */
const downloadRow = (): HTMLElement[] => {
  const row = document.createElement("label");
  row.className = "account-settings__toggle";
  const words = document.createElement("span");
  words.textContent = SETTINGS_TEXT.downloadLabel;
  const select = document.createElement("select");
  select.id = "settings-quality";
  select.className = "account-settings__select";
  for (const [value, text] of [
    ["high", SETTINGS_TEXT.downloadHigh],
    ["medium", SETTINGS_TEXT.downloadMedium],
    ["low", SETTINGS_TEXT.downloadLow],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  select.value = downloadQuality();
  row.append(words, select);
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-quality-hint";
  hint.setAttribute("aria-live", "polite");
  hint.textContent = SETTINGS_TEXT.downloadHint[select.value as Quality];
  select.setAttribute("aria-describedby", hint.id);
  select.addEventListener("change", () => {
    const level = select.value as Quality;
    setQuality(level);
    reportLook();
    hint.textContent = `${SETTINGS_TEXT.downloadHint[level]} ${SETTINGS_TEXT.downloadSaved}`;
  });
  return [row, hint];
};

/**
 * Look and sound (owner, 28 Oct 2026): Modern, or Classic, the game as Flash
 * looked and sounded wherever Flash had a version (`game/classicLook.ts`).
 * The yard is already drawn, so the choice shows from the next load.
 */
const lookSection = (): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const heading = document.createElement("h3");
  heading.className = "account-settings__heading";
  heading.textContent = SETTINGS_TEXT.lookTitle;

  const row = document.createElement("label");
  row.className = "account-settings__toggle";
  const words = document.createElement("span");
  words.textContent = SETTINGS_TEXT.lookLabel;
  const look = document.createElement("select");
  look.id = "settings-look";
  look.className = "account-settings__select";
  for (const [value, text] of [
    ["modern", SETTINGS_TEXT.lookModern],
    ["classic", SETTINGS_TEXT.lookClassic],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    look.append(option);
  }
  look.value = savedClassicLook() ? "classic" : "modern";
  row.append(words, look);
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-look-hint";
  hint.setAttribute("aria-live", "polite");
  hint.textContent = SETTINGS_TEXT.lookHint;
  look.setAttribute("aria-describedby", hint.id);
  look.addEventListener("change", () => {
    const saved = saveClassicLook(look.value === "classic");
    if (saved) reportLook();
    hint.textContent = saved ? SETTINGS_TEXT.lookSaved : SETTINGS_TEXT.lookFailed;
    hint.classList.toggle("field__hint--error", !saved);
  });

  // The volume sliders, as in the account menu (owner, 4 Nov 2026); saved with the account.
  const sound = new SoundSliders("account-settings__sound");
  section.append(heading, row, hint, ...fontRows(), ...musicRows(), sound.element);
  return section;
};

/** The face each Font option is shown in, so the list itself is a preview. */
const FONT_PREVIEW: Record<FontChoice, string> = {
  game: '"Titan One", sans-serif',
  clear: '"Nunito", sans-serif',
  readable: '"Atkinson Hyperlegible", sans-serif',
};

/**
 * Font (owner, 4 Nov 2026: players found the font hard to read): the game font,
 * Clear or Extra readable (`ui/fontChoice.ts`). Unlike the Style, it shows at
 * once: every panel follows the font variables.
 */
const fontRows = (): HTMLElement[] => {
  const row = document.createElement("label");
  row.className = "account-settings__toggle";
  const words = document.createElement("span");
  words.textContent = SETTINGS_TEXT.fontLabel;
  const font = document.createElement("select");
  font.id = "settings-font";
  font.className = "account-settings__select";
  for (const [value, text] of [
    ["game", SETTINGS_TEXT.fontGame],
    ["clear", SETTINGS_TEXT.fontClear],
    ["readable", SETTINGS_TEXT.fontReadable],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.style.fontFamily = FONT_PREVIEW[value];
    font.append(option);
  }
  font.value = savedFontChoice();
  row.append(words, font);
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-font-hint";
  hint.setAttribute("aria-live", "polite");
  hint.textContent = SETTINGS_TEXT.fontHint[font.value as FontChoice];
  font.setAttribute("aria-describedby", hint.id);
  font.addEventListener("change", () => {
    const choice = font.value as FontChoice;
    const saved = setFontChoice(choice);
    if (saved) reportLook();
    hint.textContent = saved ? SETTINGS_TEXT.fontHint[choice] : SETTINGS_TEXT.lookFailed;
    hint.classList.toggle("field__hint--error", !saved);
  });
  return [row, hint];
};

/** Music on its own (a player's request, 31 Oct 2026): the new yard tune or Flash's, whatever the Style. */
const musicRows = (): HTMLElement[] => {
  const row = document.createElement("label");
  row.className = "account-settings__toggle";
  const words = document.createElement("span");
  words.textContent = SETTINGS_TEXT.musicLabel;
  const music = document.createElement("select");
  music.id = "settings-music";
  music.className = "account-settings__select";
  for (const [value, text] of [
    ["style", SETTINGS_TEXT.musicStyle],
    ["new", SETTINGS_TEXT.musicNew],
    ["flash", SETTINGS_TEXT.musicFlash],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    music.append(option);
  }
  music.value = savedMusicChoice();
  row.append(words, music);
  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-music-hint";
  hint.setAttribute("aria-live", "polite");
  hint.textContent = SETTINGS_TEXT.musicHint;
  music.setAttribute("aria-describedby", hint.id);
  music.addEventListener("change", () => {
    const saved = saveMusicChoice(music.value as MusicChoice);
    if (saved) reportLook();
    hint.textContent = saved ? SETTINGS_TEXT.musicSaved : SETTINGS_TEXT.lookFailed;
    hint.classList.toggle("field__hint--error", !saved);
  });
  return [row, hint];
};

/** Privacy: the two switches, then the blocked and the muted players, each with its undo button (friends WP9). */
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
    playerListSection({
      id: "settings-blocked",
      title: SETTINGS_TEXT.blockedTitle,
      none: SETTINGS_TEXT.blockedNone,
      loadFailed: SETTINGS_TEXT.blockedLoadFailed,
      search: SETTINGS_TEXT.blockedSearch,
      action: SETTINGS_TEXT.unblock,
      ask: SETTINGS_TEXT.unblockAsk,
      actionFailed: SETTINGS_TEXT.unblockFailed,
      load: fetchBlocked,
      undo: unblockPlayer,
    }),
    playerListSection({
      id: "settings-muted",
      title: SETTINGS_TEXT.mutedTitle,
      none: SETTINGS_TEXT.mutedNone,
      loadFailed: SETTINGS_TEXT.mutedLoadFailed,
      search: SETTINGS_TEXT.mutedSearch,
      action: SETTINGS_TEXT.unmute,
      ask: SETTINGS_TEXT.unmuteAsk,
      actionFailed: SETTINGS_TEXT.unmuteFailed,
      load: fetchMuted,
      // The server forgets the mute even with World chat off; an open chat
      // box is told too, so their lines come back at once.
      undo: async (userid) => {
        await unmutePlayer(userid);
        worldChat.unmute(userid);
      },
    }),
  );
  return section;
};

/**
 * One list of players with an undo button each: the blocked, or the muted in
 * chat. Built like the country list (owner, 6 Nov 2026): a search box over a
 * box of about five rows that scrolls inside, so a long list never stretches
 * the window, and each undo asks first on its row.
 */
interface PlayerList {
  readonly id: string;
  readonly title: string;
  readonly none: string;
  readonly loadFailed: string;
  readonly search: string;
  readonly action: string;
  readonly ask: (name: string) => string;
  readonly actionFailed: string;
  readonly load: () => Promise<BlockedPlayer[]>;
  readonly undo: (userid: number) => Promise<void>;
}

const playerListSection = (kind: PlayerList): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section";
  const heading = document.createElement("h3");
  heading.className = "account-settings__heading";
  heading.textContent = kind.title;

  const box = document.createElement("div");
  box.className = "country-picker account-settings__players";
  box.hidden = true;
  const search = document.createElement("input");
  search.type = "search";
  search.id = `${kind.id}-search`;
  search.className = "field__input country-picker__search";
  search.placeholder = `\u{1F50D} ${kind.search}`;
  search.setAttribute("aria-label", kind.search);
  search.autocomplete = "off";
  search.disabled = true;
  const list = document.createElement("ul");
  list.className = "country-picker__list account-settings__player-list";
  list.id = kind.id;
  list.setAttribute("aria-label", kind.title);
  const noMatch = document.createElement("li");
  noMatch.className = "country-picker__none";
  noMatch.textContent = SETTINGS_TEXT.noMatch;
  box.append(search, list);

  const note = document.createElement("p");
  note.className = "field__hint";
  note.setAttribute("aria-live", "polite");
  note.textContent = "Loading…";
  section.append(heading, box, note);

  const rows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>(".account-settings__blocked-row")];
  /** Shows the rows whose name holds the search text, and "No match." when none does. */
  const filter = (): void => {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows()) {
      const match = (row.dataset["name"] ?? "").includes(query);
      row.hidden = !match;
      if (match) shown++;
    }
    if (shown === 0) list.append(noMatch);
    else noMatch.remove();
  };
  /** With nobody left, the search and the box go and the "none" line shows. */
  const settle = (): void => {
    const empty = rows().length === 0;
    box.hidden = empty;
    search.disabled = empty;
    if (empty) {
      search.value = "";
      noMatch.remove();
      note.classList.remove("field__hint--error");
      note.textContent = kind.none;
    } else {
      filter();
    }
  };
  search.addEventListener("input", filter);

  const fail = (message: string): void => {
    note.textContent = message;
    note.classList.add("field__hint--error");
  };
  const done = (row: HTMLElement): void => {
    row.remove();
    note.classList.remove("field__hint--error");
    note.textContent = "";
    settle();
  };

  kind.load().then(
    (players) => {
      list.replaceChildren(...players.map((player) => playerRow(kind, player, done, fail)));
      note.classList.remove("field__hint--error");
      note.textContent = "";
      settle();
    },
    () => fail(kind.loadFailed),
  );
  return section;
};

/** A row: the name and the undo button, which first asks ("Unmute <name>?") on the row. */
const playerRow = (
  kind: PlayerList,
  player: BlockedPlayer,
  done: (row: HTMLElement) => void,
  fail: (message: string) => void,
): HTMLElement => {
  const row = document.createElement("li");
  row.className = "account-settings__blocked-row";
  row.dataset["userid"] = String(player.userid);
  row.dataset["name"] = player.username.toLowerCase();
  const name = document.createElement("span");
  name.className = "account-settings__player-name";
  name.textContent = player.username;

  const askButton = document.createElement("button");
  askButton.type = "button";
  askButton.className = "btn btn--ghost block-button__ask";
  askButton.textContent = kind.action;

  const confirm = document.createElement("span");
  confirm.className = "block-button__confirm";
  confirm.hidden = true;
  const question = document.createElement("span");
  question.className = "block-button__question";
  question.textContent = kind.ask(player.username);
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "btn btn--primary block-button__yes";
  yes.textContent = SETTINGS_TEXT.confirm;
  const no = document.createElement("button");
  no.type = "button";
  no.className = "btn btn--outline block-button__no";
  no.textContent = SETTINGS_TEXT.cancel;
  // Confirm and Cancel stay together: on a phone the question takes its own
  // line and the pair sits under it (owner, 6 Nov 2026).
  const choices = document.createElement("span");
  choices.className = "account-settings__choices";
  choices.append(yes, no);
  confirm.append(question, choices);

  const asking = (on: boolean): void => {
    name.hidden = on;
    askButton.hidden = on;
    confirm.hidden = !on;
    (on ? yes : askButton).focus();
  };
  askButton.addEventListener("click", () => asking(true));
  no.addEventListener("click", () => asking(false));
  yes.addEventListener("click", () => {
    yes.disabled = true;
    no.disabled = true;
    kind.undo(player.userid).then(
      () => done(row),
      () => {
        yes.disabled = false;
        no.disabled = false;
        asking(false);
        fail(kind.actionFailed);
      },
    );
  });

  row.append(name, askButton, confirm);
  return row;
};
