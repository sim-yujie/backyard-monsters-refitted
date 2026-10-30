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
import { Notices } from "@/ui/maproom/Notices";
import { dropPlugin } from "./drop";

/**
 * The drop plugin's share of the dock (#59): one picker open at a time, so
 * the dock never stacks Army, Catapult and Siege on top of each other; and
 * Flash's one siege weapon per attack (Inferno WP 6.8).
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
  let session: AttackSession;
  let teardown: (() => void) | void;

  const button = (text: string): HTMLButtonElement => {
    const found = [...dock.querySelectorAll<HTMLButtonElement>(".attack-tools__button")].find(
      (candidate) => candidate.textContent === text,
    );
    if (!found) throw new Error(`no ${text} button`);
    return found;
  };
  const hasButton = (text: string): boolean =>
    [...document.querySelectorAll("button")].some((candidate) => candidate.textContent === text);
  const open = (): string[] =>
    [...dock.querySelectorAll(".attack-picker")].map((panel) =>
      panel.classList.contains("attack-catapult") ? "catapult" : "siege",
    );
  const fire = (): HTMLButtonElement => dock.querySelector<HTMLButtonElement>("[data-fire]")!;

  const mount = (attackTarget: AttackTarget): void => {
    sheet = document.createElement("div");
    sheet.className = "attack-dock";
    dock = document.createElement("div");
    sheet.append(dock);
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
      battleLayer: new Container(),
      notices: new Notices().mount(document.body),
      setBottomInset: () => {},
      showResources: () => {},
    } as unknown as AttackMounts;
    teardown = dropPlugin(mounts);
  };

  afterEach(() => {
    teardown?.();
    document.body.replaceChildren();
  });

  it("opens and closes the Catapult picker, and shows no Siege button with no weapon in stock", () => {
    mount(target(null));
    expect(hasButton("Siege")).toBe(false);
    button("Catapult").click();
    expect(open()).toEqual(["catapult"]);
    expect(button("Catapult").getAttribute("aria-expanded")).toBe("true");
    expect(sheet.classList.contains("attack-dock--picker")).toBe(true);

    button("Catapult").click();
    expect(open()).toEqual([]);
    expect(sheet.classList.contains("attack-dock--picker")).toBe(false);
  });

  it("keeps a pressed tool button still, so the press cannot make the dock scroll and lose the click (Brave)", () => {
    // The tool bar ends the dock's scrolling body. ui.css sinks a pressed
    // button 1px; there that 1px overflowed the body, a Windows scrollbar
    // narrowed it, the Army panel rewrapped and the button slid away before
    // the release. jsdom lays nothing out, so the rule that stops it is pinned.
    mount(target(null));
    expect(dock.lastElementChild?.classList.contains("attack-tools")).toBe(true);
    const styles = resolve(dirname(fileURLToPath(import.meta.url)), "../../../ui/styles");
    const ui = readFileSync(resolve(styles, "ui.css"), "utf8");
    expect(ui).toMatch(/\n\.btn:active:not\(:disabled\) \{\s*transform: translateY\(1px\);/);
    const attack = readFileSync(resolve(styles, "attack.css"), "utf8");
    expect(attack).toMatch(/\n\.btn\.attack-tools__button:active:not\(:disabled\) \{\s*transform: none;/);
  });

  it("offers no Siege button for a weapon with none left, nor in the Descent", () => {
    mount(target({ decoy: { level: 1, quantity: 0 } }));
    expect(hasButton("Siege")).toBe(false);
    teardown?.();
    document.body.replaceChildren();
    mount(target({ decoy: { level: 1, quantity: 1 } }, { descentYard: 1 }));
    expect(hasButton("Siege")).toBe(false);
  });

  it("offers no Siege button on a Moloch tribe or another player's Inferno yard: siege is for the overworld (owner)", () => {
    for (const extra of [{ infernoTribe: true }, { infernoPlayer: true }] as const) {
      mount(target({ decoy: { level: 1, quantity: 1 } }, extra));
      expect(hasButton("Siege")).toBe(false);
      teardown?.();
      document.body.replaceChildren();
    }
    // The same stock on a surface yard shows it.
    mount(target({ decoy: { level: 1, quantity: 1 } }));
    expect(hasButton("Siege")).toBe(true);
  });

  it("offers no Catapult in the Descent, as Flash's Inferno yard showed none (UI_TOP.as:296)", () => {
    mount(target(null, { descentYard: 1 }));
    expect(hasButton("Catapult")).toBe(false);
    expect(dock.querySelector(".attack-tools")).toBeNull();
  });

  it("offers the first weapon in stock, and Fire arms the Decoy until a tap or Cancel", () => {
    mount(target({ vacuum: { level: 1, quantity: 0 }, decoy: { level: 2, quantity: 1 } }));
    button("Siege").click();
    expect(open()).toEqual(["siege"]);
    expect(dock.querySelector(".attack-siege")!.getAttribute("data-weapon")).toBe("decoy");
    // The Catapult takes the dock's one picker slot.
    button("Catapult").click();
    expect(open()).toEqual(["catapult"]);
    button("Siege").click();
    expect(open()).toEqual(["siege"]);

    expect(session.state().unusedTools).toBeGreaterThanOrEqual(1);
    fire().click();
    expect(fire().textContent).toBe("Cancel");
    expect(button("Siege").classList.contains("attack-tools__button--armed")).toBe(true);
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
    button("Siege").click();
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
    button("Siege").click();
    expect(fire().disabled).toBe(true);
    fire().click();
    expect(session.state().eventCount).toBe(0);
  });
});
