import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { MapRoomVersion } from "../../../../enums/MapRoom.js";
import { User } from "../../../../database/models/user.model.js";
import { Save } from "../../../../database/models/save.model.js";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import { devConfig } from "../../../../config/GameConfig.js";
import { matchesWhere } from "../../../../testing/matchesWhere.js";

/**
 * `baseModeView`'s Map Room 2 fog of war gate (issue #330,
 * `docs/design/fog-of-war.md` §5.3): a hidden base's view is refused (`null`,
 * the same answer a nonexistent base gives - see `baseLoad.ts` and
 * `updateSaved.ts`'s null checks), own/ally/in-range bases pass, and MR1/MR3
 * never run the gate at all.
 *
 * `getPlayerSight` is mocked with a controlled sight rather than exercised
 * for real (that is `sightService.test.ts` and `getArea.test.ts`'s job) -
 * this file is only about `baseModeView`'s own wiring: `cellCoordsOf`'s
 * `WorldMapCell` lookup and its `cellCoordsFromBaseId` fallback, and the
 * `disableFogOfWar` bypass.
 */

type Row = Record<string, unknown>;

let tables: Map<unknown, Row[]>;
let sight: { sv: string; sources: Row[]; revealed: Row[] };

const em = {
  findOne: async (entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null,
  remove: () => {},
  flush: async () => {},
};

mock.module("../../../../server.js", () => ({ postgres: { em } }));
mock.module("../../../../services/maproom/sight/sightService.js", () => ({
  getPlayerSight: async () => sight,
}));

const { baseModeView } = await import("./baseModeView.js");

const WORLD = "world-a";
const VIEWER = { userid: 1, alliance_id: null } as unknown as User;

beforeEach(() => {
  tables = new Map();
  // No sight at all, unless a test says otherwise.
  sight = { sv: "0", sources: [], revealed: [] };
});

const startingDisableFog = devConfig.disableFogOfWar;
afterEach(() => {
  devConfig.disableFogOfWar = startingDisableFog;
});

describe("baseModeView: Map Room 2 fog gate", () => {
  test("a hidden base (not own, not ally, out of range) is refused with null", async () => {
    tables.set(WorldMapCell, [{ baseid: "hidden", x: 500, y: 500 }]);
    tables.set(Save, [{ baseid: "hidden" }]);

    const result = await baseModeView("hidden", MapRoomVersion.V2, WORLD, VIEWER);

    expect(result).toBeNull();
  });

  test("a base named in `revealed` (own or ally, by the sight rule) passes through to the real save", async () => {
    tables.set(WorldMapCell, [{ baseid: "own", x: 5, y: 5 }]);
    tables.set(Save, [{ baseid: "own" }]);
    sight = { sv: "1", sources: [], revealed: [{ x: 5, y: 5 }] };

    const result = await baseModeView("own", MapRoomVersion.V2, WORLD, VIEWER);

    expect(result).toMatchObject({ baseid: "own" });
  });

  test("a base inside a flinger's reach (not own, not ally, just visible by range) passes through", async () => {
    tables.set(WorldMapCell, [{ baseid: "nearby", x: 3, y: 0 }]);
    tables.set(Save, [{ baseid: "nearby" }]);
    sight = { sv: "1", sources: [{ x: 0, y: 0, reach: 4 }], revealed: [] };

    const result = await baseModeView("nearby", MapRoomVersion.V2, WORLD, VIEWER);

    expect(result).toMatchObject({ baseid: "nearby" });
  });

  test("a wild monster camp with no world_map_cell row yet falls back to decoding its baseid, and is still gated", async () => {
    // cellCoordsFromBaseId: last 6 digits, 3 and 3 -> x=500, y=500.
    const campBaseid = "2000500500";
    tables.set(Save, [{ baseid: campBaseid }]);
    // No WorldMapCell row for it at all - cellCoordsOf must fall back to the id.

    const result = await baseModeView(campBaseid, MapRoomVersion.V2, WORLD, VIEWER);

    expect(result).toBeNull();
  });

  test("devConfig.disableFogOfWar bypasses the gate even for an otherwise-hidden base", async () => {
    devConfig.disableFogOfWar = true;
    tables.set(WorldMapCell, [{ baseid: "hidden", x: 500, y: 500 }]);
    tables.set(Save, [{ baseid: "hidden" }]);

    const result = await baseModeView("hidden", MapRoomVersion.V2, WORLD, VIEWER);

    expect(result).toMatchObject({ baseid: "hidden" });
  });
});

describe("baseModeView: Map Room 1 and 3 never run the gate", () => {
  test("Map Room 1 (not a known tribe id) loads the save regardless of sight", async () => {
    tables.set(Save, [{ baseid: "mr1-base" }]);
    // No WorldMapCell row and an empty sight: under MR2 rules this would be refused.

    const result = await baseModeView("mr1-base", MapRoomVersion.V1, WORLD, VIEWER);

    expect(result).toMatchObject({ baseid: "mr1-base" });
  });

  test("Map Room 3 loads the save regardless of sight", async () => {
    tables.set(Save, [{ baseid: "mr3-base" }]);

    const result = await baseModeView("mr3-base", MapRoomVersion.V3, WORLD, VIEWER);

    expect(result).toMatchObject({ baseid: "mr3-base" });
  });
});
