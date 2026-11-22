import type { Page } from "@playwright/test";
import { openAchievements, openBaiterPreview, openFriendsScreen, openRepeatResult, openRepeatSheet, openShop, pressDock } from "./game";

/**
 * Every window the layout check opens on the own yard.
 *
 * `open` returns false when the window has no way in on this screen: a fail,
 * unless the window is `optional` (then the step is listed as skipped). A
 * window that opens but breaks a rule fails. `items` names the list's items
 * when a sandbox yard always has some (checked as the window opens, not on
 * every tab, since a tab may be empty);
 * windows that may be empty on a fresh account (Mail, Friends, Alerts,
 * Defences, Quests) only need something drawn, an empty-state line counts.
 */
export interface WindowCase {
  readonly id: string;
  readonly label: string;
  /** The window's own class on its `.panel`. */
  readonly panel: string;
  readonly items: string | null;
  /**
   * A window the sandbox yard may not offer (Events outside an event,
   * Alliance): no way in skips it. For every other window no way in fails.
   */
  readonly optional?: boolean;
  /** Why an optional window may have no way in, for the skipped list. */
  readonly why?: string;
  /** Click through the window's tabs and check each. */
  readonly tabs: boolean;
  /**
   * Its way out when that is not a button named "Close…" (Repeat attack's
   * Cancel), or null for none while it works (Repeat attack's bar).
   */
  readonly closeButton?: string | null;
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
    optional: true,
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
    // Its dock button shows only on a Map Room 2 main yard or an outpost
    // (YardScene setAvailable, mapRoute.ts mapRoomFor); the sandbox yard
    // is not on Map Room 2 (the first run found no Defences button).
    optional: true,
    why: "the Defences button shows only on Map Room 2 yards",
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
    // The round Friends button opens this popup (FriendsWindow.ts) in the modal layer.
    id: "friends",
    label: "Friends",
    panel: ".friends-window",
    items: null,
    tabs: false,
    open: dock("friends"),
  },
  {
    // The full Friends screen with its tabs, behind the popup's "All friends".
    id: "friends-screen",
    label: "Friends screen",
    panel: ".friends-screen",
    items: null,
    tabs: true,
    open: openFriendsScreen,
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
    optional: true,
    label: "Alliance",
    panel: ".alliance-window",
    items: null,
    tabs: true,
    open: dock("alliance"),
  },
  {
    // The Repeat attack's result (owner, 16 Nov 2026): the loot and the
    // take-over cost, with Take over, Watch and Close in sight at every size.
    // Opened from the build's preview with a conquered camp.
    id: "repeat-result",
    label: "Repeat attack result",
    panel: ".auto-attack--result",
    items: ".end-takeover__take",
    tabs: false,
    open: openRepeatResult,
  },
  {
    // Repeat attack's sheet, look A (owner, 20 Nov 2026), at its busiest:
    // eight kinds, two champions, eight moves. The camp, the army and at
    // least one whole move card in sight, Cancel and Move and attack under
    // them at every size. Opened from the build's preview.
    id: "repeat-moves",
    label: "Repeat attack, 8 moves",
    panel: ".auto-attack--prompt-moves",
    items: ".repeat-prompt__move",
    tabs: false,
    closeButton: ".auto-attack__cancel",
    open: (page) => openRepeatSheet(page, "moves8"),
  },
  {
    // Refused for short monsters: the army, then a row per shortage.
    id: "repeat-short",
    label: "Repeat attack, short monsters",
    panel: ".auto-attack--refused",
    items: ".repeat-prompt__short",
    tabs: false,
    closeButton: ".auto-attack__cancel",
    open: (page) => openRepeatSheet(page, "short-monsters"),
  },
  {
    // Refused for room in range: the army, then the room each yard has.
    id: "repeat-room",
    label: "Repeat attack, short housing",
    panel: ".auto-attack--refused",
    items: ".repeat-prompt__room-yard",
    tabs: false,
    closeButton: ".auto-attack__cancel",
    open: (page) => openRepeatSheet(page, "short-housing"),
  },
  {
    // The Attacking bar with every kind marching (owner, 20 Nov 2026).
    id: "repeat-bar",
    label: "Repeat attack, Attacking bar",
    panel: ".auto-attack--bar",
    items: ".repeat-bar",
    tabs: false,
    closeButton: null,
    open: (page) => openRepeatSheet(page, "working"),
  },
  {
    // The Baiter window's friend tabs (beta 9 #4, design A) at their busiest:
    // 17 people to invite, four open invites, three received, nine results.
    // Title, the four tabs and close in sight, a row of each list at every size.
    id: "baiter-friends",
    label: "Baiter friend tabs",
    panel: ".baiter-window",
    items: ".friends-row",
    tabs: true,
    open: (page) => openBaiterPreview(page, "invite"),
  },
  {
    // A friend's test army for their yard (beta 9 #4): Start test in reach.
    id: "baiter-friend-test",
    label: "Baiter, a friend's yard",
    panel: ".baiter-window",
    items: ".baiter__row",
    tabs: false,
    open: (page) => openBaiterPreview(page, "host"),
  },
];

/** The windows checked again with World chat open and full (the iPad report's open question). */
export const CHAT_WINDOWS: readonly string[] = ["build", "goals"];

/** At most this many tabs per window are clicked through (time on CI). */
export const MAX_TABS = 8;
