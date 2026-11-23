// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { AttackSessionState } from "@/game/attack/AttackSession";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import type { BaseLoadResponse } from "@/api/types";
import { BaiterDock, baiterNote } from "./BaiterSummary";

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

  it("is a bar with no title plate, holding the note until the first drop", () => {
    const dock = mount();
    expect(dock.element.querySelector(".panel__title, .panel__titlebar")).toBeNull();
    expect(dock.element.querySelector(".baiter-dock__note")!.textContent).toBe(baiterNote(RUN));
    dock.update({ phase: "running", creepsAlive: 0, creepsKilled: 0, damagePercent: 1 } as AttackSessionState);
    expect(dock.element.classList.contains("baiter-dock--started")).toBe(false);
    expect(dock.element.querySelector<HTMLElement>(".baiter__figures")!.hidden).toBe(true);
  });

  it("keeps the running count once something is dropped", () => {
    const dock = mount();
    dock.update(stateOf("running"));
    expect(dock.element.classList.contains("baiter-dock--started")).toBe(true);
    expect(dock.element.querySelector<HTMLElement>(".baiter__figures")!.hidden).toBe(false);
  });

  it("words the test's note for the notice, not the dock", () => {
    expect(baiterNote(RUN)).toBe("Test attack: nothing is saved. Your yard, its traps and your resources stay as they are.");
    expect(baiterNote(RUN, true)).toBe("Replay of a test, on your yard as it was then. Nothing is saved.");
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
