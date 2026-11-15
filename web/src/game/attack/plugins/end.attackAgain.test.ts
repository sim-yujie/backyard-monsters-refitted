// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackSavePayload, BaseLoadResponse, BaseSaveResponse } from "@/api/types";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { consumeMapFocus } from "@/game/maproom/mapFocus";
import type { AutoAttackFlowOptions } from "@/ui/attack/AutoAttackFlow";
import { Notices } from "@/ui/maproom/Notices";
import { createEndPlugin, type TakeoverCalls } from "./end";

/**
 * Attack again on the end panel after a hand-fought Map Room 2 camp attack
 * (#221) runs the same server attack as the map's Repeat attack, so it shows
 * the same army bar (owner, 15 Nov 2026).
 */

const flows = vi.hoisted(() => [] as { options: AutoAttackFlowOptions; start: ReturnType<typeof vi.fn> }[]);

vi.mock("@/ui/attack/AutoAttackFlow", () => ({
  AutoAttackFlow: class {
    readonly start = vi.fn(async () => {});
    readonly close = vi.fn();
    constructor(options: AutoAttackFlowOptions) {
      flows.push({ options, start: this.start });
    }
  },
}));

const camp = (): AttackTarget => ({
  baseid: "2000241208",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: { monsters: { C1: 3 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
  load: {
    error: 0,
    id: 1,
    baseid: "2000241208",
    basesaveid: 900,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  } as unknown as BaseLoadResponse,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("Attack again on the end panel", () => {
  let modal: HTMLElement;
  let notices: Notices;
  let teardown: (() => void) | void;

  beforeEach(() => {
    vi.useFakeTimers();
    flows.length = 0;
    modal = document.createElement("div");
    document.body.append(modal);
    notices = new Notices().mount(document.body);
    consumeMapFocus();
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    notices.destroy();
    modal.remove();
    vi.useRealTimers();
  });

  it("opens the repeat flow with the army bar on", async () => {
    const session = new AttackSession({ target: camp(), seed: 1 });
    session.start();
    const save = vi.fn(async (_payload: AttackSavePayload) => ({ error: 0, basesaveid: 900 }) as BaseSaveResponse);
    const takeover = { quote: vi.fn(), takeOver: vi.fn(), decline: vi.fn() } as unknown as TakeoverCalls;
    teardown = createEndPlugin({ save, now: () => 1_000_000_000, takeover })({
      session,
      target: session.target,
      modal,
      notices,
      goToMap: vi.fn(),
      goToOutpost: vi.fn(),
      presentation: new AttackPresentation(),
    } as unknown as AttackMounts);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    session.retreat();
    await flush();

    const again = modal.querySelector<HTMLButtonElement>(".attack-end__again");
    expect(again).not.toBeNull();
    expect(again!.hidden).toBe(false);
    again!.click();

    expect(flows).toHaveLength(1);
    expect(flows[0]!.options.baseid).toBe("2000241208");
    expect(flows[0]!.options.progressBar).toBe(true);
    expect(flows[0]!.start).toHaveBeenCalledTimes(1);
  });
});
