import type { Page } from "@playwright/test";
import { openAchievements, openShop, pressDock } from "./game";

/**
 * Every window the layout check opens on the own yard.
 *
 * `open` returns false when the window has no way in on this screen or build
 * (the test then skips, saying so); a window that does open but breaks a rule
 * fails. `items` names the list's items when a sandbox yard always has some;
 * windows that may be empty on a fresh account (Mail, Friends, Alerts,
 * Defences, Quests) only need something drawn, an empty-state line counts.
 */
export interface WindowCase {
  readonly id: string;
  readonly label: string;
  /** The window's own class on its `.panel`. */
  readonly panel: string;
  readonly items: string | null;
  /** Click through the window's tabs and check each. */
  readonly tabs: boolean;
  readonly open: (page: Page) => Promise<boolean>;
}

const dock = (name: string) => (page: Page) => pressDock(page, name);

export const WINDOWS: readonly WindowCase[] = [
  {
    id: "build",
    label: "Build",
    panel: ".build-menu",
    items: ".build-tile",
    tabs: true,
    open: dock("build"),
  },
  {
    id: "goals",
    label: "Goals",
    panel: ".goals-panel",
    items: null,
    tabs: true,
    open: dock("goals"),
  },
  {
    id: "events",
    label: "Events",
    panel: ".events-panel",
    items: null,
    tabs: true,
    open: dock("events"),
  },
  {
    id: "quests",
    label: "Quests",
    panel: ".quests-panel",
    items: null,
    tabs: true,
    open: dock("quests"),
  },
  {
    id: "alerts",
    label: "Alerts",
    panel: ".notif-screen",
    items: null,
    tabs: true,
    open: dock("bell"),
  },
  {
    id: "defences",
    label: "Defences",
    panel: ".defences-screen",
    items: null,
    tabs: true,
    open: dock("defences"),
  },
  {
    id: "shop",
    label: "Shop",
    panel: ".shop-screen",
    items: ".shop-card",
    tabs: true,
    open: openShop,
  },
  {
    id: "mail",
    label: "Mail",
    panel: ".mail-screen",
    items: null,
    tabs: true,
    open: dock("mail"),
  },
  {
    id: "monsters",
    label: "Monsters",
    panel: ".monsters-screen",
    items: null,
    tabs: true,
    open: dock("monsters"),
  },
  {
    id: "friends",
    label: "Friends",
    panel: ".friends-screen",
    items: null,
    tabs: true,
    open: dock("friends"),
  },
  {
    id: "achievements",
    label: "Achievements",
    panel: ".ach-screen",
    items: null,
    tabs: true,
    open: openAchievements,
  },
  {
    id: "alliance",
    label: "Alliance",
    panel: ".alliance-window",
    items: null,
    tabs: true,
    open: dock("alliance"),
  },
];

/** The windows checked again with World chat open and full (the iPad report's open question). */
export const CHAT_WINDOWS: readonly string[] = ["build", "goals"];

/** At most this many tabs per window are clicked through (time on CI). */
export const MAX_TABS = 8;
