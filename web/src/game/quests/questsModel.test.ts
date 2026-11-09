import { describe, expect, it } from "vitest";
import type { QuestsView } from "@/api/quests";
import {
  paceHint,
  canSwap,
  grantedRewards,
  loginDays,
  plural,
  progressText,
  questHint,
  pictureFillsTile,
  questPicture,
  questTitle,
  tabClaimable,
  utcDayOf,
} from "./questsModel";

/** The quest window's words and pictures (beta 6). */

const login = (over: Partial<QuestsView["login"]> = {}): QuestsView["login"] => ({
  day: 3,
  claimedToday: false,
  onCard: 2,
  shiny: [2, 2, 3, 3, 5, 5, 10],
  ...over,
});

describe("questTitle", () => {
  it("names the monster, tribe, building and resource", () => {
    expect(questTitle({ kind: "hatchMonster", variant: "C1", need: 3 })).toBe("Hatch 3 Pokeys");
    expect(questTitle({ kind: "hatchMonster", variant: "C12", need: 2 })).toBe("Hatch 2 D.A.V.E.");
    expect(questTitle({ kind: "destroyTribe", variant: "kozu", need: 1 })).toBe("Destroy a Kozu yard");
    expect(questTitle({ kind: "destroyTribe", variant: "dreadnaut", need: 3 })).toBe("Destroy 3 Dreadnaut yards");
    expect(questTitle({ kind: "catapultHit", variant: "14", need: 2 })).toMatch(/^Catapult 2 .+s$/);
    expect(questTitle({ kind: "weeklyLootGoo", need: 1_200_000 })).toBe("Loot 1.2M Goo");
    expect(questTitle({ kind: "weeklyLootTwigs", need: 50_000 })).toBe("Loot 50K Twigs");
  });

  it("says each daily and weekly kind in a few words", () => {
    expect(questTitle({ kind: "attackPlayer", need: 1 })).toBe("Attack a player");
    expect(questTitle({ kind: "upgradeResource", need: 1 })).toBe("Upgrade a resource building");
    expect(questTitle({ kind: "upgradeDefence", need: 2 })).toBe("Upgrade 2 defences");
    expect(questTitle({ kind: "mushroom", need: 3 })).toBe("Pick 3 mushrooms");
    expect(questTitle({ kind: "friendHelp", need: 1 })).toBe("Help a friend's yard");
    expect(questTitle({ kind: "friendGift", need: 1 })).toBe("Send a friend a gift");
    expect(questTitle({ kind: "feedChampion", need: 1 })).toBe("Feed your champion");
    expect(questTitle({ kind: "juice", need: 5 })).toBe("Juice 5 monsters");
    expect(questTitle({ kind: "weeklyHelpGift", need: 5 })).toBe("Help or gift friends 5 times");
    expect(questTitle({ kind: "weeklyNewFriends", need: 5 })).toBe("Make 5 new friends");
    expect(questTitle({ kind: "weeklyFights", need: 10 })).toBe("Win 10 fights");
    expect(questTitle({ kind: "somethingNew", need: 1 })).toBe("Quest");
  });

  it("adds a hint only where the title leaves a doubt", () => {
    expect(questHint({ kind: "weeklyFights" })).toBe("Attacks won or defences held");
    expect(questHint({ kind: "weeklyLootPutty" })).toBe("In attacks, tribes too");
    expect(questHint({ kind: "mushroom" })).toBeNull();
  });
});

describe("plural", () => {
  it("adds an s except after s, a dot or a capital X", () => {
    expect(plural("Bolt", 2)).toBe("Bolts");
    expect(plural("Bolt", 1)).toBe("Bolt");
    expect(plural("Project X", 2)).toBe("Project X");
    expect(plural("Zafreeti", 4)).toBe("Zafreetis");
  });
});

describe("questPicture", () => {
  it("uses the painted picture of what the quest names", () => {
    expect(questPicture({ kind: "destroyTribe", variant: "kozu" }).src).toBe("/assets/popups/tribe_kozu.v2.png");
    expect(questPicture({ kind: "catapultHit", variant: "20" }).src).toBe("/quests/cannon-tower.png");
    expect(questPicture({ kind: "catapultHit", variant: "14" }).src).toBe("/assets/popups/building-townhall.png");
    expect(questPicture({ kind: "hatchMonster", variant: "C1" }).src).toContain("C1");
    expect(questPicture({ kind: "juice" }).src).toBe("/assets/popups/monsterjuice.v2.png");
    expect(questPicture({ kind: "weeklyLootGoo" }).src).toBe("/assets/popups/loot.png");
  });

  it("falls back to Flash art for a tribe or building it does not know", () => {
    expect(questPicture({ kind: "destroyTribe", variant: "nobody" }).src).toBe("/assets/popups/military.png");
    expect(questPicture({ kind: "catapultHit", variant: "x" }).src).toBe("/assets/popups/building-catapult.png");
    expect(questPicture({ kind: "catapultHit", variant: "1" }).src).toBe("/assets/popups/building-catapult.png");
  });

  it("never uses the Build menu's white-boxed buttons", () => {
    const kinds = ["catapultHit", "upgradeResource", "upgradeDefence", "hatchMonster", "mushroom", "attackPlayer"];
    for (const kind of kinds) {
      for (const variant of [undefined, "1", "2", "3", "4", "6", "14", "20", "21", "23", "25"]) {
        expect(questPicture(variant === undefined ? { kind } : { kind, variant }).src).not.toContain("buildingbuttons");
      }
    }
  });

  it("lets only the painted squares fill their tile", () => {
    expect(pictureFillsTile({ src: "/portraits/C1-icon.webp", fallback: null })).toBe(true);
    expect(pictureFillsTile(questPicture({ kind: "upgradeDefence" }))).toBe(false);
    expect(pictureFillsTile(questPicture({ kind: "juice" }))).toBe(false);
  });
});

describe("progress and swap", () => {
  it("shows the figures short and never past the need", () => {
    expect(progressText({ have: 1, need: 3 })).toBe("1/3");
    expect(progressText({ have: 5, need: 3 })).toBe("3/3");
    expect(progressText({ have: 450_000, need: 1_200_000 })).toBe("450K/1.2M");
  });

  it("allows the swap on an unfinished, unclaimed quest while a swap is left", () => {
    expect(canSwap({ claimed: false, have: 0, need: 2 }, 1)).toBe(true);
    expect(canSwap({ claimed: false, have: 0, need: 2 }, 0)).toBe(false);
    expect(canSwap({ claimed: false, have: 2, need: 2 }, 1)).toBe(false);
    expect(canSwap({ claimed: true, have: 2, need: 2 }, 1)).toBe(false);
  });
});

describe("loginDays", () => {
  it("marks the claimed days and lights today", () => {
    expect(loginDays(login()).map((day) => day.state)).toEqual(["claimed", "claimed", "today", "later", "later", "later", "later"]);
  });

  it("shows tomorrow's day once today's is claimed", () => {
    const days = loginDays(login({ day: 3, onCard: 3, claimedToday: true }));
    expect(days.map((day) => day.state)).toEqual(["claimed", "claimed", "claimed", "next", "later", "later", "later"]);
    expect(days[6]).toEqual({ day: 7, shiny: 10, state: "later" });
  });

  it("starts a new card after day 7", () => {
    expect(loginDays(login({ day: 1, onCard: 0 }))[0]!.state).toBe("today");
  });
});

describe("grantedRewards", () => {
  it("shows the resources that landed, Shiny and speed-ups", () => {
    expect(
      grantedRewards([
        { kind: "resources", amounts: { r4: 4000 }, credited: { r4: 2500 }, overflow: { r4: 1500 } },
        { kind: "shiny", amount: 5 },
        { kind: "speedup", item: "SP2", count: 1, held: 3 },
      ]),
    ).toEqual([
      { kind: "resources", amounts: { r4: 2500 } },
      { kind: "shiny", amount: 5 },
      { kind: "speedup", item: "SP2", count: 1 },
    ]);
  });

  it("leaves out resources the storage cap turned away entirely", () => {
    expect(grantedRewards([{ kind: "resources", amounts: { r1: 10 }, credited: { r1: 0 }, overflow: { r1: 10 } }])).toEqual([]);
  });
});

describe("tabClaimable and utcDayOf", () => {
  it("counts the login day on Today, and each tab's ready quests and bonus", () => {
    const quest = (ready: boolean) => ({ slot: 0, kind: "mushroom", need: 1, have: ready ? 1 : 0, claimed: false, ready, rewards: [] });
    const view = {
      login: login(),
      daily: { quests: [quest(true), quest(false)], bonus: { shiny: 5, ready: false, claimed: false }, swapsLeft: 1 },
      weekly: { quests: [quest(true)], bonus: { shiny: 10, ready: true, claimed: false } },
    } as unknown as QuestsView;
    expect(tabClaimable(view, "today")).toBe(2);
    expect(tabClaimable(view, "weekly")).toBe(2);
  });

  it("reads the UTC day", () => {
    expect(utcDayOf(Date.UTC(2026, 10, 2, 23, 59) / 1000)).toBe("2026-11-02");
    expect(utcDayOf(Date.UTC(2026, 10, 3, 0, 0) / 1000)).toBe("2026-11-03");
  });
});

describe("paceHint (weekly quests adapt to the player's pace)", () => {
  it("says Harder or Easier with last week's need", () => {
    expect(paceHint({ kind: "weeklyFights", need: 13, was: 10 })).toEqual({ up: true, text: "▲ Harder: 13 fights (was 10)" });
    expect(paceHint({ kind: "weeklyFights", need: 9, was: 10 })).toEqual({ up: false, text: "▼ Easier: 9 fights (was 10)" });
    expect(paceHint({ kind: "weeklyLootGoo", need: 24_300_000, was: 19_400_000 })).toEqual({
      up: true,
      text: "▲ Harder: 24.3M Goo (was 19.4M)",
    });
    expect(paceHint({ kind: "weeklyLootPutty", need: 16_500_000, was: 19_400_000 })?.text).toBe("▼ Easier: 16.5M Putty (was 19.4M)");
  });

  it("says nothing when the need did not move", () => {
    expect(paceHint({ kind: "weeklyFights", need: 10 })).toBeNull();
    expect(paceHint({ kind: "weeklyFights", need: 10, was: 10 })).toBeNull();
    expect(paceHint({ kind: "weeklyHelpGift", need: 5 })).toBeNull();
  });
});
