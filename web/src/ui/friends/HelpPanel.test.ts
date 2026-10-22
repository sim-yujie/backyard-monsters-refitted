// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { YardBuilding } from "@/game/yard/yardModel";
import { buildingHelp } from "@/game/friends/helpModel";
import { HelpPanel } from "./HelpPanel";

const NOW = 1_800_000_000;

const silo = {
  id: 7,
  type: 6,
  name: "Storage Silo",
  level: 3,
  countdown: { kind: "upgrade", endsAt: NOW + 7_800, seconds: 7_800, paused: false },
  raw: { id: 7, t: 6, hl: [1, 2, 3] },
} as unknown as YardBuilding;

const tower = { id: 8, type: 20, name: "Cannon Tower", level: 2, countdown: null, raw: { id: 8 } } as unknown as YardBuilding;

const mount = (onHelp = vi.fn(async () => {})) => {
  const host = document.createElement("div");
  document.body.append(host);
  const panel = new HelpPanel({ onHelp, now: () => NOW }).mount(host);
  return { panel, onHelp, host };
};

const buttons = (panel: HelpPanel) => [...panel.element.querySelectorAll<HTMLButtonElement>(".help-panel__button")];

describe("HelpPanel (#374)", () => {
  it("offers a speed-up with the time it saves and the helpers so far", () => {
    const { panel } = mount();
    panel.show(silo, buildingHelp({ helpsLeft: 5, buildings: { "7": { speedup: true } } }, 7));
    const text = panel.element.textContent ?? "";
    // A friend's yard is someone else's: the title is the name, no level (owner report 2026-10-22).
    expect(panel.element.querySelector(".panel__title")?.textContent).toBe("Storage Silo");
    expect(text).not.toMatch(/level/i);
    expect(text).toContain("Takes 6m 30s off the Storage Silo upgrade (5% of the time left).");
    expect(text).toContain("3 of 5 friends have helped");
    const [speed] = buttons(panel);
    expect(speed?.textContent).toBe("Speed up");
    expect(speed?.disabled).toBe(false);
  });

  it("offers a repair", () => {
    const { panel } = mount();
    panel.show(tower, buildingHelp({ helpsLeft: 5, buildings: { "8": { repair: true } } }, 8));
    expect(panel.element.textContent).toContain("Repairs this Cannon Tower now.");
    expect(buttons(panel).map((b) => b.textContent)).toEqual(["Repair"]);
  });

  it("disables a help the server refused, saying why", () => {
    const { panel } = mount();
    panel.show(silo, buildingHelp({ helpsLeft: 0, buildings: { "7": { speedup: "dailyCap", repair: "tooNew" } } }, 7));
    const [speed, repair] = buttons(panel);
    expect(speed?.disabled).toBe(true);
    expect(repair?.disabled).toBe(true);
    const reasons = [...panel.element.querySelectorAll(".help-panel__reason")].map((one) => one.textContent);
    expect(reasons).toEqual([
      "You have used all your helps for today. More tomorrow.",
      expect.stringContaining("Helping opens once you have been friends for a day"),
    ]);
  });

  it("says when there is nothing to help with", () => {
    const { panel } = mount();
    panel.show(tower, null);
    expect(buttons(panel)).toHaveLength(0);
    expect(panel.element.textContent).toContain("There is nothing to help with here.");
  });

  it("runs the help once, busy while it goes, and shows the thank-you", async () => {
    let finish!: () => void;
    const onHelp = vi.fn(
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    const { panel } = mount(onHelp);
    panel.show(silo, buildingHelp({ helpsLeft: 5, buildings: { "7": { speedup: true } } }, 7));
    buttons(panel)[0]?.click();
    expect(onHelp).toHaveBeenCalledWith(silo, "speedup");
    expect(buttons(panel)[0]?.disabled).toBe(true);
    expect(buttons(panel)[0]?.textContent).toBe("Helping…");
    buttons(panel)[0]?.click();
    expect(onHelp).toHaveBeenCalledTimes(1);

    panel.show(silo, buildingHelp({ helpsLeft: 4, buildings: { "7": { speedup: "alreadyHelped" } } }, 7));
    panel.setMessage("Thanks for helping!", "thanks");
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(buttons(panel)[0]?.disabled).toBe(true);
    expect(panel.message).toBe("Thanks for helping!");
    expect(panel.element.querySelector(".help-panel__status--thanks")).not.toBeNull();
  });

  it("drops the last message when another building is shown", () => {
    const { panel } = mount();
    panel.show(silo, null);
    panel.setMessage("They are under attack right now.", "error");
    expect(panel.element.querySelector(".help-panel__status--error")).not.toBeNull();
    panel.show(silo, null);
    expect(panel.message).toBe("They are under attack right now.");
    panel.show(tower, null);
    expect(panel.message).toBe("");
  });

  it("closes, telling its owner", () => {
    const onClose = vi.fn();
    const host = document.createElement("div");
    const panel = new HelpPanel({ onHelp: async () => {}, onClose }).mount(host);
    panel.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.childElementCount).toBe(0);
  });
});
