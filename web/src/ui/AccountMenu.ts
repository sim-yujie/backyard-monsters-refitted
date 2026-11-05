/**
 * The HUD's Account control (issue #173): a button that opens a short menu
 * with who is signed in and an explicit Log out.
 *
 * "Account" used to be one of the screen tabs, and the screen it opened was
 * the sign-in form: nothing signed the player out, but the game vanished
 * behind an empty Email and Password, which reads as exactly that. Signing out
 * is now a thing the player asks for by name, and Account only shows who they
 * are.
 *
 * Built like the attack's phone menu (`AttackMenu`): it only reports that Log
 * out was picked, and a press elsewhere or Escape closes it.
 *
 * With an `avatar` (issue #175) the button wears the player's critter, and
 * Account settings holds the picker (`ui/AvatarPicker.ts`).
 *
 * The yard's HUD (#171) shows it as a `pill`: the player's name beside their
 * critter in a ring, rather than the word "Account", and under the name the
 * player's level with a bar to the next (`setLevel`, #192; the one place the
 * level shows, owner 5 Nov 2026).
 *
 * With `onAchievements` (issue #204) the menu has an "Achievements" item,
 * the way into the achievements screen on every screen with the HUD.
 *
 * With `onFriends` (issue #370) it has a "Friends" item, the way into the
 * Friends screen, with the count of requests and gifts waiting
 * (`setFriendsCount`); while any wait, the button wears a small count too.
 *
 * With `onLeaderboard` it has a "Leaderboard" item, which opens the board of
 * every player by empire points (`ui/leaderboard/LeaderboardDialog.ts`).
 *
 * With `onWhatsNew` it has a "What's new" item, which opens the newest
 * release's cards again (`ui/events/WhatsNewDialog.ts`).
 *
 * With `onNews` it has a "News" item, which shows the owner's current
 * announcements again (`ui/announcements/AnnouncementDialog.ts`).
 *
 * With `onReportBug` it has a "Report a bug" item, which opens the bug report
 * form (`ui/bugReport/BugReportDialog.ts`). After it, always, "Support the
 * game" (the painted heart) opens the small Patreon / Ko-fi panel
 * (`ui/support/SupportPanel.ts`), and "Join the Discord" opens the community
 * invite in a new tab.
 *
 * Under the items sit the sound rows, Music and Sound effects, each a mute and
 * a volume slider (`ui/SoundSliders.ts`), saved with the player's yard
 * (`game/sound/soundSwitches.ts`).
 */

import { DISCORD_URL } from "@/config";
import { avatarUrl, type AvatarId } from "@/game/avatars";
import { waitingText } from "@/game/friends/friendText";
import { guideTourAvailable, startGuideTour } from "@/game/guide/tour";
import { openAccountSettings } from "@/ui/AccountSettings";
import type { LevelProgress } from "@/game/yard/experience";
import { AvatarPicker, type AccountAvatar } from "@/ui/AvatarPicker";
import { formatAmount } from "@/ui/format";
import { SoundSliders } from "@/ui/SoundSliders";
import { fullscreenAvailable, isFullscreen, toggleFullscreen } from "@/ui/fullscreen";
import { gameIcon } from "@/ui/gameIcon";
import { openSupportPanel, SUPPORT_TEXT } from "@/ui/support/SupportPanel";
import "@/ui/friends/friends.css";
import "@/ui/styles/guide-start.css";

export type { AccountAvatar } from "@/ui/AvatarPicker";

export interface AccountMenuOptions {
  /** The signed-in player's name; null or empty when the server sent none. */
  readonly name: string | null | undefined;
  readonly onSignOut: () => void;
  /** The avatar, and the picker in Account settings; without it there is neither. */
  readonly avatar?: AccountAvatar;
  /**
   * "button" (default): a small button with the face and the word "Account".
   * "pill": the name and the face in a ring, the yard HUD's corner (#171).
   */
  readonly variant?: "button" | "pill";
  /** The "Achievements" item's action; without it there is no such item. */
  readonly onAchievements?: () => void;
  /** The "Friends" item's action; without it there is no such item. */
  readonly onFriends?: () => void;
  /** The "Leaderboard" item's action; without it there is no such item. */
  readonly onLeaderboard?: () => void;
  /** The "What's new" item's action; without it there is no such item. */
  readonly onWhatsNew?: () => void;
  /** The "News" item's action; without it there is no such item. */
  readonly onNews?: () => void;
  /** The "Report a bug" item's action; without it there is no such item. */
  readonly onReportBug?: () => void;
}

/** What the menu's heading says: the name, or a plain stand-in without one. */
export const accountName = (name: string | null | undefined): string => name?.trim() || "Signed in";

/** "Level 12", the pill's line under the name. */
export const levelText = (level: number): string => `Level ${level}`;

/** The level's tooltip: "1,200 points. 2,300 more for level 4." */
export const xpTitle = (xp: LevelProgress): string =>
  xp.next === null
    ? `Level ${xp.level}, the top level. ${formatAmount(xp.points)} points.`
    : `Level ${xp.level}. ${formatAmount(xp.points)} points, ${formatAmount(Math.max(0, xp.next - xp.points))} more for level ${xp.level + 1}.`;

/** The menu's line under the level: what is left to the next one. */
export const xpLeftText = (xp: LevelProgress): string =>
  xp.next === null
    ? "The top level"
    : `${formatAmount(Math.max(0, xp.next - xp.points))} points to level ${xp.level + 1}`;

/** The pill's bar to the next level; the fill's width is the fraction reached. */
const levelBar = (): { track: HTMLElement; fill: HTMLElement } => {
  const track = document.createElement("span");
  track.className = "account-menu__pill-bar";
  track.setAttribute("aria-hidden", "true");
  track.hidden = true;
  const fill = document.createElement("span");
  fill.className = "account-menu__pill-fill";
  track.append(fill);
  return { track, fill };
};

/** A sound row's tooltip after its save failed; the row is already back. */
export { SOUND_SAVE_FAILED } from "@/ui/SoundSliders";

export class AccountMenu {
  /** The button and the list, in one wrapper the list hangs from. */
  readonly element: HTMLElement;

  private readonly button: HTMLButtonElement;
  private readonly list: HTMLElement;
  /** Every picture of the current avatar: the button's and the heading's. */
  private readonly faces: HTMLImageElement[] = [];
  /** The pill's level line and bar; null on the plain button. */
  private readonly level: HTMLElement | null = null;
  private readonly levelBar: ReturnType<typeof levelBar> | null = null;
  /** The level on the critter, for the screens with no room for the line. */
  private readonly ringLevel: HTMLElement | null = null;
  /** The menu heading's points left to the next level. */
  private readonly whoNext: HTMLElement;
  /** Help's replay of the guided start; shown only while one is on offer. */
  private readonly replay: HTMLButtonElement;
  /** Enters or leaves fullscreen; hidden where the browser has none. */
  private readonly fullscreen: HTMLButtonElement;
  /** The Friends item's count and the button's; null without the item. */
  private readonly friendsCount: HTMLElement | null = null;
  private readonly buttonCount: HTMLElement | null = null;
  private friendsWaiting = 0;
  /** The sound switches' subscriptions, let go on destroy. */
  private readonly stopSound: (() => void)[] = [];
  private readonly name: string;
  private current: AvatarId | null = null;
  /** The picker Account settings shows; null without an avatar. */
  private readonly picker: AvatarPicker | null = null;

  constructor(options: AccountMenuOptions) {
    this.element = document.createElement("div");
    this.element.className = "account-menu";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "btn btn--ghost account-menu__button";
    this.name = accountName(options.name);
    const avatar = options.avatar;
    if (avatar) {
      this.current = avatar.current;
      this.picker = new AvatarPicker({
        current: avatar.current,
        picked: avatar.picked,
        onPick: async (id: AvatarId) => {
          await avatar.onPick(id);
          this.current = id;
          this.showFaces();
        },
      });
    }
    if (options.variant === "pill") {
      this.element.classList.add("account-menu--pill");
      const name = document.createElement("span");
      name.className = "account-menu__pill-text";
      const nameLine = document.createElement("span");
      nameLine.className = "account-menu__pill-name";
      nameLine.textContent = this.name;
      this.level = document.createElement("span");
      this.level.className = "account-menu__pill-level";
      this.level.hidden = true;
      this.levelBar = levelBar();
      name.append(nameLine, this.level, this.levelBar.track);
      const ring = document.createElement("span");
      ring.className = "account-menu__ring";
      if (options.avatar) ring.append(this.face("account-menu__ring-face", "full"));
      else ring.textContent = accountName(options.name).charAt(0).toUpperCase();
      this.button.className = "account-menu__button account-menu__button--pill";
      this.ringLevel = document.createElement("span");
      this.ringLevel.className = "account-menu__ring-level";
      this.ringLevel.setAttribute("aria-hidden", "true");
      this.ringLevel.hidden = true;
      this.button.append(name, ring, this.ringLevel);
      this.button.setAttribute("aria-label", `Your account: ${accountName(options.name)}`);
      this.button.title = "Your account";
    } else {
      this.button.textContent = "Account";
      if (options.avatar) this.button.prepend(this.face("account-menu__face", "small"));
    }
    this.button.setAttribute("aria-haspopup", "true");
    this.button.setAttribute("aria-expanded", "false");
    this.button.addEventListener("click", () => this.toggle(this.list.hidden));

    this.list = document.createElement("div");
    this.list.className = "account-menu__list";
    this.list.setAttribute("role", "menu");
    this.list.setAttribute("aria-label", "Account");
    this.list.hidden = true;

    const who = document.createElement("div");
    who.className = "account-menu__who";
    const whoText = document.createElement("div");
    whoText.className = "account-menu__who-text";
    const name = document.createElement("span");
    name.className = "account-menu__name";
    name.textContent = accountName(options.name);
    this.whoNext = document.createElement("span");
    this.whoNext.className = "account-menu__who-next";
    this.whoNext.hidden = true;
    whoText.append(name, this.whoNext);
    who.append(whoText);
    if (options.avatar) {
      who.classList.add("account-menu__who--avatar");
      who.prepend(this.face("account-menu__who-face", "full"));
    }

    // Two columns, so the whole menu fits a laptop screen without scrolling.
    const items = document.createElement("div");
    items.className = "account-menu__items";

    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.className = "btn btn--ghost account-menu__item";
    signOut.setAttribute("role", "menuitem");
    signOut.textContent = "Log out";
    signOut.addEventListener("click", () => {
      this.toggle(false);
      options.onSignOut();
    });

    this.list.append(who, items);
    // Help: Bob's guided start again, as a tour with Next buttons (issue #227,
    // Q5). Offered only where it can run (the own yard, the guide not running).
    this.replay = document.createElement("button");
    this.replay.type = "button";
    // Not `account-menu__item`: Log out stays the menu's one item of that name.
    this.replay.className = "btn btn--ghost account-menu__help account-menu__replay";
    this.replay.setAttribute("role", "menuitem");
    this.replay.textContent = "Help: replay the guided start";
    this.replay.hidden = true;
    this.replay.addEventListener("click", () => {
      this.toggle(false);
      startGuideTour();
    });
    if (options.onFriends) {
      const onFriends = options.onFriends;
      // Not `account-menu__item` either, for the same reason as Help's.
      const friends = document.createElement("button");
      friends.type = "button";
      friends.className = "btn btn--ghost account-menu__help account-menu__friends";
      friends.setAttribute("role", "menuitem");
      const label = document.createElement("span");
      label.textContent = "Friends";
      this.friendsCount = document.createElement("span");
      this.friendsCount.className = "account-menu__count";
      this.friendsCount.hidden = true;
      friends.append(label, this.friendsCount);
      friends.addEventListener("click", () => {
        this.toggle(false);
        onFriends();
      });
      items.append(friends);
      // The same count on the button, so it shows with the menu shut.
      this.buttonCount = document.createElement("span");
      this.buttonCount.className = "account-menu__button-count";
      this.buttonCount.setAttribute("aria-hidden", "true");
      this.buttonCount.hidden = true;
      this.button.append(this.buttonCount);
    }
    if (options.onAchievements) {
      const onAchievements = options.onAchievements;
      // Not `account-menu__item` either, for the same reason as Help's.
      const achievements = document.createElement("button");
      achievements.type = "button";
      achievements.className = "btn btn--ghost account-menu__help account-menu__achievements";
      achievements.setAttribute("role", "menuitem");
      achievements.textContent = "Achievements";
      achievements.addEventListener("click", () => {
        this.toggle(false);
        onAchievements();
      });
      items.append(achievements);
    }
    if (options.onLeaderboard) {
      const onLeaderboard = options.onLeaderboard;
      // Not `account-menu__item` either, for the same reason as Help's.
      const leaderboard = document.createElement("button");
      leaderboard.type = "button";
      leaderboard.className = "btn btn--ghost account-menu__help account-menu__leaderboard";
      leaderboard.setAttribute("role", "menuitem");
      leaderboard.textContent = "Leaderboard";
      leaderboard.addEventListener("click", () => {
        this.toggle(false);
        onLeaderboard();
      });
      items.append(leaderboard);
    }
    if (options.onWhatsNew) {
      const onWhatsNew = options.onWhatsNew;
      // Not `account-menu__item` either, for the same reason as Help's.
      const whatsNew = document.createElement("button");
      whatsNew.type = "button";
      whatsNew.className = "btn btn--ghost account-menu__help account-menu__whats-new";
      whatsNew.setAttribute("role", "menuitem");
      whatsNew.textContent = "What's new";
      whatsNew.addEventListener("click", () => {
        this.toggle(false);
        onWhatsNew();
      });
      items.append(whatsNew);
    }
    if (options.onNews) {
      const onNews = options.onNews;
      // Not `account-menu__item` either, for the same reason as Help's.
      const news = document.createElement("button");
      news.type = "button";
      news.className = "btn btn--ghost account-menu__help account-menu__news";
      news.setAttribute("role", "menuitem");
      news.textContent = "News";
      news.addEventListener("click", () => {
        this.toggle(false);
        onNews();
      });
      items.append(news);
    }
    if (options.onReportBug) {
      const onReportBug = options.onReportBug;
      // Not `account-menu__item` either, for the same reason as Help's.
      const reportBug = document.createElement("button");
      reportBug.type = "button";
      reportBug.className = "btn btn--ghost account-menu__help account-menu__report-bug";
      reportBug.setAttribute("role", "menuitem");
      reportBug.textContent = "Report a bug";
      reportBug.addEventListener("click", () => {
        this.toggle(false);
        onReportBug();
      });
      items.append(reportBug);
    }
    // Support the game (owner 24 Oct 2026): always here, on every screen with
    // the menu. Only opens the panel of links; it gives nothing in the game.
    const support = document.createElement("button");
    support.type = "button";
    support.className = "btn btn--ghost account-menu__help account-menu__support";
    support.setAttribute("role", "menuitem");
    support.append(
      gameIcon("support", { size: 24, decorative: true }),
      Object.assign(document.createElement("span"), { textContent: SUPPORT_TEXT.title }),
    );
    support.addEventListener("click", () => {
      this.toggle(false);
      const container = document.querySelector<HTMLElement>(".overlay__layer--modal") ?? document.body;
      openSupportPanel({ container });
    });
    items.append(support);
    // The community Discord, in a new tab; no referrer to the outside site.
    const discord = document.createElement("a");
    discord.className = "btn btn--ghost account-menu__help account-menu__discord";
    discord.setAttribute("role", "menuitem");
    discord.href = DISCORD_URL;
    discord.target = "_blank";
    discord.rel = "noopener noreferrer";
    discord.textContent = "Join the Discord";
    discord.addEventListener("click", () => this.toggle(false));
    items.append(discord);
    // Account settings (username, Shiny Lock) and Fullscreen, the original's top-bar button.
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "btn btn--ghost account-menu__help account-menu__settings";
    settings.setAttribute("role", "menuitem");
    settings.textContent = "Account settings";
    settings.addEventListener("click", () => {
      this.toggle(false);
      const container = document.querySelector<HTMLElement>(".overlay__layer--modal") ?? document.body;
      this.picker?.clearStatus();
      openAccountSettings({ container, ...(this.picker && { avatarPicker: this.picker }) });
    });
    this.fullscreen = document.createElement("button");
    this.fullscreen.type = "button";
    this.fullscreen.className = "btn btn--ghost account-menu__help account-menu__fullscreen";
    this.fullscreen.setAttribute("role", "menuitem");
    this.fullscreen.hidden = !fullscreenAvailable();
    this.fullscreen.addEventListener("click", () => {
      this.toggle(false);
      void toggleFullscreen();
    });
    // Music and sound effects (beta.5), each a mute and a volume slider
    // (owner, 4 Nov 2026): saved with the yard, so they follow the account
    // (`game/sound/soundSwitches.ts`, `ui/SoundSliders.ts`).
    const sound = new SoundSliders("account-menu__sound");
    this.stopSound.push(() => sound.destroy());
    items.append(settings, this.fullscreen, this.replay);
    this.list.append(sound.element, signOut);
    this.element.append(this.button, this.list);
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
  }

  get open(): boolean {
    return !this.list.hidden;
  }

  /** The critter the menu shows as the player's; null without an avatar. */
  get avatar(): AvatarId | null {
    return this.current;
  }

  /**
   * The level on the pill, or none with null (a yard that has not sent it, or
   * no yard). `xp` adds the bar, the tooltip and the menu's points to the next
   * level; a server that sends no points leaves them out.
   */
  setLevel(level: number | null, xp: LevelProgress | null = null): void {
    this.whoNext.textContent = xp ? xpLeftText(xp) : "";
    this.whoNext.hidden = xp === null;
    if (!this.level || !this.levelBar || !this.ringLevel) return;
    const text = level === null ? "" : levelText(level);
    this.ringLevel.textContent = level === null ? "" : String(level);
    this.ringLevel.hidden = level === null;
    this.level.textContent = text;
    this.level.hidden = level === null;
    this.levelBar.track.hidden = xp === null;
    this.levelBar.fill.style.width = xp ? `${Math.round(xp.fraction * 100)}%` : "0%";
    this.button.setAttribute(
      "aria-label",
      level === null ? `Your account: ${this.name}` : `Your account: ${this.name}, ${text}`,
    );
    this.button.title = xp ? xpTitle(xp) : "Your account";
  }

  /** The requests and gifts waiting, on the Friends item and the button; none shows at 0. */
  setFriendsCount(count: number): void {
    const next = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
    if (!this.friendsCount || !this.buttonCount || next === this.friendsWaiting) return;
    this.friendsWaiting = next;
    for (const badge of [this.friendsCount, this.buttonCount]) {
      badge.textContent = next > 99 ? "99+" : String(next);
      badge.hidden = next === 0;
    }
    this.friendsCount.title = next > 0 ? waitingText(next) : "";
    this.button.dataset["friendsWaiting"] = String(next);
  }

  /** Focus back on the menu's button, for a screen it opened that has closed. */
  focus(): void {
    this.button.focus();
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
    for (const stop of this.stopSound) stop();
    this.element.remove();
  }

  /** A picture of the current avatar that follows it when it changes. */
  private face(className: string, size: "full" | "small"): HTMLImageElement {
    const picture = document.createElement("img");
    picture.className = className;
    picture.alt = "";
    picture.decoding = "async";
    picture.dataset["size"] = size;
    if (this.current) picture.src = avatarUrl(this.current, size);
    this.faces.push(picture);
    return picture;
  }

  /** Points every face at the current avatar. */
  private showFaces(): void {
    if (!this.current) return;
    for (const picture of this.faces) {
      picture.src = avatarUrl(this.current, picture.dataset["size"] === "small" ? "small" : "full");
    }
  }

  private toggle(open: boolean): void {
    if (open) {
      this.replay.hidden = !guideTourAvailable();
      this.fullscreen.textContent = isFullscreen() ? "Exit fullscreen" : "Fullscreen";
    }
    this.list.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  /** A press anywhere else, or Escape, closes the list. */
  private readonly dismiss = (event: Event): void => {
    if (this.list.hidden) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      this.toggle(false);
      this.button.focus();
      return;
    }
    if (event.target instanceof Node && this.element.contains(event.target)) return;
    this.toggle(false);
  };
}
