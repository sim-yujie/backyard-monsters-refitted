// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RaidResult, RaidView } from "@/api/raid";
import { RaidYardUi, raidFrequencyPopup, raidResultPopup, spottedLine } from "./RaidScreens";

/** The raid's screens on the own yard (issue #226 WP4), as the DOM shows them. */

const raid = (over: Partial<RaidView> = {}): RaidView => ({
  id: "r1",
  phase: "warning",
  tribe: "Kozu",
  monsters: { C2: 10, C4: 5, C3: 2, C1: 1 },
  attackAt: 1_000,
  warned: 0,
  ...over,
});

const result = (defended: boolean): RaidResult => ({
  id: "r1",
  tribe: "Kozu",
  at: 1_000,
  defended,
  health: defended ? 0.95 : 0.42,
  stolen: { r1: defended ? 0 : 1_200, r2: 0, r3: defended ? 0 : 300, r4: 0 },
  shiny: defended ? 10 : 0,
  damaged: defended ? [] : [1, 2],
  housedLost: defended ? 0 : 1,
});

const layers = () => {
  const modal = document.createElement("div");
  const content = document.createElement("div");
  document.body.append(modal, content);
  return { modal, content };
};

const buttonNamed = (root: ParentNode, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((one) => one.textContent?.includes(label));
  if (!found) throw new Error(`no button "${label}"`);
  return found;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("RaidYardUi", () => {
  const ui = () => {
    const { modal, content } = layers();
    const actions = { onEngage: vi.fn(), onPrepare: vi.fn(), onMap: vi.fn(), notice: vi.fn() };
    return { modal, content, actions, view: new RaidYardUi({ modal, content, ...actions }) };
  };

  it("shows the alert with the tribe, three monster types and the time left, and no way to skip it", () => {
    const t = ui();
    t.view.render({ kind: "alert", raid: raid(), secondsLeft: 299 }, null);
    const alert = t.modal.querySelector(".raid-alert")!;
    expect(alert.textContent).toContain("WILD MONSTER ALERT");
    expect(alert.textContent).toContain("Kozu Tribe");
    expect(alert.textContent).toContain("18 wild monsters");
    expect(alert.querySelectorAll(".raid-alert__monster")).toHaveLength(3);
    expect(alert.querySelector(".raid-alert__eta")!.textContent).toBe("ETA: 4:59");
    expect(alert.querySelector(".panel__close")).toBeNull();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(t.modal.querySelector(".raid-alert")).not.toBeNull();

    buttonNamed(alert, "Engage now").click();
    buttonNamed(alert, "Prepare defences").click();
    expect(t.actions.onEngage).toHaveBeenCalledTimes(1);
    expect(t.actions.onPrepare).toHaveBeenCalledTimes(1);
    t.view.destroy();
  });

  it("disables the answers while one is on its way", () => {
    const t = ui();
    t.view.render({ kind: "alert", raid: raid(), secondsLeft: 200 }, "engage");
    expect(buttonNamed(t.modal, "Engaging").disabled).toBe(true);
    expect(buttonNamed(t.modal, "Prepare defences").disabled).toBe(true);
    t.view.destroy();
  });

  it("swaps the alert for the top bar, with I'm Ready Now while it counts down", () => {
    const t = ui();
    t.view.render({ kind: "alert", raid: raid(), secondsLeft: 200 }, null);
    t.view.render({ kind: "spotted", raid: raid({ warned: 1 }), secondsLeft: 125 }, null);
    expect(t.modal.querySelector(".raid-alert")).toBeNull();
    const bar = t.content.querySelector(".raid-bar")!;
    expect(bar.textContent).toContain("WILD MONSTERS SPOTTED!");
    expect(bar.textContent).toContain("They attack in 2:05");
    buttonNamed(bar, "I'm Ready Now").click();
    expect(t.actions.onEngage).toHaveBeenCalledTimes(1);

    t.view.render({ kind: "due", raid: raid({ warned: 1 }), planner: true }, null);
    expect(bar.textContent).toContain("close the Yard Planner");
    expect(buttonNamed(bar, "I'm Ready Now").hidden).toBe(true);
    t.view.destroy();
    expect(t.content.querySelector(".raid-bar")).toBeNull();
  });

  it("locks the yard while a raid is fought elsewhere, with the map still open", () => {
    const t = ui();
    t.view.render({ kind: "locked", raid: raid({ phase: "fighting" }) }, null);
    expect(t.modal.querySelector(".raid-lock")!.textContent).toContain("Kozu Tribe is raiding your yard");
    buttonNamed(t.modal, "Open the map").click();
    expect(t.actions.onMap).toHaveBeenCalled();
    t.view.render({ kind: "none" }, null);
    expect(t.modal.querySelector(".raid-lock")).toBeNull();
  });

  it("says the due line", () => {
    expect(spottedLine({ kind: "due", raid: raid(), planner: false })).toBe("Here they come!");
  });
});

describe("raid result popup", () => {
  it("shows a good defence with its reward and no Repair now", () => {
    const { modal } = layers();
    raidResultPopup(result(true), { price: 50, blocked: null, buy: vi.fn() }, () => {}).mount(modal);
    const popup = modal.querySelector(".raid-result--good")!;
    expect(popup.textContent).toContain("Yard defended!");
    expect(popup.textContent).toContain("95%");
    expect(popup.querySelector(".raid-result__reward")!.textContent).toContain("+10");
    expect(popup.querySelector(".raid-result__repair")).toBeNull();
  });

  it("shows a poor defence with what was taken, and buys Repair now", async () => {
    const { modal } = layers();
    const onClose = vi.fn();
    const buy = vi.fn(async () => null);
    raidResultPopup(result(false), { price: 50, blocked: null, buy }, onClose).mount(modal);
    const popup = modal.querySelector(".raid-result--poor")!;
    expect(popup.textContent).toContain("Damn those Wild Monsters!");
    expect(popup.querySelector(".raid-result__stolen")!.textContent).toContain("1,200");
    expect(popup.textContent).toContain("2 damaged buildings are repairing now.");
    expect(popup.textContent).toContain("1 housed monster was lost");

    buttonNamed(popup, "Repair now").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(buy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the popup up with the reason when Repair now is refused", async () => {
    const { modal } = layers();
    raidResultPopup(result(false), { price: 50, blocked: null, buy: async () => "Not enough Shiny." }, () => {}).mount(
      modal,
    );
    buttonNamed(modal, "Repair now").click();
    await Promise.resolve();
    await Promise.resolve();
    const status = modal.querySelector<HTMLElement>(".raid-result__status")!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe("Not enough Shiny.");
  });
});

describe("raid frequency popup", () => {
  it("says ATTACK REPELLED after a good defence and saves the answer", () => {
    const { modal } = layers();
    const onAnswer = vi.fn();
    raidFrequencyPopup("Kozu", true, onAnswer).mount(modal);
    expect(modal.textContent).toContain("ATTACK REPELLED");
    expect(modal.querySelectorAll(".raid-frequency__choice")).toHaveLength(3);
    (modal.querySelector(".raid-frequency__choice--more") as HTMLButtonElement).click();
    expect(onAnswer).toHaveBeenCalledWith("more");
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(modal.querySelector(".raid-frequency")).toBeNull();
  });

  it("uses a plain title after a poor defence, and closing keeps the last choice", () => {
    const { modal } = layers();
    const onAnswer = vi.fn();
    const popup = raidFrequencyPopup("Kozu", false, onAnswer).mount(modal);
    expect(modal.textContent).toContain("THE RAIDERS HAVE GONE");
    expect(modal.textContent).not.toContain("ATTACK REPELLED");
    popup.close();
    expect(onAnswer).toHaveBeenCalledWith(null);
  });
});
