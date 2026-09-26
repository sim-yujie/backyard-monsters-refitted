// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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
  outcome: "Victory! Kozu's camp is destroyed.",
  tone: "win",
  damagePercent: 93.4,
  buildingsDestroyed: 12,
  buildingsTotal: 14,
  loot: { r1: 12_500, r2: 0, r3: 800, r4: 0 },
  monstersSent: 45,
  monstersLost: 9,
  championHp: 41_000,
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
  it("shows the outcome, damage, destroyed count, monsters lost and loot per resource", () => {
    const { panel, query } = mountPanel();
    const text = panel.element.textContent ?? "";
    expect(query(".attack-end__outcome").textContent).toBe("Victory! Kozu's camp is destroyed.");
    expect(query(".attack-end__reason").textContent).toBe("Nothing was left to send.");
    expect(text).toContain("93%");
    expect(text).toContain("12 of 14");
    expect(text).toContain("9 of 45 sent");
    const loot = [...panel.element.querySelectorAll(".attack-end__loot-item")].map((item) => item.textContent);
    expect(loot).toEqual(["Twigs 12.5K", "Pebbles 0", "Putty 800", "Goo 0"]);
    expect(panel.panel.element.classList.contains("attack-end--win")).toBe(true);
    expect(panel.panel.element.getAttribute("aria-modal")).toBe("true");
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
  });
});
