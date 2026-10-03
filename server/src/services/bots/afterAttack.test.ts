import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import {
  REVENGE_CHANCE,
  revengeCapsAllow,
  scheduleAfterBotDefence,
  type RevengeEvent,
} from "./afterAttack.js";

/**
 * What an attacked bot books (issue #241, `docs/design/bot-neighbours.md`
 * §4.5 and §7.2): a repair 1-4 hours on, and with chance 1/3 a revenge 1-24
 * hours on within the caps, giving up 72 hours after the attack.
 */

const HOUR = 60 * 60 * 1000;
const AT = new Date("2026-10-03T12:00:00Z");
const hoursFrom = (hours: number, from = AT) => new Date(from.getTime() + hours * HOUR);

const BOT = 41;
const OTHER_BOT = 42;
const THIRD_BOT = 43;
const PLAYER = 7;

describe("revengeCapsAllow", () => {
  const event = (bot: number, hours: number): RevengeEvent => ({ bot, at: hoursFrom(hours) });

  test("a player with no other revenge can be attacked", () => {
    expect(revengeCapsAllow(AT, BOT, [])).toBe(true);
  });

  test("two other bots' revenge in the same 24 hours fills the player's place", () => {
    expect(revengeCapsAllow(AT, BOT, [event(OTHER_BOT, -5)])).toBe(true);
    expect(revengeCapsAllow(AT, BOT, [event(OTHER_BOT, -5), event(THIRD_BOT, 10)])).toBe(false);
    expect(revengeCapsAllow(AT, BOT, [event(OTHER_BOT, 3), event(THIRD_BOT, 20)])).toBe(false);
  });

  test("the player's cap counts any 24 hours, not a span around this one", () => {
    // 20 hours before and 20 hours after: no 24 hours holds all three.
    expect(revengeCapsAllow(AT, BOT, [event(OTHER_BOT, -20), event(THIRD_BOT, 20)])).toBe(true);
    // 24 hours apart is outside the span.
    expect(revengeCapsAllow(AT, BOT, [event(OTHER_BOT, -24), event(THIRD_BOT, -1)])).toBe(true);
    expect(revengeCapsAllow(AT, BOT, [event(OTHER_BOT, -23.9), event(THIRD_BOT, -1)])).toBe(false);
  });

  test("one bot attacks one player at most once in 24 hours", () => {
    expect(revengeCapsAllow(AT, BOT, [event(BOT, -23)])).toBe(false);
    expect(revengeCapsAllow(AT, BOT, [event(BOT, 23)])).toBe(false);
    expect(revengeCapsAllow(AT, BOT, [event(BOT, -24)])).toBe(true);
    expect(revengeCapsAllow(AT, BOT, [event(OTHER_BOT, -23)])).toBe(true);
  });
});

type Job = { id: number; bot_userid: number; kind: string; target_userid: number | null; due_at: Date; giveup_at: Date | null };
type Log = { attacker_userid: number; defender_userid: number; type: string; attacktime: Date };

/** The two bot tables and the attack logs, behind the SQL `scheduleAfterBotDefence` sends. */
const fakeDb = (bots: number[] = [BOT, OTHER_BOT, THIRD_BOT]) => {
  const jobs: Job[] = [];
  const logs: Log[] = [];
  const locks: unknown[][] = [];
  let nextId = 1;
  const em: { fork: () => unknown; transactional: (body: (tx: unknown) => Promise<unknown>) => Promise<unknown>; execute: (sql: string, params: unknown[]) => Promise<unknown[]> } = {
    fork: () => em,
    transactional: async (body) => body(em),
    execute: async (sql: string, params: unknown[]) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        locks.push(params);
        return [];
      }
      if (sql.includes("'repair'")) {
        const [bot, due] = params as [number, Date];
        if (jobs.some((job) => job.kind === "repair" && job.bot_userid === bot)) return [];
        jobs.push({ id: nextId, bot_userid: bot, kind: "repair", target_userid: null, due_at: due, giveup_at: null });
        return [{ id: nextId++ }];
      }
      if (sql.startsWith("INSERT") && sql.includes("'revenge'")) {
        const [bot, target, due, giveup] = params as [number, number, Date, Date];
        if (jobs.some((job) => job.kind === "revenge" && job.bot_userid === bot && job.target_userid === target)) {
          return [];
        }
        jobs.push({ id: nextId, bot_userid: bot, kind: "revenge", target_userid: target, due_at: due, giveup_at: giveup });
        return [{ id: nextId++ }];
      }
      if (sql.includes("UNION ALL")) {
        const [target, defender, since] = params as [number, number, Date];
        return [
          ...jobs
            .filter((job) => job.kind === "revenge" && job.target_userid === target)
            .map((job) => ({ bot: job.bot_userid, at: job.due_at })),
          ...logs
            .filter(
              (log) =>
                bots.includes(log.attacker_userid) &&
                log.defender_userid === defender &&
                log.type === "main" &&
                log.attacktime > since
            )
            .map((log) => ({ bot: log.attacker_userid, at: log.attacktime.toISOString() })),
        ];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { em: em as unknown as EntityManager, jobs, logs, locks };
};

/** An rng that hands out the given numbers in turn. */
const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length]!;
};

const REVENGE = REVENGE_CHANCE / 2;
const NO_REVENGE = REVENGE_CHANCE;

describe("scheduleAfterBotDefence", () => {
  test("books a repair 1-4 hours on, and no revenge on a failed roll", async () => {
    const { em, jobs } = fakeDb();
    const booked = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0.5, NO_REVENGE), revenge: true });
    expect(booked).toEqual({ repair: hoursFrom(2.5), revenge: null });
    expect(jobs).toEqual([expect.objectContaining({ bot_userid: BOT, kind: "repair", due_at: hoursFrom(2.5) })]);
  });

  test("the repair is due between 1 and 4 hours on", async () => {
    const early = await scheduleAfterBotDefence(fakeDb().em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, NO_REVENGE) });
    const late = await scheduleAfterBotDefence(fakeDb().em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0.999999, NO_REVENGE) });
    expect(early.repair).toEqual(hoursFrom(1));
    expect(late.repair!.getTime()).toBeLessThan(hoursFrom(4).getTime());
    expect(late.repair!.getTime()).toBeGreaterThan(hoursFrom(3.99).getTime());
  });

  test("a repair already booked stands", async () => {
    const { em, jobs } = fakeDb();
    await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, NO_REVENGE) });
    const again = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: hoursFrom(0.5), rng: sequence(0.9, NO_REVENGE) });
    expect(again.repair).toBeNull();
    expect(jobs.filter((job) => job.kind === "repair")).toEqual([expect.objectContaining({ due_at: hoursFrom(1) })]);
  });

  test("a winning roll books a revenge 1-24 hours on that gives up 72 hours after the attack", async () => {
    const { em, jobs, locks } = fakeDb();
    const booked = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0.5), revenge: true });
    expect(booked.revenge).toEqual(hoursFrom(12.5));
    expect(jobs).toContainEqual(
      expect.objectContaining({ bot_userid: BOT, kind: "revenge", target_userid: PLAYER, due_at: hoursFrom(12.5), giveup_at: hoursFrom(72) })
    );
    // The caps were read under a lock on the player.
    expect(locks).toEqual([[PLAYER]]);
  });

  test("about one attack in three books a revenge", async () => {
    let state = 12345;
    const rng = () => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state / 2 ** 31;
    };
    let revenges = 0;
    const tries = 3000;
    for (let index = 0; index < tries; index++) {
      const booked = await scheduleAfterBotDefence(fakeDb().em, { bot: BOT, attacker: PLAYER, at: AT, rng, revenge: true });
      if (booked.revenge) revenges++;
    }
    expect(revenges / tries).toBeGreaterThan(0.3);
    expect(revenges / tries).toBeLessThan(0.37);
  });

  test("with BOTS_REVENGE off no revenge is ever booked", async () => {
    const { em, jobs } = fakeDb();
    const booked = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0.5), revenge: false });
    expect(booked.revenge).toBeNull();
    expect(jobs.map((job) => job.kind)).toEqual(["repair"]);
  });

  test("BOTS_REVENGE is off unless the environment turns it on", async () => {
    const before = process.env.BOTS_REVENGE;
    try {
      delete process.env.BOTS_REVENGE;
      const off = await scheduleAfterBotDefence(fakeDb().em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0.5) });
      expect(off.revenge).toBeNull();
      process.env.BOTS_REVENGE = "on";
      const on = await scheduleAfterBotDefence(fakeDb().em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0.5) });
      expect(on.revenge).toEqual(hoursFrom(12.5));
    } finally {
      if (before === undefined) delete process.env.BOTS_REVENGE;
      else process.env.BOTS_REVENGE = before;
    }
  });

  test("a third revenge on one player in 24 hours is not booked", async () => {
    const { em, jobs, logs } = fakeDb();
    // One bot's revenge landed 2 hours ago, another is booked for 6 hours on.
    logs.push({ attacker_userid: OTHER_BOT, defender_userid: PLAYER, type: "main", attacktime: hoursFrom(-2) });
    jobs.push({ id: 99, bot_userid: THIRD_BOT, kind: "revenge", target_userid: PLAYER, due_at: hoursFrom(6), giveup_at: hoursFrom(60) });
    const booked = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0.2), revenge: true });
    expect(booked.revenge).toBeNull();
    expect(jobs.filter((job) => job.kind === "revenge")).toHaveLength(1);
  });

  test("a real player's attacks on the player never count", async () => {
    const { em, logs } = fakeDb();
    logs.push({ attacker_userid: 500, defender_userid: PLAYER, type: "main", attacktime: hoursFrom(-2) });
    logs.push({ attacker_userid: 501, defender_userid: PLAYER, type: "main", attacktime: hoursFrom(-1) });
    const booked = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0.2), revenge: true });
    expect(booked.revenge).not.toBeNull();
  });

  test("the same bot's revenge on the player 10 hours ago keeps it from booking another", async () => {
    const { em, logs } = fakeDb();
    logs.push({ attacker_userid: BOT, defender_userid: PLAYER, type: "main", attacktime: hoursFrom(-10) });
    // Due 1 hour on: 11 hours after the last one.
    const soon = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0), revenge: true });
    expect(soon.revenge).toBeNull();
    // Due 18.25 hours on: 28.25 hours after it.
    const later = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0.75), revenge: true });
    expect(later.revenge).toEqual(hoursFrom(18.25));
  });

  test("a revenge already booked by this bot on this player stands", async () => {
    const { em, jobs } = fakeDb();
    jobs.push({ id: 99, bot_userid: BOT, kind: "revenge", target_userid: PLAYER, due_at: hoursFrom(-30), giveup_at: hoursFrom(20) });
    const booked = await scheduleAfterBotDefence(em, { bot: BOT, attacker: PLAYER, at: AT, rng: sequence(0, REVENGE, 0.5), revenge: true });
    expect(booked.revenge).toBeNull();
    expect(jobs.filter((job) => job.kind === "revenge")).toEqual([expect.objectContaining({ id: 99 })]);
  });
});
