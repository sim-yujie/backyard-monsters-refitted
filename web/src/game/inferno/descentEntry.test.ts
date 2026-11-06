// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DescentAttackStart, InfernoState } from "@/api/inferno";
import type { BaseLoadResponse } from "@/api/types";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { combatKind } from "@/game/attack/AttackSession";
import type { Yard } from "@/game/yard/yardModel";
import { nextDescentYard } from "@/ui/inferno/DescentScreens";
import { descentFlingerLevel, enterDescent, type DescentEntryDeps } from "./descentEntry";
import { NO_MONSTERS, depthPercent, depthWarning, descentYardArt, lineFor, DESCENT_TAUNTS } from "./descentText";

/**
 * Enter Cavern before the Descent is won (Inferno WP 1.13): Flash's map of
 * Moloch's 13 yards, only the next one open to attack, and its Attack
 * starting the server's Descent attack and handing the attack scene a
 * target that carries the start's yard number (the burn from yard 7).
 */

const stateOf = (beaten: number, passed = false): InfernoState => ({
  now: 1,
  cave: { shown: true, level: 5, maxLevel: 5 },
  emergence: { lastAt: 1, nextAt: null, done: true },
  descent: {
    level: beaten + 1,
    destroyed: Array.from({ length: 13 }, (_, index) => (index < beaten ? 1 : 0)),
    passed,
  },
  hasYard: passed,
  korathNotice: false,
});

const startOf = (yard: number): DescentAttackStart => ({
  error: 0,
  kind: "descent",
  yardkind: "inferno",
  attackid: 55,
  descentyard: yard,
  level: yard,
  base: { baseid: String(200 + yard), type: "iwm", buildingdata: {} } as Partial<BaseLoadResponse>,
  defenderforces: { bunkers: [] },
  attackeracademy: {},
  attpowerups: [],
  flingercapacity: 120,
});

const ownSave = (housed: Record<string, number>): BaseLoadResponse =>
  ({ baseid: "1234", monsters: { housed }, champion: [], academy: {} }) as unknown as BaseLoadResponse;
const ownYard = { buildings: [{ type: 5, level: 3 }, { type: 5, level: 0 }, { type: 14, level: 6 }] } as unknown as Yard;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

describe("the Descent's words and numbers", () => {
  it("follows Flash's depth bar, yard pictures and lines", () => {
    expect(depthWarning(8)).toBe("");
    expect(depthWarning(9)).toBe("Caution");
    expect(depthWarning(12)).toBe("Warning");
    // Flash's yard 13 falls through to no word (`DescentBasePopup.setDepth`).
    expect(depthWarning(13)).toBe("");
    expect(depthPercent(13)).toBe(100);
    expect([1, 2, 3, 12, 13].map(descentYardArt)).toEqual([1, 1, 2, 6, 7]);
    expect(lineFor(DESCENT_TAUNTS, 13).reply).toBe("Just watch me!");
    expect(lineFor(DESCENT_TAUNTS, 99)).toBe(DESCENT_TAUNTS[12]);
  });

  it("finds the next yard and the main Flinger's level", () => {
    expect(nextDescentYard(stateOf(0).descent)).toBe(1);
    expect(nextDescentYard(stateOf(6).descent)).toBe(7);
    expect(nextDescentYard(stateOf(13).descent)).toBeNull();
    expect(descentFlingerLevel(ownYard)).toBe(3);
  });

  it("fights a Descent target as an Inferno yard", () => {
    expect(combatKind({ kind: "wild", descentYard: 7 })).toBe("inferno");
    expect(combatKind({ kind: "wild", mapversion: 1 })).toBe("tribe");
  });
});

describe("enterDescent", () => {
  let modal: HTMLElement;
  let deps: DescentEntryDeps & { notice: ReturnType<typeof vi.fn>; openAttack: ReturnType<typeof vi.fn>; openInferno: ReturnType<typeof vi.fn> };
  let state: InfernoState;
  let start: ReturnType<typeof vi.fn>;
  let housed: Record<string, number>;

  beforeEach(() => {
    modal = document.createElement("div");
    document.body.append(modal);
    state = stateOf(6);
    housed = { C1: 10 };
    start = vi.fn(async (baseid: string) => startOf(Number(baseid) - 200));
    deps = {
      modal,
      own: () => ({ save: ownSave(housed), yard: ownYard }),
      notice: vi.fn(),
      openInferno: vi.fn(),
      openAttack: vi.fn(),
      api: { state: async () => state, start },
    };
  });

  afterEach(() => {
    modal.remove();
  });

  it("goes down to the Inferno yard once the Descent is passed", async () => {
    state = stateOf(13, true);
    expect(await enterDescent(deps)).toBeNull();
    expect(deps.openInferno).toHaveBeenCalledTimes(1);
  });

  it("shows the unbeaten yards, only the next one open, and fog below it", async () => {
    await enterDescent(deps);
    const markers = [...modal.querySelectorAll<HTMLButtonElement>(".descent-yard")];
    // The six beaten yards are gone from the map, as in Flash.
    expect(markers.map((one) => one.dataset["yard"])).toEqual(["7", "8", "9", "10", "11", "12", "13"]);
    expect(markers.filter((one) => !one.disabled).map((one) => one.dataset["yard"])).toEqual(["7"]);
    expect(modal.querySelector(".descent-map__fog")).not.toBeNull();
    expect(modal.textContent).toContain("Return Home");
  });

  it("Attack on the next yard starts the Descent attack and hands the scene its yard", async () => {
    await enterDescent(deps);
    modal.querySelector<HTMLButtonElement>(".descent-yard--next")!.click();
    expect(modal.textContent).toContain("Depth");
    modal.querySelector<HTMLButtonElement>(".descent-card__attack")!.click();
    await settle();
    expect(start).toHaveBeenCalledWith("207");
    expect(deps.openAttack).toHaveBeenCalledTimes(1);
    const target = deps.openAttack.mock.calls[0]![0] as AttackTarget;
    expect(target).toMatchObject({ baseid: "207", kind: "wild", name: "Moloch", descentYard: 7 });
    expect(target.load).toMatchObject({ baseid: "207", type: "inferno", attackid: 55, defenderforces: { bunkers: [] } });
    expect(target.roster.monsters).toEqual({ C1: 10 });
    expect(target.roster.flingerLevel).toBe(3);
    // Each fling carries what the server's replay lets it (`descentFightableLog`).
    expect(target.roster.flingCapacity).toBe(120);
    expect(target.roster.storageCap).toBeNull();
    // The map is gone.
    expect(modal.querySelector(".descent-map")).toBeNull();
  });

  it("says so and goes nowhere with nothing housed", async () => {
    housed = {};
    await enterDescent(deps);
    modal.querySelector<HTMLButtonElement>(".descent-yard--next")!.click();
    modal.querySelector<HTMLButtonElement>(".descent-card__attack")!.click();
    await settle();
    expect(deps.notice).toHaveBeenCalledWith(NO_MONSTERS);
    expect(start).not.toHaveBeenCalled();
    expect(modal.querySelector<HTMLButtonElement>(".descent-card__attack")!.disabled).toBe(false);
  });

  it("keeps the map open when the start is refused", async () => {
    start.mockRejectedValueOnce(new Error("409"));
    await enterDescent(deps);
    modal.querySelector<HTMLButtonElement>(".descent-yard--next")!.click();
    modal.querySelector<HTMLButtonElement>(".descent-card__attack")!.click();
    await settle();
    expect(deps.notice).toHaveBeenCalledTimes(1);
    expect(deps.openAttack).not.toHaveBeenCalled();
    expect(modal.querySelector(".descent-map")).not.toBeNull();
  });
});
