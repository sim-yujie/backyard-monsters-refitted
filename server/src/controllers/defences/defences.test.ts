import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EntityManager } from "@mikro-orm/core";
import { DefenceReplay } from "../../database/models/defencereplay.model.js";
import type { User } from "../../database/models/user.model.js";
import { encodeReplay, type DefenceReplayPayload } from "../../services/defences/defenceReplayStore.js";
import { RULES_VERSION } from "../../services/defences/rulesVersion.js";
import { listAnswer, replayAnswer } from "./defences.js";

/**
 * The Defences routes (issue #360, `docs/design/defence-replays.md` §6), with
 * the database replaced by an entity manager that keeps rows in memory, filters
 * them as Postgres would, and can only read: any write would throw.
 */

type Row = Record<string, any>;

const ME = 41;
const OTHER = 42;
const T0 = Date.UTC(2026, 9, 16, 12);
const MINUTE = 60_000;

const payload = (extra: Partial<DefenceReplayPayload> = {}): DefenceReplayPayload => ({
  v: 1,
  load: { type: "main", buildingdata: { "1": { t: 14, X: 0, Y: 0 } }, buildinghealthdata: { "1": 1200 }, storedata: { ENL: { q: 1 } } },
  seed: 7,
  events: [],
  tick: 2400,
  levels: { C1: 2 },
  declareWar: false,
  ...extra,
});

let nextId = 1;
const row = (extra: Row = {}): Row => {
  const id = nextId++;
  const replay = "replay" in extra ? extra.replay : encodeReplay(payload({ seed: id }));
  return {
    id,
    defender_userid: ME,
    baseid: `${ME}01`,
    map_version: 2,
    attacker_userid: 900 + id,
    attacker_username: `Attacker ${id}`,
    attacker_pic_square: `https://pic.invalid/${id}.png`,
    attacked_at: new Date(T0 + id * MINUTE - 3 * MINUTE),
    landed_at: new Date(T0 + id * MINUTE),
    damage_before: 10,
    damage_after: 45,
    loot: { r1: 1234, r2: 0 },
    housed_lost: 2,
    attacker_left: false,
    rules_version: RULES_VERSION,
    replay_bytes: replay ? replay.byteLength : 0,
    ...extra,
    replay,
  };
};

const db = { rows: [] as Row[], fields: [] as (readonly string[] | undefined)[] };

const matches = (one: Row, where: Row): boolean =>
  Object.entries(where).every(([key, want]) =>
    want && typeof want === "object" && "$in" in want ? (want.$in as unknown[]).includes(one[key]) : one[key] === want,
  );

/** What a partial load hands back: only the `fields` asked for (the payload only when named). */
const loaded = (one: Row, fields: readonly string[] | undefined): Row =>
  fields ? Object.fromEntries(fields.map((field) => [field, one[field]])) : { ...one, replay: undefined };

const em = {
  async find(entity: unknown, where: Row, options: { fields?: readonly string[]; orderBy?: Row; limit?: number } = {}) {
    if (entity !== DefenceReplay) throw new Error("unexpected find");
    db.fields.push(options.fields);
    expect(options.orderBy).toEqual({ landed_at: "DESC", id: "DESC" });
    return db.rows
      .filter((one) => matches(one, where))
      .sort((a, b) => b.landed_at.getTime() - a.landed_at.getTime() || b.id - a.id)
      .slice(0, options.limit)
      .map((one) => loaded(one, options.fields));
  },
  async findOne(entity: unknown, where: Row, options: { fields?: readonly string[] } = {}) {
    if (entity !== DefenceReplay) throw new Error("unexpected findOne");
    db.fields.push(options.fields);
    const found = db.rows.find((one) => matches(one, where));
    return found ? loaded(found, options.fields) : null;
  },
} as unknown as EntityManager;

const me = { userid: ME } as User;
const other = { userid: OTHER } as User;

beforeEach(() => {
  db.rows = [];
  db.fields = [];
  nextId = 1;
});

describe("GET /api/:apiVersion/defences", () => {
  test("the caller's defences, newest landing first, each with every figure", async () => {
    db.rows.push(row(), row({ damage_before: 0, damage_after: 63, attacker_left: true, housed_lost: 0 }), row());
    db.rows[0].landed_at = new Date(T0 + 10 * MINUTE); // landed last though it started first

    const answer = await listAnswer(em, me);
    expect(answer.status).toBe(200);
    const defences = answer.body.defences as Row[];
    expect(defences.map((one) => one.id)).toEqual([1, 3, 2]);
    expect(defences[2]).toEqual({
      id: 2,
      attacker: { name: "Attacker 2", pic: "https://pic.invalid/2.png" },
      attackedAt: Math.floor((T0 - MINUTE) / 1000),
      landedAt: Math.floor((T0 + 2 * MINUTE) / 1000),
      damageDone: 63,
      damageAfter: 63,
      loot: { r1: 1234, r2: 0 },
      housedLost: 0,
      left: true,
      rulesVersion: RULES_VERSION,
      hasReplay: true,
      playable: true,
    });
    expect(defences[0].damageDone).toBe(35);
    expect(answer.body.error).toBe(0);
  });

  test("never reads the payloads, and never more than 20", async () => {
    for (let i = 0; i < 23; i++) db.rows.push(row());
    const defences = (await listAnswer(em, me)).body.defences as Row[];
    expect(defences).toHaveLength(20);
    expect(defences[0].id).toBe(23);
    expect(db.fields[0]).not.toContain("replay");
  });

  test("only the caller's: another player's defences are not listed", async () => {
    db.rows.push(row(), row({ defender_userid: OTHER }));
    expect(((await listAnswer(em, me)).body.defences as Row[]).map((one) => one.id)).toEqual([1]);
    expect(((await listAnswer(em, other)).body.defences as Row[]).map((one) => one.id)).toEqual([2]);
  });

  test("a Map Room 1 player gets an empty list, and Map Room 1 rows are not listed yet (#246)", async () => {
    expect((await listAnswer(em, me)).body).toEqual({ error: 0, defences: [] });
    db.rows.push(row({ map_version: 1 }));
    expect((await listAnswer(em, me)).body).toEqual({ error: 0, defences: [] });
  });

  test("a row without its inputs is listed, without a replay", async () => {
    db.rows.push(row({ replay: null }));
    const [defence] = (await listAnswer(em, me)).body.defences as Row[];
    expect([defence.hasReplay, defence.playable]).toEqual([false, false]);
  });

  test("a replay fought under other rules is listed, kept but not playable", async () => {
    db.rows.push(row({ rules_version: "0123456789abcdef" }));
    const [defence] = (await listAnswer(em, me)).body.defences as Row[];
    expect([defence.rulesVersion, defence.hasReplay, defence.playable]).toEqual(["0123456789abcdef", true, false]);
  });

  test("a deleted attacker shows as the name the account deletion left, with no picture", async () => {
    db.rows.push(row({ attacker_username: "Deleted player", attacker_pic_square: null }));
    const [defence] = (await listAnswer(em, me)).body.defences as Row[];
    expect(defence.attacker).toEqual({ name: "Deleted player", pic: null });
  });

  test("nothing sent says who the attacker is beyond their name and picture (bots look like players)", async () => {
    db.rows.push(row());
    const sent = JSON.stringify((await listAnswer(em, me)).body);
    expect(sent).not.toMatch(/userid|bot|baseid/i);
    expect(sent).not.toContain(String(db.rows[0].attacker_userid));
  });
});

describe("GET /api/:apiVersion/defences/:id/replay", () => {
  test("the caller's replay, unzipped, with its figures", async () => {
    db.rows.push(row(), row());
    const answer = await replayAnswer(em, me, { id: "2" });
    expect(answer.status).toBe(200);
    expect(answer.body.error).toBe(0);
    expect(answer.body.defence).toMatchObject({ id: 2, damageDone: 35, damageAfter: 45, playable: true, hasReplay: true });
    expect(answer.body.replay).toEqual(payload({ seed: 2 }));
    expect(db.fields[0]).toContain("replay");
  });

  test("another player's replay is a 404, the same as one that does not exist", async () => {
    db.rows.push(row({ defender_userid: OTHER }));
    const theirs = await replayAnswer(em, me, { id: "1" });
    const missing = await replayAnswer(em, me, { id: "99" });
    expect(theirs.status).toBe(404);
    expect(theirs).toEqual(missing);
    expect((await replayAnswer(em, other, { id: "1" })).status).toBe(200);
  });

  test.each([["abc"], ["0"], ["-1"], ["1.5"], ["1e400"], [""]])("a bad id %p is a 404", async (id) => {
    db.rows.push(row());
    expect((await replayAnswer(em, me, { id })).status).toBe(404);
  });

  test("a Map Room 1 row is a 404 until #246", async () => {
    db.rows.push(row({ map_version: 1 }));
    expect((await replayAnswer(em, me, { id: "1" })).status).toBe(404);
  });

  test("a row kept without its inputs is a 410", async () => {
    db.rows.push(row({ replay: null }));
    const answer = await replayAnswer(em, me, { id: "1" });
    expect(answer.status).toBe(410);
    expect(answer.body.reason).toBe("noReplay");
  });

  test("a payload that cannot be read is a 410, not an error", async () => {
    db.rows.push(row({ replay: Buffer.from("not gzip") }));
    expect((await replayAnswer(em, me, { id: "1" })).status).toBe(410);
  });

  test("a replay fought under other rules is still sent, not playable: the client decides", async () => {
    db.rows.push(row({ rules_version: "0123456789abcdef" }));
    const answer = await replayAnswer(em, me, { id: "1" });
    expect(answer.status).toBe(200);
    expect((answer.body.defence as Row).playable).toBe(false);
  });

  test("the yard sent is cut to the allow-list again, whatever an older row holds", async () => {
    const stored = payload();
    const leaky = { ...stored, load: { ...stored.load, credits: 5000, chat: ["hi"], storedata: { ENL: { q: 1 }, BLK1: 9 } } };
    db.rows.push(row({ replay: encodeReplay(leaky) }));
    const sent = (await replayAnswer(em, me, { id: "1" })).body.replay as DefenceReplayPayload;
    expect(sent.load).toEqual(stored.load);
  });
});

describe("the routes", () => {
  const routes = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8");

  test.each([
    ["/api/:apiVersion/defences", "getDefences"],
    ["/api/:apiVersion/defences/:id/replay", "getDefenceReplay"],
  ])("GET %s is signed in, account-checked and rate limited", (path, controller) => {
    expect(routes).toContain(
      `router.get("${path}", apiVersion, verifyUserAuth, verifyAccountStatus, defencesLimiter, ${controller});`,
    );
  });
});
