// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { readYard } from "@/game/yard/yardModel";
import { Notices } from "@/ui/maproom/Notices";
import { dropPlugin } from "./drop";

/**
 * The drop plugin's share of the dock (#59): one picker open at a time, and
 * a picker opening closes the enemy building's info, so the dock never
 * stacks Army, info, Catapult and Siege on top of each other.
 */

const load = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const target = (): AttackTarget => ({
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
    siege: null,
    resources: { r1: 50_000, r2: 50_000, r3: 50_000, r4: 50_000 },
    credits: 0,
  },
  load: load(),
});

describe("the drop plugin's pickers in the dock", () => {
  let sheet: HTMLElement;
  let dock: HTMLElement;
  let closeBuildingInfo: ReturnType<typeof vi.fn>;
  let teardown: (() => void) | void;

  const button = (text: string): HTMLButtonElement => {
    const found = [...dock.querySelectorAll<HTMLButtonElement>(".attack-tools__button")].find(
      (candidate) => candidate.textContent === text,
    );
    if (!found) throw new Error(`no ${text} button`);
    return found;
  };
  const open = (): string[] =>
    [...dock.querySelectorAll(".attack-picker")].map((panel) =>
      panel.classList.contains("attack-catapult") ? "catapult" : "siege",
    );

  beforeEach(() => {
    sheet = document.createElement("div");
    sheet.className = "attack-dock";
    dock = document.createElement("div");
    sheet.append(dock);
    document.body.append(sheet);
    closeBuildingInfo = vi.fn();
    const session = new AttackSession({ target: target(), seed: 1 });
    const mounts = {
      session,
      target: session.target,
      yard: readYard(load(), { foreign: true }),
      renderer: { yardToWorld: (x: number, y: number) => ({ x, y }), worldToYard: (x: number, y: number) => ({ x, y }) },
      camera: { screenToWorld: (point: { x: number; y: number }) => point },
      canvas: document.createElement("canvas"),
      dock,
      battleLayer: new Container(),
      notices: new Notices().mount(document.body),
      setBottomInset: () => {},
      showResources: () => {},
      closeBuildingInfo,
    } as unknown as AttackMounts;
    teardown = dropPlugin(mounts);
  });

  afterEach(() => {
    teardown?.();
    document.body.replaceChildren();
  });

  it("opens one picker at a time: Siege closes the Catapult and back", () => {
    button("Catapult").click();
    expect(open()).toEqual(["catapult"]);
    expect(button("Catapult").getAttribute("aria-expanded")).toBe("true");

    button("Siege").click();
    expect(open()).toEqual(["siege"]);
    expect(button("Catapult").getAttribute("aria-expanded")).toBe("false");
    expect(button("Siege").getAttribute("aria-expanded")).toBe("true");
    expect(sheet.classList.contains("attack-dock--picker")).toBe(true);

    button("Catapult").click();
    expect(open()).toEqual(["catapult"]);

    button("Catapult").click();
    expect(open()).toEqual([]);
    expect(sheet.classList.contains("attack-dock--picker")).toBe(false);
  });

  it("closes the enemy building's info when a picker opens", () => {
    button("Catapult").click();
    expect(closeBuildingInfo).toHaveBeenCalledTimes(1);
    button("Siege").click();
    expect(closeBuildingInfo).toHaveBeenCalledTimes(2);
    // Closing a picker leaves the info alone: there is none open by then.
    button("Siege").click();
    expect(closeBuildingInfo).toHaveBeenCalledTimes(2);
  });
});
