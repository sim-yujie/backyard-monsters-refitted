import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { REPLAY_FORMAT } from "../../game-rules/combat/replay.js";
import {
  decodeReplay,
  DEFENCE_REPLAY_LIMIT,
  type DefenceReplayPayload,
  type DefenceReplayRecord,
  encodeReplay,
  MAX_REPLAY_BYTES,
  storedReplay,
} from "./defenceReplayStore.js";
import { RULES_VERSION } from "./rulesVersion.js";

/**
 * Defence replay storage without a database (issue #358): the payload's gzip
 * round trip and its limits, the rules version and the migration's shape.
 * `defenceReplayStore.db.test.ts` covers the insert and the prune.
 */

const payload = (extra: Partial<DefenceReplayPayload> = {}): DefenceReplayPayload => ({
  v: 1,
  load: { buildingdata: { "1": { t: 14, X: 0, Y: 0 } }, buildinghealthdata: { "1": 4000 }, cellheight: 0 },
  seed: 123456,
  events: [{ t: 40, k: "f", c: "C1", n: 3, x: 100, y: 120 }] as unknown as DefenceReplayPayload["events"],
  tick: 2400,
  levels: { C1: 3 },
  ranks: {},
  champion: null,
  siege: null,
  declareWar: false,
  report: ["Pokey x3"],
  ...extra,
});

const record = (replay: DefenceReplayPayload | null): DefenceReplayRecord => ({
  defenderUserid: 1,
  baseid: "1001",
  mapVersion: 2,
  attacker: { userid: 2, username: "attacker" },
  attackedAt: new Date(0),
  landedAt: new Date(1000),
  damageBefore: 10,
  damageAfter: 45,
  loot: { r1: 1234 },
  housedLost: 0,
  left: false,
  payload: replay,
});

describe("the defence replay payload (issue #358)", () => {
  test("round-trips through gzip, stamped with its format", () => {
    const stored = encodeReplay(payload());
    expect(stored[0]).toBe(0x1f); // gzip magic
    expect(stored[1]).toBe(0x8b);
    expect(decodeReplay(stored)).toEqual(payload());
  });

  test("is stored as format 1 whatever the caller set", () => {
    const stored = encodeReplay({ ...payload(), v: 7 } as unknown as DefenceReplayPayload);
    expect(decodeReplay(stored).v).toBe(1);
  });

  test("a whole yard gzips to a few KB", () => {
    const yard = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "../../../../web/test/fixtures/baseload-sandbox-yard.json"), "utf8"),
    );
    const stored = encodeReplay(payload({ load: yard }));
    expect(stored.byteLength).toBeLessThan(20 * 1024);
    expect(decodeReplay(stored).load).toEqual(yard);
  });

  test("refuses another format, a damaged payload and one that unzips too big", () => {
    expect(() => decodeReplay(gzipSync(JSON.stringify({ ...payload(), v: 2 })))).toThrow(/format 2/);
    expect(() => decodeReplay(gzipSync(JSON.stringify({ seed: 1 })))).toThrow(/format undefined/);
    expect(() => decodeReplay(Buffer.from("not gzip"))).toThrow();
    // 9 MB of spaces gzips to a few KB, but is over the 8 MB unzip limit.
    const bomb = gzipSync(`{"v":1,"pad":"${" ".repeat(9 * 1024 * 1024)}"}`);
    expect(bomb.byteLength).toBeLessThan(MAX_REPLAY_BYTES);
    expect(() => decodeReplay(bomb)).toThrow();
  });

  test("a row keeps no replay when its inputs were missing or it is too big", () => {
    expect(storedReplay(record(null))).toBeNull();
    expect(storedReplay(record(payload()))).not.toBeNull();
    // Random bytes barely compress: 300 KB of them stays over the 256 KB limit.
    const huge = payload({ load: { noise: randomBytes(300 * 1024).toString("base64") } });
    expect(encodeReplay(huge).byteLength).toBeGreaterThan(MAX_REPLAY_BYTES);
    expect(storedReplay(record(huge))).toBeNull();
  });

  test("a defender keeps 20", () => {
    expect(DEFENCE_REPLAY_LIMIT).toBe(20);
  });
});

describe("the rules version a replay is stamped with (issue #358)", () => {
  test("is the combat manifest's version", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "../../game-rules/combat/MANIFEST.json"), "utf8"),
    );
    expect(RULES_VERSION).toMatch(/^[0-9a-f]{16}$/);
    expect(RULES_VERSION).toBe(manifest.version);
  });

  test("the replay format constant lives in the hashed rules", () => {
    expect(REPLAY_FORMAT).toBe(1);
  });
});

describe("the defence replay migration (issue #358)", () => {
  const migration = readFileSync(
    path.join(import.meta.dirname, "../../database/migrations/20261016_CreateDefenceReplayTable.ts"),
    "utf8",
  );

  test("only adds: a table, a nullable column and indexes, each if not there yet", () => {
    // "ON DELETE" is a foreign key's rule, not a statement.
    expect(migration).not.toMatch(/\b(DROP|UPDATE|TRUNCATE|RENAME)\b|(?<!ON )\bDELETE\b/);
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "bym"."defence_replay"`);
    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "replayid" bigint NULL`);
    expect(migration).not.toMatch(/"replayid" bigint NOT NULL|SET DEFAULT/);
    expect(migration.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(2);
    expect(migration.match(/CREATE INDEX(?! IF NOT EXISTS)/g)).toBeNull();
  });

  test("lists by defender, newest first", () => {
    expect(migration).toContain(`ON "bym"."defence_replay" ("defender_userid", "landed_at" DESC)`);
  });

  test("goes with the defender, and a pruned replay clears the notice's link", () => {
    expect(migration).toMatch(/"defender_userid"\s+integer\s+NOT NULL REFERENCES "bym"\."user" \("userid"\) ON DELETE CASCADE/);
    expect(migration).toContain(`REFERENCES "bym"."defence_replay" ("id") ON DELETE SET NULL`);
    // A deleted attacker's rows stay (their name is replaced), so no key on them.
    expect(migration).toMatch(/"attacker_userid"\s+integer\s+NOT NULL,/);
  });
});
