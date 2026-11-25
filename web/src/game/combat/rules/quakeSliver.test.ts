import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import { buildEngineYard } from "./yard.js";

/**
 * Player report (Reii, 25 Nov 2026, Inferno Moloch camp): a Zagnoid a Quake
 * Tower's quake should have killed lives on and keeps attacking.
 *
 * Flash keeps a monster's health whole: `GameObject.setHealth` stores it in a
 * `SecNum`, whose `Set` rounds it (`com/cc/utils/SecNum.as:27`). So the
 * quake's `int(health)` clamp (`INFERNOQUAKETOWER.as:177-179`) is the whole
 * health and a quake bigger than it kills. The engine keeps a fraction (a
 * trap's fall-off, `BTRAP.as:106`, leaves one), so the clamp leaves the
 * creep a sliver under 1 that no later quake can take.
 */
const yard = () =>
  buildEngineYard({
    buildingdata: {
      // A Quake Tower, a Booby Trap on the Zagnoid's way to it, and a harvester.
      "1": { id: 1, t: 129, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 100, Y: 100 },
      "3": { id: 3, t: 24, l: 1, X: 60, Y: 60 },
    },
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    kind: "inferno",
  });

describe("a quake bigger than a monster's health kills it (Flash keeps health whole)", () => {
  it("leaves no Zagnoid alive on a sliver under 1 health", () => {
    const battle = createBattle(yard(), { seed: 7 });
    battle.apply({ kind: "fling", t: 0, x: 110, y: 110, r: 0, monsters: { IC2: 1 } });
    // The trap takes 829.12 of its 1500; the quake's first blow is 783.
    let took = 0;
    let quaked = 0;
    let sliverTicks = 0;
    for (let step = 0; step < 3000 && !battle.over(); step += 1) {
      battle.step();
      for (const event of battle.recentEvents(battle.tick - 1)) {
        if (event.tick !== battle.tick) continue;
        if (event.kind === "towerQuake") quaked += 1;
        if (event.kind === "hurt" && !event.friendly) took += event.amount;
      }
      const alive = battle.state().creepsAlive > 0;
      if (alive && took > 1500 - 1) sliverTicks += 1;
    }
    expect(quaked).toBeGreaterThan(0);
    expect(took).toBeGreaterThan(0);
    expect(sliverTicks).toBe(0);
    expect(battle.state().creepsAlive).toBe(0);
  });
});
