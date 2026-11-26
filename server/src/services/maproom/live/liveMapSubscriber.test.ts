import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("../../../server.js", () => ({ postgres: { em: null }, redis: {} }));
const { marksFor } = await import("./liveMapSubscriber.js");
const { setLiveMarkSink } = await import("./liveMarks.js");
const { Save } = await import("../../../database/models/save.model.js");
const { User } = await import("../../../database/models/user.model.js");
const { WorldMapCell } = await import("../../../database/models/worldmapcell.model.js");
const { Alliance } = await import("../../../database/models/alliance.model.js");
const { Truce } = await import("../../../database/models/truce.model.js");
const { AttackLogs } = await import("../../../database/models/attacklogs.model.js");

/** Which changes mark the map (beta 9 live map): the fields a cell shows, nothing else. */
const got: string[] = [];
beforeEach(() => {
  got.length = 0;
  setLiveMarkSink({
    saves: (ids) => got.push(`save:${ids.join(",")}`),
    saveOwners: (ids) => got.push(`owner:${ids.join(",")}`),
    homes: () => {},
    cells: (world, coords) => got.push(`cells:${world}:${coords.length}:${coords.map((c) => c.join("/")).join(" ")}`),
    users: (ids) => got.push(`users:${ids.join(",")}`),
    alliances: (ids) => got.push(`alliances:${ids.join(",")}`),
    sightUsers: () => {},
    sightAlliances: () => {},
    relations: (pairs) => got.push(`relations:${pairs.map((pair) => pair.join("/")).join(" ")}`),
    revealsOf: (ids) => got.push(`reveals:${ids.join(",")}`),
  });
});
afterEach(() => setLiveMarkSink(null));

const changeSet = (entity: object, type: string, payload: Record<string, unknown>, originalEntity?: object) =>
  ({ entity, type, payload, originalEntity }) as never;

const run = (set: never) => {
  for (const mark of marksFor(set)) mark();
};

describe("marksFor", () => {
  test("a save's shield, damage or attack marks its yard; resources and monsters do not", () => {
    // Only the primary key loaded (a save read with `fields:`): still marked.
    const save = Object.assign(new Save(), { basesaveid: 123 });
    run(changeSet(save, "update", { protected: 1 }));
    run(changeSet(save, "update", { resources: {}, monsters: {}, savetime: 1 }));
    run(changeSet(save, "update", { attacks: [] }));
    expect(got).toEqual(["save:123", "save:123"]);
  });

  test("points mark the owner's cells only when the level moves", () => {
    const save = Object.assign(new Save(), { basesaveid: 123, points: "100", basevalue: "0" });
    run(changeSet(save, "update", { points: "100" }, { points: "100", basevalue: "0" }));
    expect(got).toEqual([]);
    save.points = "999999999";
    run(changeSet(save, "update", { points: "999999999" }, { points: "100", basevalue: "0" }));
    expect(got).toEqual(["owner:123"]);
  });

  test("a cell row made, moved or removed marks the 3x3 around it (and where it was)", () => {
    const cell = Object.assign(new WorldMapCell(undefined as never, 0, 0, 0), { x: 10, y: 20, map_version: 2, world: { uuid: "w1" } });
    run(changeSet(cell, "create", { uid: 1 }));
    expect(got[0]).toStartWith("cells:w1:9:");
    got.length = 0;
    run(changeSet(cell, "update", { x: 10 }, { x: 50, y: 60 }));
    expect(got[0]).toStartWith("cells:w1:18:");
    expect(got[0]).toContain("50/60");
  });

  test("a base that comes, moves or changes hands marks its owners' reveals (their defenders' fog); a cell's other fields do not", () => {
    const cell = Object.assign(new WorldMapCell(undefined as never, 0, 0, 0), { x: 10, y: 20, uid: 5, map_version: 2, world: { uuid: "w1" } });
    run(changeSet(cell, "create", { uid: 5 }));
    expect(got).toContain("reveals:5");
    got.length = 0;
    run(changeSet(cell, "update", { uid: 5 }, { x: 10, y: 20, uid: 4 }));
    expect(got).toContain("reveals:5,4");
    got.length = 0;
    run(changeSet(cell, "update", { x: 10 }, { x: 50, y: 60, uid: 5 }));
    expect(got).toContain("reveals:5,5");
    got.length = 0;
    run(changeSet(cell, "update", { terrainHeight: 120 }, { x: 10, y: 20, uid: 5 }));
    expect(got.filter((line) => line.startsWith("reveals"))).toEqual([]);
  });

  test("Map Room 1 cells never mark", () => {
    const cell = Object.assign(new WorldMapCell(undefined as never, 0, 0, 0), { x: 10, y: 20, map_version: 1, world: { uuid: "w1" } });
    run(changeSet(cell, "create", {}));
    expect(got).toEqual([]);
  });

  test("a player's name, picture or alliance marks their cells; their mail count does not", () => {
    const user = Object.assign(new User(), { userid: 9 });
    run(changeSet(user, "update", { username: "x" }));
    run(changeSet(user, "update", { alliance_id: 3 }));
    run(changeSet(user, "update", { last_login: 1 }));
    expect(got).toEqual(["users:9", "users:9"]);
  });

  test("an alliance's name or shield marks every member's cells", () => {
    const alliance = Object.assign(new Alliance(), { id: 4 });
    run(changeSet(alliance, "update", { image: 2 }));
    run(changeSet(alliance, "update", { points: 2 }));
    expect(got).toEqual(["alliances:4"]);
  });

  test("a truce made or answered is a relation between the two players, nothing public", () => {
    const truce = Object.assign(new Truce(), { initiator_userid: 3, recipient_userid: 4 });
    run(changeSet(truce, "update", { status: 2 }));
    expect(got).toEqual(["relations:3/4"]);
  });

  test("a new attack log is a relation between attacker and defender (`ak`, `ho`)", () => {
    const log = Object.assign(new AttackLogs(), { attacker_userid: 5, defender_userid: 6 });
    run(changeSet(log, "create", {}));
    expect(got).toEqual(["relations:5/6"]);
    got.length = 0;
    run(changeSet(log, "update", { attacktime: 1 }));
    expect(got).toEqual([]);
  });
});
