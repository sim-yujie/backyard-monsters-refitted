import {
  NOTIFICATION_CATEGORY_IDS,
  setNotificationCategory,
  type NotificationCategoryId,
} from "@/api/notificationSettings";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import "@/ui/styles/notification-settings.css";

/**
 * Settings' Notifications tab (owner, 11 Nov 2026): one switch per category
 * of the bell's list, each with its painted icon and a few words, saved on
 * the account as soon as it is flipped (`api/notificationSettings.ts`). The
 * game's own notices cannot be turned off and say why.
 *
 * A new category (alliance events, say) is one more id in
 * `NOTIFICATION_CATEGORY_IDS`, one more entry in {@link CATEGORY_TEXT}, and
 * its kinds in the server's `notificationCategories.ts`.
 */

interface CategoryText {
  readonly label: string;
  readonly hint: string;
  readonly icon: GameIconName;
}

export const NOTIFICATION_SETTINGS_TEXT = {
  title: "Notifications",
  intro: "Choose what shows in your notification bell.",
  on: "On",
  off: "Off",
  alwaysOn: "Always on",
  failed: "Could not save that. Try again.",
  loadFailed: "Could not load your notification settings. Try again later.",
} as const;

export const CATEGORY_TEXT: Readonly<Record<NotificationCategoryId, CategoryText>> = {
  attacks: {
    label: "Attacks on me",
    hint: "Your yard, Inferno or outposts attacked. Always kept in your mail too.",
    icon: "swords",
  },
  buildings: { label: "Buildings", hint: "Builds, upgrades, fortifications and repairs finished.", icon: "levelup" },
  monsters: {
    label: "Monsters and research",
    hint: "Training, research, unlocks, hatching and your champion.",
    icon: "lastarmy2",
  },
  boosts: { label: "Boosts running out", hint: "Protection, overdrives and other shop boosts ending.", icon: "tools" },
  friends: { label: "Friends and gifts", hint: "Friend requests, new friends, gifts and help.", icon: "friends" },
  achievements: { label: "Achievements", hint: "Achievements you earn.", icon: "empire" },
};

/** The game's own notices: the Radio Tower refund, a new Map Room, the starter yard. */
export const GAME_NOTICES_TEXT: CategoryText & { readonly why: string } = {
  label: "Game notices",
  hint: "Changes the game makes to your yard, such as a refund.",
  why: "These explain something the game did for you, so they always show.",
  icon: "townhall",
};

/** The row's icon, its label and hint, and a slot on the right for the switch. */
const categoryRow = (text: CategoryText, id: string): { row: HTMLElement; hint: HTMLElement } => {
  const row = document.createElement("div");
  row.className = "notif-settings__row";
  row.dataset["category"] = id;
  const icon = gameIcon(text.icon, { size: 32, decorative: true, className: "notif-settings__icon" });
  const words = document.createElement("div");
  words.className = "notif-settings__words";
  const label = document.createElement("span");
  label.className = "notif-settings__label";
  label.id = `notif-settings-${id}-label`;
  label.textContent = text.label;
  const hint = document.createElement("span");
  hint.className = "notif-settings__hint";
  hint.id = `notif-settings-${id}-hint`;
  hint.setAttribute("aria-live", "polite");
  hint.textContent = text.hint;
  words.append(label, hint);
  row.append(icon, words);
  return { row, hint };
};

/** One category's switch, saved when flipped and put back if the save fails. */
const switchRow = (
  id: NotificationCategoryId,
  on: boolean,
  save: typeof setNotificationCategory,
): HTMLElement => {
  const text = CATEGORY_TEXT[id];
  const { row, hint } = categoryRow(text, id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "notif-switch";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-labelledby", `notif-settings-${id}-label`);
  button.setAttribute("aria-describedby", hint.id);
  const track = document.createElement("span");
  track.className = "notif-switch__track";
  track.setAttribute("aria-hidden", "true");
  const state = document.createElement("span");
  state.className = "notif-switch__state";
  state.setAttribute("aria-hidden", "true");
  button.append(state, track);

  const show = (value: boolean): void => {
    button.setAttribute("aria-checked", String(value));
    row.classList.toggle("notif-settings__row--off", !value);
    state.textContent = value ? NOTIFICATION_SETTINGS_TEXT.on : NOTIFICATION_SETTINGS_TEXT.off;
  };
  show(on);

  button.addEventListener("click", () => {
    const wanted = button.getAttribute("aria-checked") !== "true";
    show(wanted);
    button.disabled = true;
    hint.textContent = text.hint;
    hint.classList.remove("notif-settings__hint--error");
    save(id, wanted).then(
      (off) => {
        show(!off.includes(id));
        button.disabled = false;
      },
      () => {
        show(!wanted);
        hint.textContent = NOTIFICATION_SETTINGS_TEXT.failed;
        hint.classList.add("notif-settings__hint--error");
        button.disabled = false;
      },
    );
  });
  row.append(button);
  return row;
};

/** The game notices' row: no switch, a lock and "Always on", and why. */
const lockedRow = (): HTMLElement => {
  const { row, hint } = categoryRow(GAME_NOTICES_TEXT, "game");
  row.classList.add("notif-settings__row--locked");
  hint.textContent = `${GAME_NOTICES_TEXT.hint} ${GAME_NOTICES_TEXT.why}`;
  const badge = document.createElement("span");
  badge.className = "notif-settings__always";
  badge.textContent = NOTIFICATION_SETTINGS_TEXT.alwaysOn;
  row.append(badge);
  return row;
};

/** The tab's content: a line saying what it is for, then one row per category, the locked one last. */
export const notificationSettingsSection = (
  off: readonly NotificationCategoryId[],
  save: typeof setNotificationCategory = setNotificationCategory,
): HTMLElement => {
  const section = document.createElement("div");
  section.className = "account-settings__section notif-settings";
  const intro = document.createElement("p");
  intro.className = "field__hint notif-settings__intro";
  intro.textContent = NOTIFICATION_SETTINGS_TEXT.intro;
  const list = document.createElement("div");
  list.className = "notif-settings__list";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", NOTIFICATION_SETTINGS_TEXT.title);
  for (const id of NOTIFICATION_CATEGORY_IDS) list.append(switchRow(id, !off.includes(id), save));
  list.append(lockedRow());
  section.append(intro, list);
  return section;
};
