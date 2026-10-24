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
 * With an `avatar` (issue #175) the button wears the player's critter and the
 * menu holds the picker: the twelve critters in a grid, the current one
 * marked. A pick is only marked once `onPick` has stored it; a failed save
 * leaves the old mark and says so.
 *
 * The yard's HUD (#171) shows it as a `pill`: the player's name beside their
 * critter in a ring, rather than the word "Account", and under the name the
 * player's level once the yard has sent it (`setLevel`, #192).
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
 * With `onReportBug` it has a "Report a bug" item, which opens the bug report
 * form (`ui/bugReport/BugReportDialog.ts`).
 *
 * Beside "Reduce effects" sit the two sound switches, Music and Sound
 * effects (beta.5), saved with the player's yard (`game/sound/soundSwitches.ts`).
 */

import { AVATARS, avatarName, avatarUrl, type AvatarId } from "@/game/avatars";
import { waitingText } from "@/game/friends/friendText";
import { guideTourAvailable, startGuideTour } from "@/game/guide/tour";
import { openAccountSettings } from "@/ui/AccountSettings";
import { reduceEffects, setReduceEffects } from "@/game/attack/juice";
import {
  onSoundSwitches,
  setSoundSwitch,
  soundSwitches,
  type SoundSwitches,
} from "@/game/sound/soundSwitches";
import { fullscreenAvailable, isFullscreen, toggleFullscreen } from "@/ui/fullscreen";
import "@/ui/friends/friends.css";
import "@/ui/styles/guide-start.css";

export interface AccountAvatar {
  /** The critter the player is shown as: their pick, or their default. */
  readonly current: AvatarId;
  /** False while `current` is only the default, not something they chose. */
  readonly picked: boolean;
  /** Stores a pick; rejects when the server refused or could not be reached. */
  readonly onPick: (id: AvatarId) => Promise<void>;
}

export interface AccountMenuOptions {
  /** The signed-in player's name; null or empty when the server sent none. */
  readonly name: string | null | undefined;
  readonly onSignOut: () => void;
  /** The avatar and its picker; without it the menu is name and Log out only. */
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
  /** The "Report a bug" item's action; without it there is no such item. */
  readonly onReportBug?: () => void;
}

/** What the picker's heading adds while the player still wears the default. */
export const DEFAULT_NOTE = "Default until you pick one";

/** What the picker says when a pick could not be saved. */
export const PICK_FAILED = "Could not save that avatar. Try again.";

/** What the menu's heading says: the name, or a plain stand-in without one. */
export const accountName = (name: string | null | undefined): string => name?.trim() || "Signed in";

/** "Level 12", the pill's line under the name. */
export const levelText = (level: number): string => `Level ${level}`;

/** "Music: On", a sound switch's item. */
export const soundSwitchText = (label: string, on: boolean): string => `${label}: ${on ? "On" : "Off"}`;

/** A sound switch's tooltip after its save failed; the switch is already back. */
export const SOUND_SAVE_FAILED = "Could not save that. Try again.";

export class AccountMenu {
  /** The button and the list, in one wrapper the list hangs from. */
  readonly element: HTMLElement;

  private readonly button: HTMLButtonElement;
  private readonly list: HTMLElement;
  /** Every picture of the current avatar: the button's and the heading's. */
  private readonly faces: HTMLImageElement[] = [];
  private readonly tiles = new Map<AvatarId, HTMLButtonElement>();
  private readonly note: HTMLElement | null = null;
  private readonly status: HTMLElement | null = null;
  /** The pill's level line; null on the plain button. */
  private readonly level: HTMLElement | null = null;
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
  private saving = false;

  constructor(options: AccountMenuOptions) {
    this.element = document.createElement("div");
    this.element.className = "account-menu";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "btn btn--ghost account-menu__button";
    this.name = accountName(options.name);
    if (options.avatar) this.current = options.avatar.current;
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
      name.append(nameLine, this.level);
      const ring = document.createElement("span");
      ring.className = "account-menu__ring";
      if (options.avatar) ring.append(this.face("account-menu__ring-face", "full"));
      else ring.textContent = accountName(options.name).charAt(0).toUpperCase();
      this.button.className = "account-menu__button account-menu__button--pill";
      this.button.append(name, ring);
      this.button.setAttribute("aria-label", `Your account: ${accountName(options.name)}`);
      this.button.title = "Your account: avatar and Log out";
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
    const label = document.createElement("span");
    label.className = "account-menu__label";
    label.textContent = "Signed in as";
    const name = document.createElement("span");
    name.className = "account-menu__name";
    name.textContent = accountName(options.name);
    who.append(label, name);
    if (options.avatar) {
      who.classList.add("account-menu__who--avatar");
      who.prepend(this.face("account-menu__who-face", "full"));
    }

    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.className = "btn btn--ghost account-menu__item";
    signOut.setAttribute("role", "menuitem");
    signOut.textContent = "Log out";
    signOut.addEventListener("click", () => {
      this.toggle(false);
      options.onSignOut();
    });

    this.list.append(who);
    if (options.avatar) {
      const avatar = options.avatar;
      const picker = document.createElement("div");
      picker.className = "account-menu__avatars";

      const heading = document.createElement("div");
      heading.className = "account-menu__avatars-head";
      heading.id = "account-menu-avatars-head";
      const title = document.createElement("span");
      title.className = "account-menu__label";
      title.textContent = "Avatar";
      this.note = document.createElement("span");
      this.note.className = "account-menu__note";
      this.note.textContent = DEFAULT_NOTE;
      this.note.hidden = avatar.picked;
      heading.append(title, this.note);

      const grid = document.createElement("div");
      grid.className = "account-menu__grid";
      grid.setAttribute("role", "radiogroup");
      grid.setAttribute("aria-labelledby", heading.id);
      for (const { id } of AVATARS) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "account-menu__tile";
        tile.dataset["avatar"] = id;
        tile.setAttribute("role", "radio");
        tile.setAttribute("aria-label", avatarName(id));
        tile.title = avatarName(id);
        const picture = document.createElement("img");
        picture.src = avatarUrl(id);
        picture.alt = "";
        picture.decoding = "async";
        picture.loading = "lazy";
        tile.append(picture);
        tile.addEventListener("click", () => void this.pick(id, avatar));
        grid.append(tile);
        this.tiles.set(id, tile);
      }

      this.status = document.createElement("p");
      this.status.className = "account-menu__status";
      this.status.setAttribute("role", "status");
      this.status.hidden = true;

      picker.append(heading, grid, this.status);
      this.list.append(picker);
      this.mark();
    }
    // Help: Bob's guided start again, as a tour with Next buttons (issue #227,
    // Q5). Offered only where it can run (the own yard, the guide not running).
    this.replay = document.createElement("button");
    this.replay.type = "button";
    // Not `account-menu__item`: Log out stays the menu's one item of that name.
    this.replay.className = "btn btn--ghost account-menu__help";
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
      this.list.append(friends);
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
      this.list.append(achievements);
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
      this.list.append(leaderboard);
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
      this.list.append(whatsNew);
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
      this.list.append(reportBug);
    }
    // Account settings (username, Shiny Lock) and Fullscreen, the original's top-bar button.
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "btn btn--ghost account-menu__help account-menu__settings";
    settings.setAttribute("role", "menuitem");
    settings.textContent = "Account settings";
    settings.addEventListener("click", () => {
      this.toggle(false);
      const container = document.querySelector<HTMLElement>(".overlay__layer--modal") ?? document.body;
      openAccountSettings({ container });
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
    // Reduce effects (feat/attack-juice-demo): no shake, hit-stop or slow
    // motion in attacks, and fewer bits flying. Read when an attack opens.
    const effects = document.createElement("button");
    effects.type = "button";
    effects.className = "btn btn--ghost account-menu__help account-menu__effects";
    effects.setAttribute("role", "menuitemcheckbox");
    const showEffects = (): void => {
      const on = reduceEffects();
      effects.setAttribute("aria-checked", String(on));
      effects.textContent = `Reduce effects: ${on ? "On" : "Off"}`;
      effects.title = "Turns off screen shake, hit pauses and slow motion in attacks, with fewer particles";
    };
    showEffects();
    effects.addEventListener("click", () => {
      setReduceEffects(!reduceEffects());
      showEffects();
    });
    // Music and sound effects (beta.5): saved with the yard, so they follow
    // the account (`game/sound/soundSwitches.ts`).
    const music = this.soundSwitch("music", "Music", "Plays the game's music");
    const sounds = this.soundSwitch("effects", "Sound effects", "Plays the game's sound effects");
    this.list.append(settings, this.fullscreen, effects, music, sounds, this.replay, signOut);
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
   * The pill's "Level N" under the name, or none with null (a yard that has
   * not sent it, or no yard). The plain button has no room for it.
   */
  setLevel(level: number | null): void {
    const line = this.level;
    if (!line) return;
    const text = level === null ? "" : levelText(level);
    if (line.textContent === text && line.hidden === (level === null)) return;
    line.textContent = text;
    line.hidden = level === null;
    this.button.setAttribute(
      "aria-label",
      level === null ? `Your account: ${this.name}` : `Your account: ${this.name}, ${text}`,
    );
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

  /**
   * One of the two sound switches, "Music: On" / "Sound effects: Off". It
   * waits, greyed, until the account's switches are known, and a failed save
   * puts it back and says so in its tooltip.
   */
  private soundSwitch(which: keyof SoundSwitches, label: string, title: string): HTMLButtonElement {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `btn btn--ghost account-menu__help account-menu__sound account-menu__sound--${which}`;
    item.setAttribute("role", "menuitemcheckbox");
    let failed = false;
    const show = (switches: SoundSwitches | null): void => {
      const on = switches?.[which] === true;
      item.disabled = switches === null;
      item.setAttribute("aria-checked", String(on));
      item.textContent = switches === null ? `${label}: …` : soundSwitchText(label, on);
      item.title = failed ? SOUND_SAVE_FAILED : title;
    };
    show(soundSwitches());
    this.stopSound.push(onSoundSwitches(show));
    item.addEventListener("click", () => {
      const switches = soundSwitches();
      if (!switches) return;
      failed = false;
      setSoundSwitch(which, !switches[which]).catch(() => {
        failed = true;
        show(soundSwitches());
      });
    });
    return item;
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

  /** Marks the current avatar's tile and points every face at it. */
  private mark(): void {
    for (const [id, tile] of this.tiles) {
      const on = id === this.current;
      tile.setAttribute("aria-checked", String(on));
      tile.classList.toggle("is-current", on);
    }
    if (!this.current) return;
    for (const picture of this.faces) {
      picture.src = avatarUrl(this.current, picture.dataset["size"] === "small" ? "small" : "full");
    }
  }

  private async pick(id: AvatarId, avatar: AccountAvatar): Promise<void> {
    if (this.saving) return;
    if (id === this.current && this.note?.hidden) return;
    this.saving = true;
    for (const tile of this.tiles.values()) tile.disabled = true;
    if (this.status) this.status.hidden = true;
    try {
      await avatar.onPick(id);
      this.current = id;
      if (this.note) this.note.hidden = true;
      this.mark();
    } catch {
      if (this.status) {
        this.status.textContent = PICK_FAILED;
        this.status.hidden = false;
      }
    } finally {
      this.saving = false;
      for (const tile of this.tiles.values()) tile.disabled = false;
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
