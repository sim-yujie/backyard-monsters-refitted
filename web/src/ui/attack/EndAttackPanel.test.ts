// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { resourceName, spokenText } from "@/ui/resourceIcon";
import type { AttackSummary } from "@/game/attack/attackSave";
import { EndAttackPanel, formatSpan } from "./EndAttackPanel";

/**
 * The end-of-attack screen (`docs/design/attack-flow.md` §F6): the summary
 * it shows, the save states it moves through, and the two-step way out when
 * the save failed (§4.7).
 */

const summary = (over: Partial<AttackSummary> = {}): AttackSummary => ({
  targetName: "Kozu",
  kind: "wild",
  endReason: "exhausted",
  outcome: "Victory! Kozu's camp is defeated.",
  tone: "win",
  damagePercent: 93.4,
  buildingsDestroyed: 12,
  buildingsTotal: 14,
  loot: { r1: 12_500, r2: 0, r3: 800, r4: 0 },
  lootTaken: { r1: 12_500, r2: 0, r3: 800, r4: 0 },
  inferno: false,
  infernoTribe: false,
  monstersSent: 45,
  monstersBorn: 0,
  monstersLost: 9,
  champions: [{ t: 5, l: 1, hp: 41_000 }],
  elapsedSeconds: 140,
  ...over,
});

const mountPanel = (over: Partial<AttackSummary> = {}) => {
  const onReturn = vi.fn();
  const onRetry = vi.fn();
  const onLeave = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const panel = new EndAttackPanel({ summary: summary(over), onReturn, onRetry, onLeave }).mount(host);
  const query = <T extends HTMLElement>(selector: string): T => {
    const element = panel.element.querySelector<T>(selector);
    if (!element) throw new Error(`missing ${selector}`);
    return element;
  };
  return { panel, host, onReturn, onRetry, onLeave, query };
};

describe("EndAttackPanel", () => {
  it("says the yard was destroyed only at 100%, and what ended it short of that (#152)", () => {
    const flat = mountPanel({ endReason: "destroyed", damagePercent: 100 });
    expect(flat.query(".attack-end__reason").textContent).toBe("The yard was destroyed.");
    flat.panel.close();
    const walls = mountPanel({ endReason: "destroyed", damagePercent: 96 });
    expect(walls.query(".attack-end__reason").textContent).toBe(
      "Nothing your monsters could attack was left standing.",
    );
    walls.panel.close();
  });

  it("shows the outcome, damage, destroyed count, monsters lost and loot per resource", () => {
    const { panel, query } = mountPanel();
    const text = panel.element.textContent ?? "";
    expect(query(".attack-end__outcome").textContent).toBe("Victory! Kozu's camp is defeated.");
    expect(query(".attack-end__reason").textContent).toBe("Nothing was left to send.");
    expect(text).toContain("93%");
    expect(text).toContain("12 of 14");
    expect(text).toContain("9 of 45 sent");
    // Each amount is drawn with its resource's icon, which still says the name (#93).
    const items = [...panel.element.querySelectorAll<HTMLElement>(".attack-end__loot-item")];
    expect(items.map(spokenText)).toEqual(["Twigs 12,500 gained", "Pebbles 0", "Putty 800 gained", "Goo 0"]);
    expect(items.map((item) => item.querySelector(".res-icon")?.getAttribute("role"))).toEqual([
      "img", "img", "img", "img",
    ]);
    expect(items[0]?.querySelector(".res-amount__value")?.textContent).toBe("+12,500");
    expect(items[0]?.title).toBe("Twigs: 12,500 gained");
    // Won: green with a plus (owner, 28 Oct); nothing won stays a plain 0.
    expect(items[0]?.querySelector(".res-amount--gain")).not.toBeNull();
    expect(items[1]?.querySelector(".res-amount__value")?.textContent).toBe("0");
    expect(items[1]?.querySelector(".res-amount--gain")).toBeNull();
    expect(panel.panel.element.classList.contains("attack-end--win")).toBe(true);
    expect(panel.panel.element.getAttribute("aria-modal")).toBe("true");
  });

  it("shows the loot kept, and says when some did not fit in the attacker's storage (#166)", () => {
    const full = mountPanel({
      loot: { r1: 2_000, r2: 0, r3: 800, r4: 0 },
      lootTaken: { r1: 12_500, r2: 300, r3: 800, r4: 0 },
    });
    const items = [...full.panel.element.querySelectorAll<HTMLElement>(".attack-end__loot-item")];
    expect(items.map(spokenText)).toEqual(["Twigs 2,000 gained", "Pebbles 0", "Putty 800 gained", "Goo 0"]);
    expect(items[0]?.title).toBe(
      "Twigs: 2,000 gained of 12,500 taken; the rest did not fit in your storage",
    );
    expect(items[2]?.title).toBe("Putty: 800 gained");
    const note = full.query(".attack-end__storage");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("Your storage was full, so some loot was lost.");
    full.panel.close();

    const roomy = mountPanel();
    expect(roomy.query(".attack-end__storage").hidden).toBe(true);
    roomy.panel.close();
  });

  it("shows what the server banked once the save lands", () => {
    const { panel, query } = mountPanel();
    panel.setSaved({ credited: { r1: 10_000, r2: 0, r3: 800, r4: 0 } });
    const items = [...panel.element.querySelectorAll<HTMLElement>(".attack-end__loot-item")];
    expect(items.map(spokenText)).toEqual(["Twigs 10,000 gained", "Pebbles 0", "Putty 800 gained", "Goo 0"]);
    expect(query(".attack-end__storage").hidden).toBe(false);
  });

  /** The panel's stats as label: value, one per line. */
  const statsOf = (panel: EndAttackPanel): Record<string, string> => {
    const terms = [...panel.element.querySelectorAll(".attack-end__stats dt")];
    return Object.fromEntries(terms.map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? ""]));
  };

  it("names each champion sent on its own line, one beaten to no health as critically injured, not retreated", () => {
    const { panel } = mountPanel({ champions: [{ t: 3, l: 2, hp: 1200.7 }, { t: 5, l: 4, hp: 0 }] });
    expect(statsOf(panel)["Champions"]).toBe("Level 2 Fomor, 1,200 health left; Level 4 Krallen was critically injured");
    panel.close();
    const one = mountPanel();
    expect(statsOf(one.panel)["Champion"]).toBe("Level 1 Krallen, 41,000 health left");
    one.panel.close();
    const none = mountPanel({ champions: [] });
    expect(Object.keys(statsOf(none.panel))).toEqual(["Damage", "Buildings destroyed", "Monsters lost"]);
  });

  it("never counts more monsters lost than went out: a champion is not one, and the born are said", () => {
    // A champion-only attack used to read "2 of 0 sent".
    const alone = mountPanel({ monstersSent: 0, monstersLost: 0, champions: [{ t: 1, l: 3, hp: 0 }] });
    expect(statsOf(alone.panel)).toMatchObject({ "Monsters lost": "None sent", Champion: "Level 3 Gorgo was critically injured" });
    alone.panel.close();
    const split = mountPanel({ monstersSent: 4, monstersBorn: 6, monstersLost: 9 });
    expect(statsOf(split.panel)["Monsters lost"]).toBe("9 of 10 (4 sent, 6 born in the fight)");
  });

  it("draws an Inferno fight's loot as Bone, Coal, Sulfur and Magma, in full, then as the landing credited it", () => {
    const { panel, query } = mountPanel({
      inferno: true,
      loot: { r1: 3_823, r2: 120, r3: 0, r4: 0 },
      lootTaken: { r1: 3_823, r2: 120, r3: 0, r4: 0 },
    });
    const items = (): HTMLElement[] => [...panel.element.querySelectorAll<HTMLElement>(".attack-end__loot-item")];
    expect(items().map(spokenText)).toEqual(["Bone 3,823 gained", "Coal 120 gained", "Sulfur 0", "Magma 0"]);
    expect(items()[0]?.querySelector<HTMLElement>(".res-icon")?.dataset["realm"]).toBe("inferno");
    // The screen around it stays the surface's.
    expect(resourceName("r1")).toBe("Twigs");
    panel.setSaved({ credited: { r1: 3_407, r2: 100, r3: 0, r4: 0 } });
    expect(items().map(spokenText)).toEqual(["Bone 3,407 gained", "Coal 100 gained", "Sulfur 0", "Magma 0"]);
    expect(items()[0]?.title).toBe("Bone: 3,407 gained");
    // The Inferno purse takes it in full: no storage note.
    expect(query(".attack-end__storage").hidden).toBe(true);
  });

  it("opens saving, with Return to map disabled and no way out yet", () => {
    const { panel, query, onReturn } = mountPanel();
    expect(panel.saveStatus).toBe("saving");
    expect(query(".attack-end__status").textContent).toBe("Saving the result…");
    const back = query<HTMLButtonElement>(".attack-end__return");
    expect(back.disabled).toBe(true);
    back.click();
    expect(onReturn).not.toHaveBeenCalled();
    expect(query(".attack-end__retry").hidden).toBe(true);
    expect(query(".attack-end__leave").hidden).toBe(true);
  });

  it("once saved, Return to map works and the defender's protection is shown when granted", () => {
    const { panel, query, onReturn } = mountPanel({ kind: "main", targetName: "Ann" });
    panel.setSaved({ protectedUntil: 1_000 + 36 * 3600, now: 1_000 });
    expect(panel.saveStatus).toBe("saved");
    expect(query(".attack-end__status").textContent).toBe("Result saved.");
    const protection = query(".attack-end__protection");
    expect(protection.hidden).toBe(false);
    expect(protection.textContent).toBe("Ann is now under damage protection for 36 h.");
    const back = query<HTMLButtonElement>(".attack-end__return");
    expect(back.disabled).toBe(false);
    expect(document.activeElement).toBe(back);
    back.click();
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("says nothing about protection when the response grants none", () => {
    const { panel, query } = mountPanel();
    panel.setSaved({ protectedUntil: 0, now: 1_000 });
    expect(query(".attack-end__protection").hidden).toBe(true);
    panel.setSaved({ protectedUntil: 900, now: 1_000 });
    expect(query(".attack-end__protection").hidden).toBe(true);
  });

  describe("after a Moloch tribe (Inferno WP 2.10)", () => {
    const tribe = {
      targetName: "Moloch's Minions",
      endReason: "destroyed" as const,
      damagePercent: 100,
      title: "Attack Ended",
      outcome: "You failed to destroy the Under Hall of this Inferno Yard, rebuild your monsters and try again.",
      tone: "lose" as const,
      inferno: true,
      infernoTribe: true,
      loot: { r1: 900, r2: 300, r3: 0, r4: 0 },
      lootTaken: { r1: 900, r2: 300, r3: 0, r4: 0 },
    };
    const mountTribe = () => {
      const onHome = vi.fn();
      const onReturn = vi.fn();
      const host = document.createElement("div");
      document.body.append(host);
      const panel = new EndAttackPanel({
        summary: summary(tribe),
        home: { label: "Return Home", onHome },
        onReturn,
        onRetry: vi.fn(),
        onLeave: vi.fn(),
      }).mount(host);
      const query = <T extends HTMLElement>(selector: string): T => panel.element.querySelector<T>(selector)!;
      return { panel, query, onHome, onReturn };
    };

    it("heads with Flash's words, and leaves out the yard-destroyed reason", () => {
      const { panel, query } = mountTribe();
      expect(query(".panel__title").textContent).toBe("Attack Ended");
      expect(query(".attack-end__outcome").textContent).toBe(tribe.outcome);
      expect(query(".attack-end__reason").hidden).toBe(true);
      expect(panel.panel.element.classList.contains("attack-end--lose")).toBe(true);
      panel.close();
    });

    it("opens Return Home, beside Return to map, only once the result is saved", () => {
      const { panel, query, onHome, onReturn } = mountTribe();
      const home = query<HTMLButtonElement>(".attack-end__home");
      expect(home.textContent).toBe("Return Home");
      expect(home.nextElementSibling).toBe(query(".attack-end__return"));
      expect(home.disabled).toBe(true);
      home.click();
      expect(onHome).not.toHaveBeenCalled();
      panel.setFailed({ message: "Could not reach the server to save the result.", canRetry: true });
      expect(home.disabled).toBe(true);
      panel.setSaved({});
      expect(home.disabled).toBe(false);
      home.click();
      expect(onHome).toHaveBeenCalledTimes(1);
      expect(onReturn).not.toHaveBeenCalled();
      panel.close();
    });

    it("takes the landed result, says when the tribe is back, and what the full purse turned away", () => {
      const { panel, query } = mountTribe();
      panel.setSaved({
        result: { title: "Base Destroyed!", outcome: "The Under Hall fell.", tone: "win" },
        credited: { r1: 400, r2: 300, r3: 0, r4: 0 },
        taken: { r1: 900, r2: 300, r3: 0, r4: 0 },
        backAt: 1_000 + 3600,
        now: 1_000,
      });
      expect(query(".panel__title").textContent).toBe("Base Destroyed!");
      expect(query(".attack-end__outcome").textContent).toBe("The Under Hall fell.");
      expect(panel.panel.element.classList.contains("attack-end--win")).toBe(true);
      expect(panel.panel.element.classList.contains("attack-end--lose")).toBe(false);
      const back = query(".attack-end__protection");
      expect(back.hidden).toBe(false);
      expect(back.textContent).toBe("Moloch's Minions will be back in 1 h.");
      const items = [...panel.element.querySelectorAll<HTMLElement>(".attack-end__loot-item")];
      expect(items.map(spokenText)).toEqual(["Bone 400 gained", "Coal 300 gained", "Sulfur 0", "Magma 0"]);
      expect(items[0]?.title).toBe("Bone: 400 gained of 900 taken; the rest did not fit in your storage");
      expect(query(".attack-end__storage").hidden).toBe(false);
      expect(query(".attack-end__storage").textContent).toBe("Your Inferno storage was full, so some loot was lost.");
      panel.close();
    });

    it("says no comeback while the tribe still stands", () => {
      const { panel, query } = mountTribe();
      panel.setSaved({ backAt: null, now: 1_000 });
      expect(query(".attack-end__protection").hidden).toBe(true);
      panel.close();
    });
  });

  it("has no Return Home outside a tribe attack", () => {
    const { panel } = mountPanel();
    expect(panel.element.querySelector(".attack-end__home")).toBeNull();
    panel.close();
  });

  it("on a failure shows the error with Retry, and Retry re-enters saving", () => {
    const { panel, query, onRetry } = mountPanel();
    panel.setFailed({ message: "Could not reach the server to save the result.", canRetry: true });
    expect(panel.saveStatus).toBe("failed");
    expect(query(".attack-end__status").textContent).toBe("Could not reach the server to save the result.");
    expect(query(".attack-end__status").classList.contains("attack-end__status--failed")).toBe(true);
    const retry = query<HTMLButtonElement>(".attack-end__retry");
    expect(retry.hidden).toBe(false);
    expect(document.activeElement).toBe(retry);
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    panel.setSaving();
    expect(panel.saveStatus).toBe("saving");
    expect(retry.hidden).toBe(true);
    expect(query(".attack-end__leave").hidden).toBe(true);
  });

  it("hides Retry when a retry cannot help, and still offers a way out", () => {
    const { panel, query } = mountPanel();
    panel.setFailed({ message: "This attack expired before it could be saved.", canRetry: false });
    expect(query(".attack-end__retry").hidden).toBe(true);
    expect(query(".attack-end__leave").hidden).toBe(false);
    expect(document.activeElement).toBe(query(".attack-end__leave"));
  });

  it("leaving without saving takes two clicks, and can be backed out of", () => {
    const { panel, query, onLeave } = mountPanel();
    panel.setFailed({ message: "nope", canRetry: true });
    const leave = query<HTMLButtonElement>(".attack-end__leave");
    const confirm = query(".attack-end__leave-confirm");
    expect(confirm.hidden).toBe(true);

    leave.click();
    expect(onLeave).not.toHaveBeenCalled();
    expect(confirm.hidden).toBe(false);
    expect(leave.hidden).toBe(true);

    query<HTMLButtonElement>(".attack-end__leave-no").click();
    expect(confirm.hidden).toBe(true);
    expect(leave.hidden).toBe(false);
    expect(onLeave).not.toHaveBeenCalled();

    leave.click();
    query<HTMLButtonElement>(".attack-end__leave-yes").click();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("closes cleanly", () => {
    const { panel, host } = mountPanel();
    expect(host.children).toHaveLength(1);
    panel.close();
    expect(host.children).toHaveLength(0);
  });
});

describe("formatSpan", () => {
  it("spells hours and minutes", () => {
    expect(formatSpan(36 * 3600)).toBe("36 h");
    expect(formatSpan(8 * 3600 + 30 * 60)).toBe("8 h 30 min");
    expect(formatSpan(90)).toBe("2 min");
    expect(formatSpan(5)).toBe("1 min");
    expect(formatSpan(8 * 3600 - 1)).toBe("8 h");
  });
});
