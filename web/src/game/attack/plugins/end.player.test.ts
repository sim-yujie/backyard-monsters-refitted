// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackSavePayload, BaseLoadResponse, BaseSaveResponse } from "@/api/types";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import type { FlingLog } from "@/game/combat/rules";
import { checkpointOf } from "@/game/attack/attackCheckpoint";
import { RETURN_HOME } from "@/game/inferno/descentText";
import { INFERNO_YARD } from "@/game/yard/ownYards";
import { Notices } from "@/ui/maproom/Notices";
import { createEndPlugin, PLAYER_RESULT_TITLE } from "./end";

/**
 * The end of an attack on another player's Inferno yard (Inferno WP 3.5). It
 * counts once started (owner, 27 Oct), so it is saved even when nothing was
 * flung: End Attack then sends a final save whose fling log is there, with no
 * fling in it, which the server lands with the army kept. A save never sent
 * would leave the server to close the attack, and past 10 seconds with no
 * battle to fight it counts the whole army as used.
 */

const playerYard = (): BaseLoadResponse =>
  ({
    error: 0,
    baseid: "5005",
    basesaveid: 7007,
    type: "inferno",
    buildingdata: { "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 1000, r3: 0, r4: 0 },
    attackid: 88,
  }) as unknown as BaseLoadResponse;

const playerTarget = (): AttackTarget => ({
  baseid: "5005",
  kind: "main",
  name: "Bob",
  owner: 42,
  roster: {
    monsters: { IC1: 3 },
    levels: {},
    champions: [],
    flingerLevel: 1,
    flingCapacity: 120,
    catapultLevel: 0,
    sources: [{ baseid: "9001", m: { housed: { IC1: 3 } } as never }],
    siege: null,
    resources: { r1: 50, r2: 60, r3: 0, r4: 0 },
  },
  load: playerYard(),
  infernoPlayer: true,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const landed = {
  error: 0,
  basesaveid: 7007,
  player: {
    damage: 0,
    loot: { r1: 0, r2: 0, r3: 0, r4: 0 },
    lootcredited: { r1: 0, r2: 0, r3: 0, r4: 0 },
    total: { r1: 50, r2: 60, r3: 0, r4: 0 },
    housedlost: {},
  },
};

describe("an Inferno player attack's end", () => {
  let modal: HTMLElement;
  let notices: Notices;
  let goToOutpost: ReturnType<typeof vi.fn>;
  let showResources: ReturnType<typeof vi.fn>;
  let teardown: (() => void) | void;

  beforeEach(() => {
    modal = document.createElement("div");
    document.body.append(modal);
    notices = new Notices().mount(document.body);
    goToOutpost = vi.fn();
    showResources = vi.fn();
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    notices.destroy();
    modal.remove();
  });

  const mount = (response: unknown = landed) => {
    const target = playerTarget();
    const session = new AttackSession({ target, seed: 3 });
    session.start();
    const save = vi.fn(async (_payload: AttackSavePayload) => response as BaseSaveResponse);
    const saveOnLeave = vi.fn(async (_payload: AttackSavePayload) => response as BaseSaveResponse);
    teardown = createEndPlugin({ save, saveOnLeave, now: () => 0 })({
      session,
      target,
      modal,
      notices,
      goToMap: vi.fn(),
      goToOutpost,
      showResources,
      presentation: new AttackPresentation(),
      creditLoot: vi.fn(),
    } as unknown as AttackMounts);
    return { session, save, saveOnLeave };
  };

  it("End Attack with nothing flung still sends the final save, its fling log there with no fling in it", async () => {
    const { session, save } = mount();
    expect(session.hasActed()).toBe(false);
    session.retreat();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    const payload = save.mock.calls[0]![0];
    expect(payload).toMatchObject({ baseid: "5005", basesaveid: 7007, attackid: 88, over: true });
    // Present, a whole log, and not one fling in it: the server lands it with the army kept.
    expect(payload.flinglog).toMatchObject({ v: 1, seed: 3 });
    expect((payload.flinglog as FlingLog).events.filter((event) => event.kind === "fling")).toEqual([]);
    expect(payload.monsterupdate).toEqual([{ baseid: "9001", m: { housed: { IC1: 3 } } }]);
    expect(modal.querySelector(".attack-end__status--unsent")).toBeNull();
    expect(modal.querySelector(".panel__title")?.textContent).toBe(PLAYER_RESULT_TITLE);
    expect(modal.querySelector(".attack-end__outcome")?.textContent).toBe("0% damage dealt to Bob's yard.");
  });

  it("leaving the screen before anything was flung sends it as the page goes", async () => {
    const { session, save, saveOnLeave } = mount();
    teardown?.();
    teardown = undefined;
    await flush();
    expect(session.state()).toMatchObject({ phase: "ended", endReason: "left" });
    expect(save).not.toHaveBeenCalled();
    expect(saveOnLeave).toHaveBeenCalledTimes(1);
    const payload = saveOnLeave.mock.calls[0]![0];
    expect(payload).toMatchObject({ over: true, left: true, basesaveid: 7007 });
    expect((payload.flinglog as FlingLog).events).toEqual([]);
  });

  it("the server's landing: its damage, the purse on the HUD, and Return Home to the Inferno yard", async () => {
    const { session } = mount({
      ...landed,
      player: { ...landed.player, damage: 55, total: { r1: 900, r2: 60, r3: 0, r4: 0 } },
    });
    session.appendFling({ x: -100, y: -100, monsters: { IC1: 1 } });
    session.retreat();
    await flush();
    expect(modal.querySelector(".attack-end__outcome")?.textContent).toBe("Heavy damage: 55% of Bob's yard.");
    expect(showResources).toHaveBeenCalledWith({ r1: 900, r2: 60, r3: 0, r4: 0 });
    const home = [...modal.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === RETURN_HOME)!;
    home.click();
    expect(goToOutpost).toHaveBeenCalledWith(INFERNO_YARD);
  });

  it("its checkpoints name the yard's basesaveid, so the server can close it from the last one", () => {
    const { session } = mount();
    session.appendFling({ x: -100, y: -100, monsters: { IC1: 1 } });
    expect(checkpointOf(session)).toMatchObject({ basesaveid: 7007, attackid: 88, sources: ["9001"] });
  });
});
