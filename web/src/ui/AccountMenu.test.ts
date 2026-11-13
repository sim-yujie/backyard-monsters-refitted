// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvatarId } from "@/game/avatars";
import {
  AccountMenu,
  SOUND_SAVE_FAILED,
  accountName,
  levelText,
  xpLeftText,
  xpTitle,
} from "./AccountMenu";
import { levelProgress } from "@/game/yard/experience";
import { formatCompact } from "@/ui/format";
import {
  loadSoundSwitches,
  resetSoundSwitchesForTest,
  type SoundSwitches,
} from "@/game/sound/soundSwitches";
import { UNMUTE_LEVEL, muteLabel } from "./SoundSliders";

describe("AccountMenu", () => {
  let menu: AccountMenu | null = null;

  afterEach(() => {
    menu?.destroy();
    menu = null;
  });

  const build = (name: string | null = "Agent Tester") => {
    const signOut = vi.fn();
    menu = new AccountMenu({ name, onSignOut: signOut });
    document.body.append(menu.element);
    const button = menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!;
    const logOut = menu.element.querySelector<HTMLButtonElement>(".account-menu__item")!;
    return { menu, signOut, button, logOut };
  };

  it("opens on Account without signing anyone out", () => {
    const { menu, signOut, button } = build();
    expect(button.textContent).toBe("Account");
    expect(menu.open).toBe(false);
    button.click();
    expect(menu.open).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(signOut).not.toHaveBeenCalled();
    expect(menu.element.querySelector(".account-menu__name")?.textContent).toBe("Agent Tester");
  });

  it("signs out only from the explicit Log out item", () => {
    const { menu, signOut, button, logOut } = build();
    button.click();
    expect(logOut.textContent).toBe("Log out");
    logOut.click();
    expect(signOut).toHaveBeenCalledOnce();
    expect(menu.open).toBe(false);
  });

  it("closes on a press elsewhere or Escape", () => {
    const { menu, button } = build();
    button.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.open).toBe(false);
    button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.open).toBe(false);
  });

  it("stands in for a missing name", () => {
    expect(accountName(null)).toBe("Signed in");
    expect(accountName("  ")).toBe("Signed in");
    expect(accountName("Kozu")).toBe("Kozu");
  });

  describe("the avatar (#175)", () => {
    const withAvatar = (onPick: (id: AvatarId) => Promise<void> = () => Promise.resolve()) => {
      const pick = vi.fn(onPick);
      const created = new AccountMenu({
        name: "Agent Tester",
        onSignOut: vi.fn(),
        avatar: { current: "frog", picked: false, onPick: pick },
      });
      menu = created;
      document.body.append(created.element);
      const face = () => created.element.querySelector<HTMLImageElement>(".account-menu__face")!;
      return { menu: created, pick, face };
    };
    const openSettings = (created: AccountMenu) => {
      document.querySelector(".account-settings-popup")?.remove();
      created.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      created.element.querySelector<HTMLButtonElement>(".account-menu__settings")!.click();
      return document.querySelector<HTMLButtonElement>('.avatar-picker__tile[data-avatar="bee"]')!;
    };

    it("wears the critter, and keeps the picker out of the menu", () => {
      const { menu, face } = withAvatar();
      expect(face().getAttribute("src")).toMatch(/avatars\/frog-64\.webp$/);
      expect(menu.element.querySelector(".avatar-picker")).toBeNull();
    });

    it("moves the faces after a pick in Settings, and opens it again on that pick", async () => {
      const { menu, pick, face } = withAvatar();
      openSettings(menu).click();
      expect(pick).toHaveBeenCalledWith("bee");
      await vi.waitFor(() => expect(menu.avatar).toBe("bee"));
      expect(face().getAttribute("src")).toMatch(/avatars\/bee-64\.webp$/);
      expect(openSettings(menu).getAttribute("aria-checked")).toBe("true");
    });

    it("shows an uploaded photo in place of the critter, and the critter again once it goes", () => {
      const { menu, face } = withAvatar();
      menu.setPhoto("/api/v1/profile/photos/7?v=3");
      expect(face().getAttribute("src")).toBe("/api/v1/profile/photos/7?v=3");
      expect(face().classList.contains("is-photo")).toBe(true);
      menu.setPhoto(null);
      expect(face().getAttribute("src")).toMatch(/avatars\/frog-64\.webp$/);
      expect(face().classList.contains("is-photo")).toBe(false);
    });

    it("falls back to the critter when the photo will not load, never a broken picture", () => {
      const { menu, face } = withAvatar();
      menu.setPhoto("/api/v1/profile/photos/7?v=3");
      face().dispatchEvent(new Event("error"));
      expect(face().getAttribute("src")).toMatch(/avatars\/frog-64\.webp$/);
      expect(face().classList.contains("is-photo")).toBe(false);
      // A new upload is a new address, and shows again.
      menu.setPhoto("/api/v1/profile/photos/7?v=4");
      expect(face().getAttribute("src")).toBe("/api/v1/profile/photos/7?v=4");
      expect(face().classList.contains("is-photo")).toBe(true);
    });

    it("keeps the photo on the badge when the player picks another critter", () => {
      const { menu, face } = withAvatar();
      menu.setPhoto("/api/v1/profile/photos/7?v=3");
      openSettings(menu);
      document.querySelector<HTMLButtonElement>('.avatar-picker__tile[data-avatar="bee"]')?.click();
      expect(face().getAttribute("src")).toBe("/api/v1/profile/photos/7?v=3");
    });

    it("keeps a save running through closing and reopening, and can go back after it", async () => {
      let finish: () => void = () => {};
      const pick = vi.fn(() => new Promise<void>((done) => (finish = done)));
      const { menu, face } = withAvatar(pick);
      openSettings(menu).click();
      // Reopened while Bee is still saving: the tiles wait with the save.
      const bee = openSettings(menu);
      const frog = () => document.querySelector<HTMLButtonElement>('.avatar-picker__tile[data-avatar="frog"]')!;
      expect(bee.disabled).toBe(true);
      frog().click();
      expect(pick).toHaveBeenCalledOnce();
      finish();
      await vi.waitFor(() => expect(bee.getAttribute("aria-checked")).toBe("true"));
      expect(face().getAttribute("src")).toMatch(/avatars\/bee-64\.webp$/);
      expect(frog().disabled).toBe(false);
      frog().click();
      expect(pick).toHaveBeenCalledTimes(2);
      finish();
      await vi.waitFor(() => expect(menu.avatar).toBe("frog"));
    });

    it("keeps the face when the save fails", async () => {
      const { menu, pick, face } = withAvatar(() => Promise.reject(new Error("no")));
      openSettings(menu).click();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledOnce());
      await vi.waitFor(() =>
        expect(document.querySelector<HTMLElement>(".avatar-picker__status")?.hidden).toBe(false),
      );
      expect(menu.avatar).toBe("frog");
      expect(face().getAttribute("src")).toMatch(/avatars\/frog-64\.webp$/);
    });

    it("has no picker without an avatar", () => {
      document.querySelector(".account-settings-popup")?.remove();
      const { button } = build();
      button.click();
      menu!.element.querySelector<HTMLButtonElement>(".account-menu__settings")!.click();
      expect(document.querySelector(".avatar-picker")).toBeNull();
      expect(menu!.element.querySelector(".account-menu__face")).toBeNull();
      expect(menu!.avatar).toBeNull();
    });
  });

  describe("the pill's level (#192)", () => {
    const pill = () => {
      menu = new AccountMenu({ name: "agenttester", onSignOut: () => {}, variant: "pill" });
      document.body.append(menu.element);
      const button = menu.element.querySelector<HTMLButtonElement>(".account-menu__button--pill")!;
      const line = menu.element.querySelector<HTMLElement>(".account-menu__pill-level")!;
      const bar = menu.element.querySelector<HTMLElement>(".account-menu__pill-bar")!;
      const fill = menu.element.querySelector<HTMLElement>(".account-menu__pill-fill")!;
      const next = menu.element.querySelector<HTMLElement>(".account-menu__who-next")!;
      return { menu, button, line, bar, fill, next };
    };

    it("shows no level line until one is set", () => {
      const { button, line } = pill();
      expect(line.hidden).toBe(true);
      expect(button.getAttribute("aria-label")).toBe("Your account: agenttester");
    });

    it("puts \"Level N\" under the name and in the button's name, and takes it away with null", () => {
      const { menu, button, line } = pill();
      menu.setLevel(12);
      expect(levelText(12)).toBe("Level 12");
      expect(line.hidden).toBe(false);
      expect(line.textContent).toBe("Level 12");
      expect(menu.element.querySelector(".account-menu__ring-level")?.textContent).toBe("12");
      expect(button.getAttribute("aria-label")).toBe("Your account: agenttester, Level 12");
      menu.setLevel(null);
      expect(line.hidden).toBe(true);
      expect(button.getAttribute("aria-label")).toBe("Your account: agenttester");
    });

    it("shows the bar and the points to the next level, and takes them away with no points", () => {
      const { menu, button, line, bar, fill, next } = pill();
      expect(bar.hidden).toBe(true);
      expect(next.hidden).toBe(true);
      const xp = levelProgress(1, 450);
      menu.setLevel(1, xp);
      expect(bar.hidden).toBe(false);
      expect(fill.style.width).toBe("50%");
      expect(next.textContent).toBe(`${formatCompact(450)} points to level 2`);
      expect(button.title).toBe(xpTitle(xp));
      menu.setLevel(1);
      expect(line.hidden).toBe(false);
      expect(bar.hidden).toBe(true);
      expect(next.hidden).toBe(true);
      expect(button.title).toBe("Your account");
    });

    it("words the tooltip and the top level", () => {
      expect(xpTitle(levelProgress(1, 400))).toBe("Level 1. 400 points, 500 more for level 2.");
      expect(xpLeftText(levelProgress(56, 9e13))).toBe("The top level");
    });

    it("the plain button ignores it", () => {
      const { menu, button } = build();
      menu.setLevel(3);
      expect(button.textContent).toBe("Account");
      expect(menu.element.querySelector(".account-menu__pill-level")).toBeNull();
    });
  });
  describe("the Achievements item (#204)", () => {
    it("is there only when asked for, closes the menu and opens the screen", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__achievements")).toBeNull();
      menu!.destroy();

      const onAchievements = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onAchievements });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__achievements")!;
      expect(item.textContent).toBe("Achievements");
      expect(item.getAttribute("role")).toBe("menuitem");
      // Log out keeps the one `account-menu__item`.
      expect(menu.element.querySelectorAll(".account-menu__item").length).toBe(1);
      item.click();
      expect(onAchievements).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
  describe("the Friends item (#370)", () => {
    it("is there only when asked for, opens the screen, and carries the count waiting", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__friends")).toBeNull();
      menu!.setFriendsCount(3);
      menu!.destroy();

      const onFriends = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onFriends });
      document.body.append(menu.element);
      const opener = menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!;
      const onButton = opener.querySelector<HTMLElement>(".account-menu__button-count")!;
      expect(onButton.hidden).toBe(true);
      menu.setFriendsCount(3);
      expect(onButton.hidden).toBe(false);
      expect(onButton.textContent).toBe("3");
      opener.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__friends")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("Friends3");
      expect(menu.element.querySelectorAll(".account-menu__item").length).toBe(1);
      menu.setFriendsCount(150);
      expect(item.querySelector(".account-menu__count")!.textContent).toBe("99+");
      menu.setFriendsCount(0);
      expect(item.querySelector<HTMLElement>(".account-menu__count")!.hidden).toBe(true);
      expect(onButton.hidden).toBe(true);
      item.click();
      expect(onFriends).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
  describe("the What's new item", () => {
    it("is there only when asked for and opens the cards", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__whats-new")).toBeNull();
      menu!.destroy();

      const onWhatsNew = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onWhatsNew });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__whats-new")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("What's new");
      item.click();
      expect(onWhatsNew).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
  describe("the News item", () => {
    it("is there only when asked for, just after What's new, and opens the announcements", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__news")).toBeNull();
      menu!.destroy();

      const onNews = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onWhatsNew: vi.fn(), onNews });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__news")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("News");
      expect(item.previousElementSibling?.classList.contains("account-menu__whats-new")).toBe(true);
      item.click();
      expect(onNews).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
  describe("the player's own profile (owner, 13 Nov 2026: moved into Settings > Account)", () => {
    const full = (userid?: number) => {
      menu = new AccountMenu({
        name: "Agent Tester",
        onSignOut: vi.fn(),
        ...(userid !== undefined && { userid }),
        avatar: { current: "frog", picked: true, onPick: () => Promise.resolve() },
        onFriends: vi.fn(),
        onAchievements: vi.fn(),
        onLeaderboard: vi.fn(),
        onWhatsNew: vi.fn(),
        onNews: vi.fn(),
        onReportBug: vi.fn(),
      });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      return menu;
    };

    afterEach(() => document.querySelector(".account-settings-popup")?.closest(".popup-backdrop")?.remove());

    it("has no Profile item: Friends leads the first group, every other item stays", () => {
      const created = full(2503);
      expect(created.element.querySelector(".account-menu__profile")).toBeNull();
      const groups = [...created.element.querySelectorAll(".account-menu__items")].map((group) =>
        [...group.children].map((item) => item.className.match(/account-menu__(?!help)([\w-]+)/)?.[1]),
      );
      expect(groups).toEqual([
        ["friends", "achievements", "leaderboard"],
        ["whats-new", "news", "support", "discord"],
        ["settings", "fullscreen", "report-bug", "replay"],
      ]);
      expect([...created.element.querySelectorAll("[role=menuitem]")].map((item) => item.textContent)).not.toContain(
        "Profile",
      );
    });

    it("lays the first group's odd item across both columns, leaving no hole", () => {
      const css = readFileSync(`${process.cwd()}/src/ui/styles/ui.css`, "utf8");
      expect(css).toContain(".account-menu__items > :nth-child(odd):is(:last-child, :has(+ [hidden]))");
      expect(css).toMatch(/:nth-child\(odd\):is\(:last-child, :has\(\+ \[hidden\]\)\) \{\s*grid-column: 1 \/ -1;/);
    });

    it("puts the photo, the no-photo icon and the bio in Settings > Account, with the userid", () => {
      const created = full(2503);
      created.element.querySelector<HTMLButtonElement>(".account-menu__settings")!.click();
      const pane = document.querySelector<HTMLElement>("#account-settings-pane-account")!;
      const section = pane.querySelector<HTMLElement>(".own-profile")!;
      expect(section).not.toBeNull();
      expect(pane.firstElementChild).toBe(section);
      // The critter picker sits inside the profile part, after the photo.
      expect(section.querySelector(".avatar-picker")).not.toBeNull();
      expect(section.querySelector(".own-profile__preview")).not.toBeNull();
    });

    it("keeps only the picker in Settings without a userid", () => {
      const created = full();
      created.element.querySelector<HTMLButtonElement>(".account-menu__settings")!.click();
      const pane = document.querySelector<HTMLElement>("#account-settings-pane-account")!;
      expect(pane.querySelector(".own-profile")).toBeNull();
      expect(pane.querySelector(".avatar-picker")).not.toBeNull();
    });
  });
  describe("the Leaderboard item", () => {
    it("is there only when asked for, the last of the first group, and opens the board", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__leaderboard")).toBeNull();
      menu!.destroy();

      const onLeaderboard = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onLeaderboard, onWhatsNew: vi.fn() });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__leaderboard")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("Leaderboard");
      expect(item.nextElementSibling).toBeNull();
      item.click();
      expect(onLeaderboard).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
  describe("the Report a bug item", () => {
    it("is there only when asked for, after Fullscreen, and opens the form", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__report-bug")).toBeNull();
      menu!.destroy();

      const onReportBug = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onWhatsNew: vi.fn(), onReportBug });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__report-bug")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("Report a bug");
      expect(item.previousElementSibling?.classList.contains("account-menu__fullscreen")).toBe(true);
      item.click();
      expect(onReportBug).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
  describe("the Support the game item", () => {
    it("is always there, after News, with the painted heart, and opens the support panel", () => {
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onNews: vi.fn() });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__support")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("Support");
      expect(item.getAttribute("aria-label")).toBe("Support the game");
      expect(item.querySelector(".game-icon--support")).not.toBeNull();
      expect(item.previousElementSibling?.classList.contains("account-menu__news")).toBe(true);
      item.click();
      expect(menu.open).toBe(false);
      expect(document.querySelector(".support-popup")).not.toBeNull();
      document.querySelector(".support-popup")?.closest(".popup-backdrop")?.remove();
    });
  });
  describe("the Join the Discord item", () => {
    it("is always there, after Support the game, and opens the invite in a new tab", () => {
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onReportBug: vi.fn() });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLAnchorElement>(".account-menu__discord")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("Join the Discord");
      expect(item.getAttribute("href")).toBe("https://discord.gg/wthryBRZHz");
      expect(item.target).toBe("_blank");
      expect(item.rel).toBe("noopener noreferrer");
      expect(item.previousElementSibling?.classList.contains("account-menu__support")).toBe(true);
      item.addEventListener("click", (event) => event.preventDefault());
      item.click();
      expect(menu.open).toBe(false);
    });
  });
});

/**
 * #355: the HUD and the yard's zoom rail both sit at `--z-hud`, and the rail
 * comes later, so the open list hung under the rail. jsdom applies no
 * stylesheet, so the rule that lifts the HUD is checked in the CSS text.
 */
describe("AccountMenu stacking", () => {
  const read = (file: string): string =>
    readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const token = (name: string): number =>
    Number(new RegExp(`--${name}:\\s*(\\d+)`).exec(read("./styles/tokens.css"))?.[1]);

  it("lifts the HUD above the zoom rail while the list is open", () => {
    const rule = /\.hud:has\(\.account-menu__list:not\(\[hidden\]\)\)\s*\{([^}]*)\}/.exec(
      read("./styles/ui.css"),
    );
    expect(rule?.[1]).toMatch(/z-index:\s*var\(--z-popup\)/);
    expect(token("z-popup")).toBeGreaterThan(token("z-hud"));
  });
});

/** The sound rows beside "Reduce effects": a mute and a slider each (owner, 4 Nov 2026). */
describe("AccountMenu sound rows", () => {
  let menu: AccountMenu | null = null;

  afterEach(() => {
    menu?.destroy();
    menu = null;
    resetSoundSwitchesForTest();
  });

  const build = async (stored: SoundSwitches, failSave = false) => {
    const saves: unknown[] = [];
    resetSoundSwitchesForTest({
      account: () => 7,
      fetch: async () => ({ ...stored }),
      save: async (change) => {
        saves.push(change);
        if (failSave) throw new Error("offline");
        return { ...stored, ...change };
      },
      later: (run) => {
        run();
        return () => {};
      },
    });
    menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn() });
    document.body.append(menu.element);
    const rows = menu.element.querySelector<HTMLElement>(".account-menu__sound")!;
    const part = (which: string) => ({
      mute: rows.querySelector<HTMLButtonElement>(`.sound-sliders__row--${which} .sound-sliders__mute`)!,
      slider: rows.querySelector<HTMLInputElement>(`.sound-sliders__row--${which} .sound-sliders__slider`)!,
      number: rows.querySelector<HTMLOutputElement>(`.sound-sliders__row--${which} .sound-sliders__number`)!,
    });
    return { saves, rows, music: part("music"), effects: part("effects") };
  };

  const ON = { music: true, effects: true, musicVolume: 70, effectsVolume: 100 };

  it("sit after the menu's items, greyed until the account's settings are known", async () => {
    const { rows, music, effects } = await build({ ...ON, music: false });
    expect(rows.previousElementSibling?.classList.contains("account-menu__items")).toBe(true);
    expect(music.mute.disabled).toBe(true);
    expect(music.slider.disabled).toBe(true);
    await loadSoundSwitches();
    expect(music.mute.disabled).toBe(false);
    expect(music.mute.getAttribute("aria-pressed")).toBe("true");
    expect(music.mute.getAttribute("aria-label")).toBe(muteLabel("Music", false));
    expect(music.slider.value).toBe("70");
    expect(music.number.textContent).toBe("70");
    expect(effects.mute.getAttribute("aria-pressed")).toBe("false");
    expect(effects.number.textContent).toBe("100");
  });

  it("the mute flips the switch at once and saves only it", async () => {
    const { saves, music, effects } = await build(ON);
    await loadSoundSwitches();
    effects.mute.click();
    expect(effects.mute.getAttribute("aria-pressed")).toBe("true");
    await Promise.resolve();
    expect(saves).toEqual([{ effects: false }]);
    expect(music.mute.getAttribute("aria-pressed")).toBe("false");
    // The slider keeps its place while muted.
    expect(effects.slider.value).toBe("100");
  });

  it("moving a slider changes the volume; moving a muted one turns it back on", async () => {
    const { saves, music } = await build({ ...ON, music: false });
    await loadSoundSwitches();
    music.slider.value = "35";
    music.slider.dispatchEvent(new Event("input"));
    expect(music.number.textContent).toBe("35");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saves).toContainEqual({ musicVolume: 35 });
    expect(saves).toContainEqual({ music: true });
  });

  it("unmuting a row left at 0 puts it at the middle, so the press is heard", async () => {
    const { saves, effects } = await build({ ...ON, effectsVolume: 0 });
    await loadSoundSwitches();
    expect(effects.mute.getAttribute("aria-pressed")).toBe("true");
    effects.mute.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saves).toEqual([{ effectsVolume: UNMUTE_LEVEL }]);
    expect(effects.number.textContent).toBe(String(UNMUTE_LEVEL));
  });

  it("a failed save puts it back and says so on hover", async () => {
    const { music } = await build(ON, true);
    await loadSoundSwitches();
    music.mute.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(music.mute.getAttribute("aria-pressed")).toBe("false");
    expect(music.mute.title).toBe(SOUND_SAVE_FAILED);
  });
});
