// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { AttackSessionState } from "@/game/attack/AttackSession";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import type { BaseLoadResponse } from "@/api/types";
import { BaiterDock } from "./BaiterSummary";

/** The Baiter scene's dock panel: its running count, and what it says once the test is over (#308). */

const RUN: BaiterRun = {
  save: {} as BaseLoadResponse,
  army: { monsters: { C1: { count: 30, level: 6 } }, champions: [] },
  baiterLevel: 1,
};

const stateOf = (phase: AttackSessionState["phase"]): AttackSessionState =>
  ({ phase, creepsAlive: 21, creepsKilled: 9, damagePercent: 31.6 }) as AttackSessionState;

describe("BaiterDock", () => {
  const docks: BaiterDock[] = [];
  afterEach(() => {
    for (const dock of docks.splice(0)) dock.destroy();
    document.body.replaceChildren();
  });

  const mount = (): BaiterDock => {
    const dock = new BaiterDock(RUN).mount(document.body);
    docks.push(dock);
    return dock;
  };

  it("counts what is attacking while the test runs", () => {
    const dock = mount();
    dock.update(stateOf("running"));
    expect(dock.element.querySelector(".baiter__figures")!.textContent).toBe("21 attacking · 9 beaten · 31% damage");
  });

  it("says it is over rather than counting attackers it has put to rest", () => {
    const dock = mount();
    dock.update(stateOf("ended"));
    expect(dock.element.querySelector(".baiter__figures")!.textContent).toBe("Over · 9 beaten · 31% damage");
  });
});
