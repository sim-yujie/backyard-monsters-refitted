import { afterEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import {
  DEFAULT_MESSAGE,
  MAINTENANCE_OFF,
  applyMaintenanceChange,
  loadMaintenance,
  maintenanceNotice,
  maintenanceState,
  onMaintenanceChange,
  parseMaintenanceChange,
  readMaintenance,
  requestBlocked,
  saveMaintenance,
  setMaintenance,
  signInBlocked,
} from "./maintenance.js";

/**
 * The maintenance switch's rules (owner, 22 Nov 2026), and its row in
 * `bym.game_setting` read back as a restarted server would.
 */

const NOW = Date.parse("2026-11-22T12:00:00Z");

/** A stand-in database holding one `game_setting` table, as a restart keeps it. */
const fakeDb = () => {
  const rows = new Map<string, { value: unknown; updated_at: Date; updated_by: number }>();
  const em = {
    execute: async (sql: string, params: unknown[] = []) => {
      if (/^\s*INSERT/i.test(sql)) {
        const [key, value, by] = params as [string, string, number];
        rows.set(key, { value: JSON.parse(value), updated_at: new Date(), updated_by: by });
        return [];
      }
      const row = rows.get(params[0] as string);
      return row ? [row] : [];
    },
  } as unknown as EntityManager;
  return { em, rows };
};

afterEach(() => setMaintenance(MAINTENANCE_OFF));

describe("parseMaintenanceChange", () => {
  test("on with nothing filled in: the default message, no back-at time, 5 minutes", () => {
    expect(parseMaintenanceChange({ action: "on" }, NOW)).toEqual({
      ok: true,
      value: { action: "on", message: DEFAULT_MESSAGE, backAt: null, minutes: 5 },
    });
  });

  test("on with a message, a back-at time (ISO or ms, as the JSON middleware may pass it) and a countdown", () => {
    const backAt = NOW + 2 * 3_600_000;
    for (const sent of [new Date(backAt).toISOString(), backAt, String(backAt)]) {
      expect(parseMaintenanceChange({ action: "on", message: "  New  servers ", backAt: sent, minutes: "15" }, NOW)).toEqual({
        ok: true,
        value: { action: "on", message: "New servers", backAt, minutes: 15 },
      });
    }
  });

  test("refuses a countdown not offered, a past or far back-at time, and a long message", () => {
    expect(parseMaintenanceChange({ action: "on", minutes: 3 }, NOW).ok).toBe(false);
    expect(parseMaintenanceChange({ action: "on", backAt: NOW - 1 }, NOW).ok).toBe(false);
    expect(parseMaintenanceChange({ action: "on", backAt: NOW + 8 * 86_400_000 }, NOW).ok).toBe(false);
    expect(parseMaintenanceChange({ action: "on", backAt: "soon" }, NOW).ok).toBe(false);
    expect(parseMaintenanceChange({ action: "on", message: "x".repeat(141) }, NOW).ok).toBe(false);
    expect(parseMaintenanceChange({ action: "explode" }, NOW).ok).toBe(false);
  });
});

describe("applyMaintenanceChange", () => {
  const on = { action: "on", message: "Moving.", backAt: null, minutes: 5 } as const;

  test("on starts the countdown from now", () => {
    expect(applyMaintenanceChange(MAINTENANCE_OFF, on, NOW)).toEqual({
      on: true,
      message: "Moving.",
      backAt: null,
      startedAt: NOW,
      cutoffAt: NOW + 5 * 60_000,
    });
  });

  test("on again changes the words only; the countdown does not restart", () => {
    const first = applyMaintenanceChange(MAINTENANCE_OFF, on, NOW);
    const again = applyMaintenanceChange(first, { ...on, message: "Longer.", minutes: 15 }, NOW + 60_000);
    expect(again).toEqual({ ...first, message: "Longer." });
  });

  test("off cancels the countdown and lets everyone in", () => {
    const state = applyMaintenanceChange(MAINTENANCE_OFF, on, NOW);
    expect(signInBlocked(2, state)).toBe(true);
    const off = applyMaintenanceChange(state, { action: "off" }, NOW + 1_000);
    expect(off).toEqual(MAINTENANCE_OFF);
    expect(signInBlocked(2, off)).toBe(false);
    expect(requestBlocked(2, NOW + 10 * 60_000, off)).toBe(false);
  });
});

describe("who is blocked", () => {
  const state = { on: true, message: "m", backAt: null, startedAt: NOW, cutoffAt: NOW + 60_000 };
  const env = process.env.ADMIN_USER_IDS;
  afterEach(() => {
    if (env === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = env;
  });

  test("sign-ins at once, requests from the cut-off on; never the owner", () => {
    process.env.ADMIN_USER_IDS = "1";
    expect(signInBlocked(2, state)).toBe(true);
    expect(signInBlocked(1, state)).toBe(false);
    expect(requestBlocked(2, NOW + 59_999, state)).toBe(false);
    expect(requestBlocked(2, NOW + 60_000, state)).toBe(true);
    expect(requestBlocked(1, NOW + 60_000, state)).toBe(false);
  });

  test("the notice gives the time left, not the clock time, and ISO back-at", () => {
    const notice = maintenanceNotice({ ...state, backAt: NOW + 3_600_000 }, NOW + 20_000);
    expect(notice).toEqual({ on: true, message: "m", backAt: "2026-11-22T13:00:00.000Z", remainingMs: 40_000, exempt: false });
    expect(maintenanceNotice(state, NOW + 90_000, true).remainingMs).toBe(0);
    expect(maintenanceNotice(MAINTENANCE_OFF, NOW, true)).toEqual({ on: false, message: "", backAt: null, remainingMs: 0, exempt: false });
  });
});

describe("readMaintenance: a broken row never locks the game", () => {
  test("anything malformed reads as off", () => {
    for (const raw of [null, "on", [], { on: "yes" }, { on: true }, { on: true, startedAt: 10, cutoffAt: 5 }]) {
      expect(readMaintenance(raw)).toEqual(MAINTENANCE_OFF);
    }
  });

  test("an empty message reads as the default", () => {
    expect(readMaintenance({ on: true, message: "", startedAt: 1, cutoffAt: 2 }).message).toBe(DEFAULT_MESSAGE);
  });
});

describe("the state survives a server restart", () => {
  test("saved on, then read by a fresh server: still on with the same cut-off", async () => {
    const { em } = fakeDb();
    const state = applyMaintenanceChange(MAINTENANCE_OFF, { action: "on", message: "Restart.", backAt: NOW + 3_600_000, minutes: 1 }, NOW);
    await saveMaintenance(em, state, 1);

    // A restart: memory starts off, the row is read before the first request.
    setMaintenance(MAINTENANCE_OFF);
    expect(maintenanceState().on).toBe(false);
    await loadMaintenance(em);
    expect(maintenanceState()).toEqual(state);
  });

  test("off saved: a fresh server reads off", async () => {
    const { em } = fakeDb();
    await saveMaintenance(em, applyMaintenanceChange(MAINTENANCE_OFF, { action: "on", message: "x", backAt: null, minutes: 5 }, NOW), 1);
    await saveMaintenance(em, MAINTENANCE_OFF, 1);
    setMaintenance({ on: true, message: "stale", backAt: null, startedAt: 1, cutoffAt: 2 });
    await loadMaintenance(em);
    expect(maintenanceState()).toEqual(MAINTENANCE_OFF);
  });

  test("a failed read keeps what was in memory", async () => {
    const broken = { execute: async () => Promise.reject(new Error("down")) } as unknown as EntityManager;
    const state = { on: true, message: "kept", backAt: null, startedAt: 1, cutoffAt: 2 };
    setMaintenance(state);
    await loadMaintenance(broken);
    expect(maintenanceState()).toEqual(state);
  });

  test("listeners hear a change once, not a read that changed nothing", async () => {
    const { em } = fakeDb();
    const heard: boolean[] = [];
    const stop = onMaintenanceChange((s) => heard.push(s.on));
    const state = applyMaintenanceChange(MAINTENANCE_OFF, { action: "on", message: "x", backAt: null, minutes: 5 }, NOW);
    await saveMaintenance(em, state, 1);
    await loadMaintenance(em);
    await saveMaintenance(em, MAINTENANCE_OFF, 1);
    stop();
    expect(heard).toEqual([true, false]);
  });
});
