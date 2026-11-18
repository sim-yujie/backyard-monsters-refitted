// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Container } from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { readYard } from "@/game/yard/yardModel";
import { DockTabs } from "@/ui/attack/DockTabs";
import { Notices } from "@/ui/maproom/Notices";
import { dropPlugin } from "./drop";

/**
 * The drop plugin's share of the dock: its tabs in the dock's pinned tab row
 * (owner, 18 Nov 2026), one window shown at a time, so the dock never stacks
 * Army, Catapult and Siege (#59); a bomb armed on the Catapult stays armed
 * while the Army is up; and Flash's one siege weapon per attack (Inferno WP 6.8).
 */


const load = (buildings: Record<string, unknown> = { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } }): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const target = (siege: Readonly<Record<string, unknown>> | null = null, extra: Partial<AttackTarget> = {}, response = load()): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 3 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 1,
    sources: [],
    siege,
    resources: { r1: 50_000, r2: 50_000, r3: 50_000, r4: 50_000 },
    credits: 0,
  },
  load: response,
  ...extra,
});

describe("the drop plugin's pickers in the dock", () => {
  let sheet: HTMLElement;
  let dock: HTMLElement;
  let tabs: DockTabs;
  let session: AttackSession;
  let teardown: (() => void) | void;
  let phone = false;

  const button = (text: string): HTMLButtonElement => {
    const found = [...sheet.querySelectorAll<HTMLButtonElement>(".attack-dock__tab")].find(
      (candidate) => candidate.textContent === text,
    );
    if (!found) throw new Error(`no ${text} tab`);
    return found;
  };
  const hasButton = (text: string): boolean =>
    [...document.querySelectorAll("button")].some((candidate) => candidate.textContent === text);
  /** The tool windows the selected tab shows (what the stylesheet leaves visible). */
  const open = (): string[] => {
    if (!tabs.showing()) return [];
    return [...dock.querySelectorAll<HTMLElement>(".attack-picker")]
      .filter((panel) => panel.dataset["dockTab"] === sheet.dataset["tab"])
      .map((panel) => (panel.classList.contains("attack-catapult") ? "catapult" : "siege"));
  };
  const hasSiegeTab = (): boolean => sheet.querySelector('.attack-dock__tab[data-tab="siege"]') !== null;
  const tabNames = (): string[] =>
    [...sheet.querySelectorAll<HTMLButtonElement>(".attack-dock__tab")].map((tab) => tab.textContent ?? "");
  const fire = (): HTMLButtonElement => dock.querySelector<HTMLButtonElement>("[data-fire]")!;

  const mount = (attackTarget: AttackTarget): void => {
    sheet = document.createElement("div");
    sheet.className = "attack-dock";
    dock = document.createElement("div");
    dock.className = "attack-dock__body";
    tabs = new DockTabs({ dock: sheet, sheet: () => phone, onChange: () => {} });
    // The army package's tab, as army.ts adds it.
    tabs.add("army", { label: "Army" });
    sheet.append(tabs.element, dock);
    document.body.append(sheet);
    session = new AttackSession({ target: attackTarget, seed: 1 });
    const mounts = {
      session,
      target: session.target,
      yard: readYard(attackTarget.load!, { foreign: true }),
      renderer: {
        yardToWorld: (x: number, y: number) => ({ x, y }),
        worldToYard: (x: number, y: number) => ({ x, y }),
        highlightBuilding: () => {},
      },
      camera: { screenToWorld: (point: { x: number; y: number }) => point },
      canvas: document.createElement("canvas"),
      dock,
      dockTabs: tabs,
      battleLayer: new Container(),
      notices: new Notices().mount(document.body),
      setBottomInset: () => {},
      showResources: () => {},
    } as unknown as AttackMounts;
    teardown = dropPlugin(mounts);
  };

  afterEach(() => {
    teardown?.();
    phone = false;
    document.body.replaceChildren();
  });

  it("adds a Catapult tab after the Army, and shows no siege tab with no weapon in stock", () => {
    mount(target(null));
    expect(tabNames()).toEqual(["Army", "Catapult"]);
    expect(hasButton("Decoy")).toBe(false);
    button("Catapult").click();
    expect(open()).toEqual(["catapult"]);
    expect(button("Catapult").getAttribute("aria-selected")).toBe("true");
    expect(button("Army").getAttribute("aria-selected")).toBe("false");
    expect(sheet.dataset["tab"]).toBe("catapult");

    // The column: the open tab stays up; the Army tab goes back.
    button("Catapult").click();
    expect(open()).toEqual(["catapult"]);
    button("Army").click();
    expect(open()).toEqual([]);
    expect(sheet.dataset["tab"]).toBe("army");
  });

  it("keeps a bomb armed while the Army tab is up, and lights the Catapult tab (owner, 18 Nov 2026)", () => {
    mount(target(null));
    button("Catapult").click();
    const arm = dock.querySelector<HTMLButtonElement>(".attack-catapult__arm:not([disabled])");
    expect(arm).not.toBeNull();
    arm!.click();
    const armed = (): boolean => (window as unknown as { __attack: { input: { pendingTool(): unknown } } }).__attack.input.pendingTool() !== null;
    expect(armed()).toBe(true);
    expect(button("Catapult").classList.contains("attack-tools__button--armed")).toBe(true);

    button("Army").click();
    expect(armed()).toBe(true);
    expect(button("Catapult").classList.contains("attack-tools__button--armed")).toBe(true);
    // Back on the Catapult, the same window, still armed.
    button("Catapult").click();
    expect(dock.querySelectorAll(".attack-catapult")).toHaveLength(1);
    expect(armed()).toBe(true);
  });

  it("opens the phone sheet on a tapped tab and closes it on the open tab, keeping the bomb armed", () => {
    phone = true;
    mount(target(null));
    expect(tabs.isOpen()).toBe(false);
    expect(open()).toEqual([]);
    button("Catapult").click();
    expect(tabs.isOpen()).toBe(true);
    expect(sheet.classList.contains("attack-dock--open")).toBe(true);
    expect(open()).toEqual(["catapult"]);
    dock.querySelector<HTMLButtonElement>(".attack-catapult__arm:not([disabled])")!.click();
    const armed = (): boolean => (window as unknown as { __attack: { input: { pendingTool(): unknown } } }).__attack.input.pendingTool() !== null;
    expect(armed()).toBe(true);
    // The open tab closes the sheet; the bomb waits for its tap.
    button("Catapult").click();
    expect(tabs.isOpen()).toBe(false);
    expect(button("Catapult").getAttribute("aria-selected")).toBe("false");
    expect(armed()).toBe(true);
    // Another tab opens it straight on that tab.
    button("Army").click();
    expect(tabs.isOpen()).toBe(true);
    expect(sheet.dataset["tab"]).toBe("army");
    expect(armed()).toBe(true);
  });

  it("gives the tool windows no title plate close button: the tab is their title", () => {
    mount(target({ decoy: { level: 1, quantity: 1 } }));
    button("Catapult").click();
    button("Decoy").click();
    for (const panel of dock.querySelectorAll(".attack-picker")) {
      expect(panel.querySelector('[aria-label^="Close"]')).toBeNull();
    }
    const styles = resolve(dirname(fileURLToPath(import.meta.url)), "../../../ui/styles");
    const attack = readFileSync(resolve(styles, "attack.css"), "utf8");
    expect(attack).toMatch(/\.attack-dock--tabs \.attack-dock__body > \[data-dock-tab\] > \.panel__titlebar \{\s*display: none;/);
  });

  it("keeps a pressed tab still, so the press cannot make the dock scroll and lose the click (Brave)", () => {
    // ui.css sinks a pressed button 1px; in the dock's scrolling body that
    // 1px overflowed it, a Windows scrollbar narrowed it, the Army panel
    // rewrapped and the button slid away before the release. jsdom lays
    // nothing out, so the rule that stops it is pinned.
    mount(target(null));
    expect(tabs.element.nextElementSibling).toBe(dock);
    const styles = resolve(dirname(fileURLToPath(import.meta.url)), "../../../ui/styles");
    const ui = readFileSync(resolve(styles, "ui.css"), "utf8");
    expect(ui).toMatch(/\n\.btn:active:not\(:disabled\) \{\s*transform: translateY\(1px\);/);
    const attack = readFileSync(resolve(styles, "attack.css"), "utf8");
    expect(attack).toMatch(/\n\.btn\.attack-tools__button:active:not\(:disabled\) \{\s*transform: none;/);
  });

  it("offers no Siege button for a weapon with none left, nor in the Descent", () => {
    mount(target({ decoy: { level: 1, quantity: 0 } }));
    expect(hasSiegeTab()).toBe(false);
    teardown?.();
    document.body.replaceChildren();
    mount(target({ decoy: { level: 1, quantity: 1 } }, { descentYard: 1 }));
    expect(hasSiegeTab()).toBe(false);
  });

  it("offers no Siege button on a Moloch tribe or another player's Inferno yard: siege is for the overworld (owner)", () => {
    for (const extra of [{ infernoTribe: true }, { infernoPlayer: true }] as const) {
      mount(target({ decoy: { level: 1, quantity: 1 } }, extra));
      expect(hasSiegeTab()).toBe(false);
      // An Inferno yard offers no Catapult either: the Army alone.
      expect(tabNames()).toEqual(["Army"]);
      teardown?.();
      document.body.replaceChildren();
    }
    // The same stock on a surface yard shows it, named after the weapon.
    mount(target({ decoy: { level: 1, quantity: 1 } }));
    expect(hasSiegeTab()).toBe(true);
    expect(tabNames()).toEqual(["Army", "Catapult", "Decoy"]);
  });

  it("offers no Catapult in the Descent, as Flash's Inferno yard showed none (UI_TOP.as:296)", () => {
    mount(target(null, { descentYard: 1 }));
    expect(hasButton("Catapult")).toBe(false);
    expect(tabNames()).toEqual(["Army"]);
  });

  it("offers the first weapon in stock, and Fire arms the Decoy until a tap or Cancel", () => {
    mount(target({ vacuum: { level: 1, quantity: 0 }, decoy: { level: 2, quantity: 1 } }));
    button("Decoy").click();
    expect(open()).toEqual(["siege"]);
    expect(dock.querySelector(".attack-siege")!.getAttribute("data-weapon")).toBe("decoy");
    // The Catapult takes the dock's one picker slot.
    button("Catapult").click();
    expect(open()).toEqual(["catapult"]);
    button("Decoy").click();
    expect(open()).toEqual(["siege"]);

    expect(session.state().unusedTools).toBeGreaterThanOrEqual(1);
    fire().click();
    expect(fire().textContent).toBe("Cancel");
    expect(button("Decoy").classList.contains("attack-tools__button--armed")).toBe(true);
    fire().click();
    expect(fire().textContent).toBe("Fire");
    expect(session.state().eventCount).toBe(0);
  });

  it("fires the Vacuum with no tap, once, onto the Town Hall", () => {
    const yard = load({
      "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 1, X: 100, Y: 100 },
    });
    mount(target({ vacuum: { level: 1, quantity: 1 }, jars: { level: 1, quantity: 1 } }, {}, yard));
    const before = session.state().unusedTools;
    button("Vacuum").click();
    expect(dock.querySelector(".attack-siege")!.getAttribute("data-weapon")).toBe("vacuum");
    expect(fire().disabled).toBe(false);
    fire().click();
    expect(session.state().eventCount).toBe(1);
    expect(session.battle()!.siege().active).toBe("vacuum");
    expect(fire().hidden).toBe(true);
    expect(dock.querySelector(".attack-siege__time")!.textContent).toMatch(/^\d+s$/);
    // One weapon per attack: the Jars behind it are not offered.
    expect(session.state().unusedTools).toBe(before - 1);
  });

  it("greys the Vacuum when the yard has no Town Hall", () => {
    mount(target({ vacuum: { level: 1, quantity: 1 } }));
    button("Vacuum").click();
    expect(fire().disabled).toBe(true);
    fire().click();
    expect(session.state().eventCount).toBe(0);
  });
});
