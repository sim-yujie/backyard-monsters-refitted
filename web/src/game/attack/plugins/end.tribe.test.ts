// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackSavePayload, BaseLoadResponse, BaseSaveResponse } from "@/api/types";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { summariseAttack } from "@/game/attack/attackSave";
import { RETURN_HOME } from "@/game/inferno/descentText";
import { tribeOutcome } from "@/game/inferno/tribeMap";
import { INFERNO_YARD } from "@/game/yard/ownYards";
import { Notices } from "@/ui/maproom/Notices";
import { createEndPlugin } from "./end";

/**
 * A Moloch tribe attack's end (Inferno WP 2.10): Flash's words for the
 * result, from the Under Hall and then from the server's landing, when the
 * tribe is back, the Inferno purse after it on the HUD, and the two ways
 * out: Return to map (the Inferno map) and Return Home (the Inferno yard).
 */

const tribeYard = (): BaseLoadResponse =>
  ({
    error: 0,
    baseid: "214",
    type: "inferno",
    buildingdata: { "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 1000, r3: 0, r4: 0 },
    attackid: 91,
  }) as unknown as BaseLoadResponse;

const tribeTarget = (): AttackTarget => ({
  baseid: "214",
  kind: "wild",
  name: "Moloch's Minions",
  roster: {
    monsters: { IC1: 3 },
    levels: {},
    champions: [],
    flingerLevel: 1,
    flingCapacity: 120,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: { r1: 50, r2: 60, r3: 0, r4: 0 },
  },
  load: tribeYard(),
  infernoTribe: true,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const landing = (won: boolean) => ({
  error: 0,
  basesaveid: 0,
  tribe: {
    won,
    damage: won ? 100 : 30,
    loot: { r1: 900, r2: 80, r3: 0, r4: 0 },
    lootcredited: { r1: 400, r2: 80, r3: 0, r4: 0 },
    total: { r1: 2_000, r2: 1_080, r3: 0, r4: 0 },
    respawnat: won ? 3600 : 0,
  },
});

describe("a Moloch tribe attack's end", () => {
  let modal: HTMLElement;
  let notices: Notices;
  let goToOutpost: ReturnType<typeof vi.fn>;
  let goToMap: ReturnType<typeof vi.fn>;
  let showResources: ReturnType<typeof vi.fn>;
  let teardown: (() => void) | void;

  beforeEach(() => {
    modal = document.createElement("div");
    document.body.append(modal);
    notices = new Notices().mount(document.body);
    goToOutpost = vi.fn();
    goToMap = vi.fn();
    showResources = vi.fn();
  });

  afterEach(() => {
    teardown?.();
    notices.destroy();
    modal.remove();
  });

  const run = async (response: unknown) => {
    const target = tribeTarget();
    const session = new AttackSession({ target, seed: 1 });
    session.start();
    const save = vi.fn(async (_payload: AttackSavePayload) => response as BaseSaveResponse);
    const creditLoot = vi.fn();
    teardown = createEndPlugin({ save, saveOnLeave: save, now: () => 0 })({
      session,
      target,
      modal,
      notices,
      goToMap,
      goToOutpost,
      showResources,
      presentation: new AttackPresentation(),
      creditLoot,
    } as unknown as AttackMounts);
    session.appendFling({ x: -100, y: -100, monsters: { IC1: 1 } });
    session.retreat();
    await flush();
    return { save, session, creditLoot };
  };

  const title = (): string | null | undefined => modal.querySelector(".panel__title")?.textContent;

  it("is summed up as a tribe, lost while its Under Hall stands", () => {
    const session = new AttackSession({ target: tribeTarget(), seed: 1 });
    session.start();
    const summary = summariseAttack(session);
    expect(summary.infernoTribe).toBe(true);
    expect(summary.inferno).toBe(true);
    expect(summary).toMatchObject(tribeOutcome(false));
  });

  it("a fallen Under Hall: Base Destroyed!, the comeback, the purse on the HUD", async () => {
    const { save, creditLoot } = await run(landing(true));
    expect(save).toHaveBeenCalledTimes(1);
    expect(title()).toBe("Base Destroyed!");
    expect(modal.querySelector(".attack-end__outcome")?.textContent).toBe(tribeOutcome(true).outcome);
    const back = modal.querySelector<HTMLElement>(".attack-end__protection")!;
    expect(back.hidden).toBe(false);
    expect(back.textContent).toBe("Moloch's Minions will be back in 1 h.");
    const items = [...modal.querySelectorAll<HTMLElement>(".attack-end__loot-item")];
    expect(items.map((item) => item.title)).toEqual([
      "Bone: 400 gained of 900 taken; the rest did not fit in your storage",
      "Coal: 80 gained",
      "Sulfur: 0",
      "Magma: 0",
    ]);
    expect(modal.querySelector(".attack-end__storage")?.textContent).toBe(
      "Your Inferno storage was full, so some loot was lost.",
    );
    expect(showResources).toHaveBeenCalledTimes(1);
    expect(showResources).toHaveBeenCalledWith({ r1: 2_000, r2: 1_080, r3: 0, r4: 0 });
    // The main yard's pool is not the one that took it.
    expect(creditLoot).not.toHaveBeenCalled();
  });

  it("a standing Under Hall: Attack Ended, and no comeback", async () => {
    await run(landing(false));
    expect(title()).toBe("Attack Ended");
    expect(modal.querySelector(".attack-end__outcome")?.textContent).toBe(tribeOutcome(false).outcome);
    expect(modal.querySelector<HTMLElement>(".attack-end__protection")!.hidden).toBe(true);
  });

  it("Return to map opens the Inferno map", async () => {
    await run(landing(true));
    const toMap = modal.querySelector<HTMLButtonElement>(".attack-end__return")!;
    expect(toMap.textContent).toBe("Return to map");
    toMap.click();
    expect(goToMap).toHaveBeenCalledTimes(1);
    expect(goToOutpost).not.toHaveBeenCalled();
  });

  it("Return Home opens the Inferno yard", async () => {
    await run(landing(true));
    const home = modal.querySelector<HTMLButtonElement>(".attack-end__home")!;
    expect(home.textContent).toBe(RETURN_HOME);
    home.click();
    expect(goToOutpost).toHaveBeenCalledWith(INFERNO_YARD);
    expect(goToMap).not.toHaveBeenCalled();
  });

  it("an answer without the tribe block keeps the battle's own result", async () => {
    await run({ error: 0, basesaveid: 0 });
    expect(title()).toBe("Attack Ended");
    expect(showResources).not.toHaveBeenCalled();
  });
});
