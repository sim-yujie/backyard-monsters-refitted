// @vitest-environment jsdom
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChampionSaveEntry } from "@/api/types";
import { CHAMPION_ABILITIES, abilitiesUnlocked, crystalsHeld } from "@/game/events/crystals";
import { CrystalAbilities, abilityIconUrl, ownedChampion, unlockNote } from "./CrystalAbilities";

/**
 * The Champion tab's Abilities view (Monster Madness crystals, 27 Nov 2026):
 * the counts it reads, each row's states, and Unlock through a confirm.
 */

const rewards = (crystals: number, counts: Record<string, number>, korath = 0) => ({
  mmCrystals: { id: "mmCrystals", value: crystals },
  championAbilities: { id: "championAbilities", value: counts },
  korathPower: { id: "korathPower", value: korath },
});

const gorgo: ChampionSaveEntry = { t: 1, l: 6, hp: 1, pl: 3, status: 0 } as ChampionSaveEntry;
const korath: ChampionSaveEntry = { t: 4, l: 2, hp: 1, pl: 1, status: 1 } as ChampionSaveEntry;

afterEach(() => document.body.replaceChildren());

describe("crystal counts", () => {
  it("reads the crystals and each champion's abilities forgivingly", () => {
    const held = rewards(3, { "1": 2, "2": 9 }, 1);
    expect(crystalsHeld(held)).toBe(3);
    expect(abilitiesUnlocked(held, 1)).toBe(2);
    expect(abilitiesUnlocked(held, 2)).toBe(3);
    expect(abilitiesUnlocked(held, 3)).toBe(0);
    expect(abilitiesUnlocked(held, 4)).toBe(1);
    expect(abilitiesUnlocked(held, 5)).toBe(0);
    expect(crystalsHeld(null)).toBe(0);
  });

  it("says when an ability waits for its champion or his level", () => {
    const fire = { id: "breathOfFire", name: "Breath of Fire", line: "", fromLevel: 4 } as const;
    expect(unlockNote(4, fire, null)).toBe("Ready when you get Korath.");
    expect(unlockNote(4, fire, { level: 2 })).toBe("Works from Korath level 4.");
    expect(unlockNote(4, fire, { level: 5 })).toBeNull();
    expect(ownedChampion([gorgo, korath], 4)).toEqual({ level: 2, frozen: true });
    expect(ownedChampion([gorgo], 2)).toBeNull();
  });
});

describe("the Abilities view", () => {
  const view = (crystals: number, crystal = vi.fn()) => {
    const save = { rewards: rewards(crystals, { "1": 2 }, 1), champion: [gorgo, korath] };
    const panel = new CrystalAbilities({ read: () => save, actions: { crystal }, popups: () => document.body });
    document.body.append(panel.element);
    panel.render();
    return { panel, save, crystal };
  };

  it("shows the crystals, four champions and their slots' states", () => {
    view(2);
    expect(document.querySelector(".crystal-abilities__count")?.textContent).toBe("2");
    expect(document.querySelector(".crystal-abilities__total")?.textContent).toBe("3 / 12 unlocked");
    const rows = [...document.querySelectorAll(".crystal-row")];
    expect(rows.map((row) => (row as HTMLElement).dataset.type)).toEqual(["1", "2", "3", "4"]);
    const states = (row: Element) =>
      [...row.querySelectorAll(".crystal-slot")].map((slot) => slot.className.match(/--(unlocked|next|locked)/)?.[1]);
    expect(states(rows[0]!)).toEqual(["unlocked", "unlocked", "next"]);
    expect(states(rows[1]!)).toEqual(["next", "locked", "locked"]);
    expect(rows[1]!.classList.contains("crystal-row--unowned")).toBe(true);
    expect(rows[3]!.querySelectorAll(".crystal-slot__gate")).toHaveLength(2);
  });

  it("offers no Unlock without a crystal, and none for a champion with all three", () => {
    view(0);
    const unlocks = [...document.querySelectorAll<HTMLButtonElement>(".crystal-row__unlock")];
    expect(unlocks).toHaveLength(4);
    expect(unlocks.every((one) => one.disabled)).toBe(true);
  });

  it("asks before spending, and spends on Unlock", async () => {
    const crystal = vi.fn(async () => ({
      ok: true as const,
      report: { type: 2, abilities: 1, crystals: 0, hasChampion: false, rewards: {} },
      completed: [],
    }));
    view(1, crystal);
    document.querySelectorAll<HTMLButtonElement>(".crystal-row__unlock")[1]!.click();
    await Promise.resolve();
    expect(document.querySelector(".crystal-dialog")?.textContent).toContain("Drull · Bloodthirst");
    document.querySelector<HTMLButtonElement>(".crystal-dialog__go")!.click();
    await vi.waitFor(() => expect(crystal).toHaveBeenCalledWith(2));
    await vi.waitFor(() => expect(document.querySelector(".crystal-dialog--unlocked")).not.toBeNull());
    expect(document.querySelector(".crystal-dialog--unlocked")?.textContent).toContain("Ready when you get Drull.");
  });
});

describe("ability icons", () => {
  const all = Object.values(CHAMPION_ABILITIES).flat();
  const file = (ability: (typeof all)[number]) => abilityIconUrl(ability).replace(/^.*?\/(?=ui\/|status-icons\/)/, "");

  it("gives every ability a painted icon on disk", () => {
    for (const ability of all) {
      const onDisk = path.resolve(__dirname, "../../../public", file(ability));
      expect(existsSync(onDisk), `${ability.id}: ${onDisk}`).toBe(true);
    }
  });

  it("gives every ability its own icon (Obsidian Hide no longer borrows Stone Skin's)", () => {
    const files = all.map(file);
    expect(new Set(files).size).toBe(files.length);
    expect(file(all.find((a) => a.id === "obsidianHide")!)).toBe("ui/abilities/obsidian-hide.webp");
  });
});
