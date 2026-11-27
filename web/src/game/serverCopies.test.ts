import { describe, expect, it } from "vitest";

import { ATTACK_CHAMPION_PROPS, ATTACK_MONSTER_PROPS } from "./attack/attackStats";
import { ATTACK_STATS_STAMP, attackStatsVersionOf } from "./attack/attackStatsVersion";
import * as webCosts from "./yard/buildingCostData";
import { INFERNO_REPAIR_TIMES, REPAIR_CAP_SECONDS, REPAIR_TIMES } from "./yard/repairTimeData";
import { STARTER_KIT_SUMMARIES } from "./yard/starterKitData";

import * as serverCosts from "../../../server/src/game-data/buildingCosts";
import * as serverRepair from "../../../server/src/game-data/repairTimes";
import { STARTER_KITS } from "../../../server/src/game-data/starterKits";
import { championStats } from "../../../server/src/game-data/stats/championStats";
import { monsterStats } from "../../../server/src/game-data/stats/monsterStats";
import {
  ATTACK_STATS_VERSION,
  attackStatsVersionOf as serverStatsVersionOf,
} from "../../../server/src/game-data/stats/attackStatsVersion";

/**
 * Drift checks for the tables the web keeps a copy of (beta 9 audit, 21 Nov
 * 2026). Each pair is written by one generator, or by hand from the server's
 * file, and must hold the same rows: the server charges, heals and checks by
 * its copy while the player is shown the web's, so a copy that drifts shows a
 * price, a repair time or a kit that is not what happens, and a stale attack
 * stat block is refused by the attack gate (`validateAttack.ts`).
 *
 * The combat, Map Room 2 and account rules folders have their own byte-for-byte
 * checks (each folder's `sync.test.ts` and `tools/sync-combat-rules.mjs --check`), and
 * the monster and champion catalogues theirs (`monsterCatalogue.test.ts`,
 * `championCatalogue.test.ts`). A failure here means a table was regenerated
 * on one side only: run the generator named in the web file's header, never
 * edit one copy by hand.
 */

/** Every export the two modules share that is data, not a function or a type. */
const sharedData = (web: Record<string, unknown>, server: Record<string, unknown>): string[] =>
  Object.keys(web)
    .filter((name) => name in server && typeof web[name] !== "function")
    .sort();

describe("the web's copies of server tables", () => {
  it("building costs: every table both files export holds the same rows (gen-building-costs.mjs)", () => {
    const names = sharedData(webCosts, serverCosts);
    expect(names).toContain("BUILDING_COST_ROWS");
    expect(names).toContain("OUTPOST_COST_ROWS");
    for (const name of names) {
      expect((webCosts as Record<string, unknown>)[name], name).toEqual((serverCosts as Record<string, unknown>)[name]);
    }
  });

  it("repair times match (gen-repair-times.mjs)", () => {
    expect(REPAIR_TIMES).toEqual(serverRepair.REPAIR_TIMES);
    expect(INFERNO_REPAIR_TIMES).toEqual(serverRepair.INFERNO_REPAIR_TIMES);
    expect(REPAIR_CAP_SECONDS).toBe(serverRepair.REPAIR_CAP_SECONDS);
  });

  it("the attack load's stat blocks are the server's monster and champion props (attackStats.ts)", () => {
    expect(Object.keys(ATTACK_MONSTER_PROPS).sort()).toEqual(Object.keys(monsterStats).sort());
    for (const [id, stat] of Object.entries(monsterStats)) {
      expect(ATTACK_MONSTER_PROPS[id], id).toEqual(stat.props);
    }
    expect(Object.keys(ATTACK_CHAMPION_PROPS).sort()).toEqual(Object.keys(championStats).sort());
    for (const [id, stat] of Object.entries(championStats)) {
      expect(ATTACK_CHAMPION_PROPS[id], id).toEqual({ t: stat.t, props: stat.props });
    }
  });

  it("the page's attack-stats stamp is the server's (attackStatsVersion.ts, beta 10)", () => {
    // A page that stamps another table than the server's is refused with "New version" on every attack.
    expect(ATTACK_STATS_STAMP).toBe(ATTACK_STATS_VERSION);
    // The two copies of the hash agree on any table, not only on today's.
    const sample = {
      monsters: { C9: { hTime: [1.5, 2], cResource: [10] }, C1: { speed: [1] } },
      champions: { G2: { t: 2, props: { movement: ["ground"], feedCount: [3, 6] } } },
    };
    expect(attackStatsVersionOf(sample)).toBe(serverStatsVersionOf(sample));
  });

  it("the Starter Kit picker shows each kit's real name, price and buildings (gen-starter-kits.mjs)", () => {
    expect(STARTER_KIT_SUMMARIES.map((kit) => kit.id)).toEqual(STARTER_KITS.map((kit) => kit.id));
    for (const kit of STARTER_KITS) {
      const shown = STARTER_KIT_SUMMARIES.find((one) => one.id === kit.id)!;
      expect(shown.name, kit.name).toBe(kit.name);
      expect(shown.resources, kit.name).toEqual(kit.resources);
      expect(shown.shiny, kit.name).toBe(kit.shiny);

      const built = kit.buildings.filter((building) => building.t !== webCosts.OUTPOST_CORE_TYPE);
      expect(shown.buildingCount, kit.name).toBe(built.length);
      const counted = new Map<string, number>();
      for (const building of built) {
        const key = `${building.t}:${building.prefab ?? 1}`;
        counted.set(key, (counted.get(key) ?? 0) + 1);
      }
      const contents = new Map(shown.contents.map(([type, level, count]) => [`${type}:${level}`, count]));
      expect(contents, kit.name).toEqual(counted);
    }
  });
});
