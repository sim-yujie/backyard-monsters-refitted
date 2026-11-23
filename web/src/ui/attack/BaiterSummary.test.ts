// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { AttackSessionState } from "@/game/attack/AttackSession";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import type { BaseLoadResponse } from "@/api/types";
import { BaiterDock } from "./BaiterSummary";

/** The Baiter scene's dock line: its running count, and what it says once the test is over (#308). */

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

  it("is a line with no title plate, saying how to start until the first drop", () => {
    const dock = mount();
    expect(dock.element.querySelector(".panel__title, .panel__titlebar")).toBeNull();
    expect(dock.element.querySelector(".baiter-dock__army")!.textContent).toBe("30 monsters. Tap the yard to drop them.");
    dock.update({ phase: "running", creepsAlive: 0, creepsKilled: 0, damagePercent: 1 } as AttackSessionState);
    expect(dock.element.querySelector<HTMLElement>(".baiter-dock__army")!.hidden).toBe(false);
    expect(dock.element.querySelector<HTMLElement>(".baiter__figures")!.hidden).toBe(true);
  });

  it("puts the running count in place of the army line once something is dropped", () => {
    const dock = mount();
    dock.update(stateOf("running"));
    expect(dock.element.querySelector<HTMLElement>(".baiter-dock__army")!.hidden).toBe(true);
    expect(dock.element.querySelector<HTMLElement>(".baiter__figures")!.hidden).toBe(false);
  });

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
