import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

/**
 * The live map's flush hook on a real Postgres (MikroORM 7.2): marks leave only once their
 * transaction commits, a savepoint's wait for the transaction around it, and a rollback drops them.
 *
 * Opt-in like the other database tests: runs only when LIVE_MAP_TEST_DB names a throwaway
 * database with the `bym` schema (never the shared `bym`). It makes one save of its own (user
 * 998001) and deletes it after.
 */
const dbName = process.env.LIVE_MAP_TEST_DB;

mock.module("../../../server.js", () => ({ postgres: { em: null }, redis: {} }));
const ormConfig = (await import("../../../mikro-orm.config.js")).default;
const { Save } = await import("../../../database/models/save.model.js");
const { setLiveMarkSink } = await import("./liveMarks.js");

describe.skipIf(!dbName)("live map marks wait for the commit (beta 9)", () => {
  let orm: MikroORM;
  let id = 0;
  let original = 0;
  let baseid = "";
  const marked: string[] = [];

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("LIVE_MAP_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    // Its own row (user 998_001), so an empty CI database works too; removed after.
    const [row] = await orm.em.fork().execute<{ basesaveid: number }[]>(
      `INSERT INTO bym.save (userid, saveuserid, createtime, name, credits, attacks, takeover_date, created_at, lastupdate_at, baseid, protected)
       VALUES (998001, 998001, 0, 'zz_live', 0, '[]', now(), now(), now(), '998001', 0) RETURNING basesaveid`,
    );
    id = Number(row!.basesaveid);
    original = 0;
    baseid = String(id);
    setLiveMarkSink({
      saves: (ids) => marked.push(...ids.map(String)),
      saveOwners: () => {},
      homes: () => {},
      cells: () => {},
      users: () => {},
      alliances: () => {},
      sightUsers: () => {},
      sightAlliances: () => {},
      relations: () => {},
      revealsOf: () => {},
    });
  });
  beforeEach(() => {
    marked.length = 0;
  });
  afterAll(async () => {
    setLiveMarkSink(null);
    if (!orm) return;
    await orm.em.fork().nativeDelete(Save, { basesaveid: id });
    await orm.close(true);
  });

  const load = (em: ReturnType<MikroORM["em"]["fork"]>) => em.findOneOrFail(Save, { basesaveid: id });

  test("a plain flush marks at once", async () => {
    const em = orm.em.fork();
    (await load(em)).protected = original + 11;
    await em.flush();
    expect(marked).toEqual([baseid]);
  });

  test("a field the map does not show marks nothing", async () => {
    const em = orm.em.fork();
    (await load(em)).unreadmessages = ((await load(em)).unreadmessages ?? 0) + 1;
    await em.flush();
    expect(marked).toEqual([]);
  });

  test("inside a transaction: nothing until the commit", async () => {
    await orm.em.fork().transactional(async (tx) => {
      (await load(tx)).protected = original + 12;
      await tx.flush();
      expect(marked).toEqual([]);
    });
    expect(marked).toEqual([baseid]);
  });

  test("a savepoint's marks wait for the outer commit", async () => {
    await orm.em.fork().transactional(async (tx) => {
      await tx.transactional(async (inner) => {
        (await load(inner)).protected = original + 13;
      });
      expect(marked).toEqual([]);
    });
    expect(marked).toEqual([baseid]);
  });

  test("a rollback drops them, a rolled-back savepoint drops only its own", async () => {
    await orm.em
      .fork()
      .transactional(async (tx) => {
        (await load(tx)).protected = original + 14;
        await tx.flush();
        throw new Error("abandon");
      })
      .catch(() => undefined);
    expect(marked).toEqual([]);

    await orm.em.fork().transactional(async (tx) => {
      await tx
        .transactional(async (inner) => {
          (await load(inner)).protected = original + 15;
          await inner.flush();
          throw new Error("abandon inner");
        })
        .catch(() => undefined);
      expect(marked).toEqual([]);
    });
    expect(marked).toEqual([]);
  });

  test("begin / commit by hand", async () => {
    const em = orm.em.fork();
    await em.begin();
    (await load(em)).protected = original + 16;
    await em.flush();
    expect(marked).toEqual([]);
    await em.commit();
    expect(marked).toEqual([baseid]);
  });

  test("writes around the ORM never reach the hook (they mark by hand)", async () => {
    const em = orm.em.fork();
    await em.nativeUpdate(Save, { basesaveid: id }, { protected: original + 17 });
    await em.execute(`UPDATE bym.save SET protected = ? WHERE basesaveid = ?`, [original + 18, id]);
    expect(marked).toEqual([]);
  });
});
