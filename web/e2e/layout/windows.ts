import type { Page } from "@playwright/test";
import {
  openAchievements,
  openBaiterPreview,
  openChampionAbilities,
  openFriendsScreen,
  openMoveTray,
  openRaidAlert,
  openRepeatResult,
  openRepeatSheet,
  openShop,
  openSmartMove,
  pressDock,
} from "./game";

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
  /** Every tab in sight at once, the row never sliding (measure.ts `allTabs`). */
  readonly allTabs?: boolean;
  /** Parts wholly in sight on every tab, without scrolling (measure.ts `inSight`). */
  readonly inSight?: string;
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
    // Its six tabs all in sight (768 px iPad upright showed "La" and no
    // Champion), and on Unlock, Train and Lab the picked monster's cost and
    // buttons without scrolling (a phone on its side had Research below the
    // fold). Old-layout fix, beta 9.
    allTabs: true,
    inSight: ".locker-detail__action",
    open: dock("monsters"),
  },
  {
    // The Champion tab's Abilities view (Monster Madness crystals, 27 Nov
    // 2026): four champion rows and Unlock, the first row's Unlock in sight.
    id: "champion-abilities",
    optional: true,
    why: "the yard has no Champion Cage or Chamber, so no Champion tab",
    label: "Champion abilities",
    panel: ".monsters-screen",
    items: ".crystal-row",
    tabs: false,
    inSight: ".crystal-abilities__held",
    open: openChampionAbilities,
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
    // Smart moving's "Bring saved army?" sheet (beta 9) at its busiest: eight
    // moves under the camp, Skip and Move & attack in sight at every size.
    id: "smart-move",
    label: "Smart moving, 8 moves",
    panel: ".smart-move",
    items: ".repeat-prompt__move",
    tabs: false,
    open: (page) => openSmartMove(page, "moves8"),
  },
  {
    // The Attack window with smart moving's "can't gather" note at its top:
    // the monsters still in sight under it, Cancel and Attack too.
    id: "smart-move-note",
    label: "Attack window, smart moving short",
    panel: ".attack-window",
    items: ".attack-window__tile",
    tabs: false,
    open: (page) => openSmartMove(page, "short-note"),
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
    // Waiting in the server's battle line (patch 9.1) at its busiest: the
    // marching army halted, the hourglass and "#20 in line" under it.
    id: "repeat-queue",
    label: "Repeat attack, in the battle line",
    panel: ".auto-attack--bar",
    items: ".auto-attack__working--line",
    tabs: false,
    closeButton: null,
    open: async (page) => {
      if (!(await openRepeatSheet(page, "queued"))) return false;
      await page.locator(".overlay__layer .auto-attack__working--line").waitFor({ timeout: 10_000 });
      return true;
    },
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
  {
    // The world map's move tray (beta 9 #7) at its busiest: Bring to an
    // outpost from every yard, seven kinds, two at as many as fit, a stepper
    // open (− n/most + Max ✓). The chips, All, the room and Go in sight at
    // every size. Opened from the build's preview (no outposts in a sandbox).
    id: "move-tray",
    label: "Move monsters tray",
    panel: ".xfer-tray",
    items: ".xfer-chip",
    tabs: false,
    open: (page) => openMoveTray(page, "in"),
  },
  {
    // Move from the main yard to one outpost: Go names the target.
    id: "move-tray-out",
    label: "Move monsters tray, one target",
    panel: ".xfer-tray",
    items: ".xfer-chip",
    tabs: false,
    open: (page) => openMoveTray(page, "out"),
  },
  {
    // The wild monster alert (beta 10) at its busiest: Threat 14, 4 sides and
    // the clock, a champion card leading three monster cards, "+N more". It
    // has no close (the player must answer): Prepare defences is its way
    // out. The pills, the champion and both answers in sight at every size.
    id: "raid-alert",
    label: "Wild monster alert, threat 14 with a champion",
    panel: ".raid-alert",
    items: ".raid-alert__monster",
    tabs: false,
    closeButton: ".raid-alert__prepare",
    inSight: ".raid-alert__stats, .raid-alert__champion, .raid-alert__actions > .btn",
    open: openRaidAlert,
  },
];

/** The windows checked again with World chat open and full (the iPad report's open question). */
export const CHAT_WINDOWS: readonly string[] = ["build", "goals"];

/** At most this many tabs per window are clicked through (time on CI). */
export const MAX_TABS = 8;
