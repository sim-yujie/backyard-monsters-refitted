// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackSavePayload, BaseLoadResponse, BaseSaveResponse } from "@/api/types";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { buildAttackSave } from "@/game/attack/attackSave";
import { DESCENT_GLOATS, DESCENT_TAUNTS, DESCENT_WHIMPERS, RETURN_HOME } from "@/game/inferno/descentText";
import { INFERNO_YARD, MAIN_YARD } from "@/game/yard/ownYards";
import { Notices } from "@/ui/maproom/Notices";
import { descentPlugin } from "./descent";
import { createEndPlugin } from "./end";

/**
 * A Descent attack's end (Inferno WP 1.13): the save names the yard and
 * sends no `destroyed` (the server's Inferno yard derives none), Moloch's
 * word follows the server's landing (whimper, report, capture; or gloat),
 * and Return Home goes back to the main yard. His taunt opens the attack.
 */

const descentYard = (): BaseLoadResponse =>
  ({
    error: 0,
    baseid: "207",
    type: "inferno",
    buildingdata: { "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 1000, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const targetOf = (yard = 7): AttackTarget => ({
  baseid: String(200 + yard),
  kind: "wild",
  name: "Moloch",
  roster: { monsters: { C1: 3 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
  load: { ...descentYard(), baseid: String(200 + yard) } as BaseLoadResponse,
  descentYard: yard,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const buttonNamed = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll("button")].find((one) => one.textContent === label);

const landing = (won: boolean, captured = false) => ({
  error: 0,
  basesaveid: 0,
  descent: {
    won,
    damage: won ? 95 : 40,
    level: won ? 8 : 7,
    loot: { r1: 120, r2: 80, r3: 0, r4: 0 },
    total: { r1: 1120, r2: 580, r3: 10, r4: 0 },
    captured,
  },
});

describe("a Descent attack's end", () => {
  let modal: HTMLElement;
  let notices: Notices;
  let goToOutpost: ReturnType<typeof vi.fn>;
  let goToMap: ReturnType<typeof vi.fn>;
  let teardown: (() => void) | void;

  beforeEach(() => {
    modal = document.createElement("div");
    document.body.append(modal);
    notices = new Notices().mount(document.body);
    goToOutpost = vi.fn();
    goToMap = vi.fn();
  });

  afterEach(() => {
    teardown?.();
    notices.destroy();
    modal.remove();
  });

  const run = async (target: AttackTarget, response: unknown) => {
    const session = new AttackSession({ target, seed: 1 });
    session.start();
    const save = vi.fn(async (_payload: AttackSavePayload) => response as BaseSaveResponse);
    teardown = createEndPlugin({ save, saveOnLeave: save, now: () => 0 })({
      session,
      target,
      modal,
      notices,
      goToMap,
      goToOutpost,
      presentation: new AttackPresentation(),
      creditLoot: () => {},
    } as unknown as AttackMounts);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    session.retreat();
    await flush();
    return { save, session };
  };

  it("fights as an Inferno yard and saves no destroyed flag", () => {
    const session = new AttackSession({ target: targetOf(), seed: 1 });
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    const payload = buildAttackSave(session);
    expect(payload.baseid).toBe("207");
    expect(payload.destroyed).toBeUndefined();
  });

  it("a beaten yard: whimper, then the report with the running total, then home", async () => {
    const { save } = await run(targetOf(7), landing(true));
    expect(save).toHaveBeenCalledTimes(1);
    expect(modal.textContent).toContain(DESCENT_WHIMPERS[6]!.moloch);
    buttonNamed(modal, DESCENT_WHIMPERS[6]!.reply)!.click();
    await flush();
    expect(modal.textContent).toContain("You just looted one of Moloch's bases for  120 Bone, 80 Coal, 0 Sulfur, and 0 Magma.");
    const values = [...modal.querySelectorAll(".descent-report__value")].map((one) => one.textContent);
    expect(values).toEqual(["1,120", "580", "10", "0"]);
    buttonNamed(modal, "Close")!.click();
    await flush();
    expect(modal.querySelector(".descent-capture")).toBeNull();
    const home = modal.querySelector<HTMLButtonElement>(".attack-end__return")!;
    expect(home.textContent).toBe(RETURN_HOME);
    home.click();
    expect(goToOutpost).toHaveBeenCalledWith(MAIN_YARD);
    expect(goToMap).not.toHaveBeenCalled();
  });

  it("a lost attack: Moloch gloats", async () => {
    await run(targetOf(3), landing(false));
    expect(modal.textContent).toContain(DESCENT_GLOATS[2]!.moloch);
    buttonNamed(modal, DESCENT_GLOATS[2]!.reply)!.click();
    await flush();
    expect(modal.querySelector(".descent-report")).toBeNull();
  });

  it("the 13th win: the capture's Start Building! opens the Inferno yard", async () => {
    await run(targetOf(13), landing(true, true));
    buttonNamed(modal, DESCENT_WHIMPERS[12]!.reply)!.click();
    await flush();
    buttonNamed(modal, "Close")!.click();
    await flush();
    expect(modal.textContent).toContain("You Defeated Moloch!");
    buttonNamed(modal, "Start Building!")!.click();
    expect(goToOutpost).toHaveBeenCalledWith(INFERNO_YARD);
  });

  it("Moloch's taunt opens a Descent attack, and only a Descent attack", () => {
    const off = descentPlugin({ target: targetOf(4), modal } as unknown as AttackMounts);
    expect(modal.textContent).toContain(DESCENT_TAUNTS[3]!.moloch);
    expect(buttonNamed(modal, DESCENT_TAUNTS[3]!.reply)).toBeDefined();
    off?.();
    expect(modal.textContent).not.toContain(DESCENT_TAUNTS[3]!.moloch);
    const { descentYard: _, ...plain } = targetOf(4);
    expect(descentPlugin({ target: plain, modal } as unknown as AttackMounts)).toBeUndefined();
  });
});
