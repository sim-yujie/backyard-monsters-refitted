import { describe, expect, test } from "bun:test";

import type { RevengeEvent } from "./afterAttack.js";
import {
  BUSY_RETRY_MINUTES,
  capsFreeAt,
  giveupOf,
  PROTECTED_RETRY_HOURS,
  refusedVerdict,
  revengeVerdict,
  slotBusyVerdict,
  SLOT_RETRY_MINUTES,
  underAttackAt,
  type RevengeFacts,
} from "./revenge.js";

/**
 * The revenge job's checks (issue #244, `docs/design/bot-neighbours.md` §4.7
 * step 1, §7.1 and §7.2): what runs, what waits and for how long, and what is
 * given up.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const NOW = 1_790_000_000;
const BOT = 41;
const OTHER_BOT = 42;

/** A revenge booked 10 hours ago that may run now. */
const facts = (overrides: Partial<RevengeFacts> = {}): RevengeFacts => ({
  now: NOW,
  giveupAt: NOW + 62 * HOUR,
  bot: { active: true, underAttack: false },
  target: { onMapRoom1: true, protectedUntil: 0, underAttack: false, online: false },
  truce: false,
  alreadyAvenged: false,
  landed: [],
  ...overrides,
});

const target = (overrides: Partial<NonNullable<RevengeFacts["target"]>>) => ({
  target: { onMapRoom1: true, protectedUntil: 0, underAttack: false, online: false, ...overrides },
});

const landed = (bot: number, hoursAgo: number): RevengeEvent => ({ bot, at: new Date((NOW - hoursAgo * HOUR) * 1000) });

/** The draw at both ends of a band, and in the middle. */
const draws = [0, 0.5, 0.999_999];

describe("revengeVerdict", () => {
  test("everything clear: the revenge runs", () => {
    expect(revengeVerdict(facts(), BOT, Math.random)).toEqual({ act: "run" });
  });

  test("gives up 72 hours after the attack that booked it", () => {
    expect(revengeVerdict(facts({ giveupAt: NOW }), BOT, Math.random)).toEqual({ act: "cancel", reason: "gaveUp" });
    expect(revengeVerdict(facts({ giveupAt: NOW - 1 }), BOT, Math.random)).toEqual({ act: "cancel", reason: "gaveUp" });
  });

  test("a retired or vanished bot, a player gone from Map Room 1, a truce: no revenge", () => {
    expect(revengeVerdict(facts({ bot: { active: false, underAttack: false } }), BOT, Math.random)).toEqual({
      act: "cancel",
      reason: "botRetired",
    });
    expect(revengeVerdict(facts({ bot: null }), BOT, Math.random)).toEqual({ act: "cancel", reason: "botRetired" });
    expect(revengeVerdict(facts(target({ onMapRoom1: false })), BOT, Math.random)).toEqual({
      act: "cancel",
      reason: "targetGone",
    });
    expect(revengeVerdict(facts({ target: null }), BOT, Math.random)).toEqual({ act: "cancel", reason: "targetGone" });
    expect(revengeVerdict(facts({ truce: true }), BOT, Math.random)).toEqual({ act: "cancel", reason: "truce" });
  });

  test("a bot that has already attacked the player since never attacks twice for one attack", () => {
    expect(revengeVerdict(facts({ alreadyAvenged: true }), BOT, Math.random)).toEqual({
      act: "cancel",
      reason: "alreadyAvenged",
    });
  });

  test("online, under attack, or the bot under attack: again in 15-60 minutes", () => {
    for (const [overrides, reason] of [
      [target({ online: true }), "online"],
      [target({ underAttack: true }), "underAttack"],
      [{ bot: { active: true, underAttack: true } }, "botUnderAttack"],
    ] as const) {
      for (const draw of draws) {
        const verdict = revengeVerdict(facts(overrides), BOT, () => draw);
        expect(verdict).toMatchObject({ act: "postpone", reason });
        const due = (verdict as { due: number }).due;
        expect(due).toBeGreaterThanOrEqual(NOW + BUSY_RETRY_MINUTES.min * MINUTE);
        expect(due).toBeLessThanOrEqual(NOW + BUSY_RETRY_MINUTES.max * MINUTE);
      }
    }
  });

  test("protected (new-player, damage or bought): again 1-6 hours after the protection ends", () => {
    const until = NOW + 20 * HOUR;
    for (const draw of draws) {
      const verdict = revengeVerdict(facts(target({ protectedUntil: until, online: true })), BOT, () => draw);
      expect(verdict).toMatchObject({ act: "postpone", reason: "protected" });
      const due = (verdict as { due: number }).due;
      expect(due).toBeGreaterThanOrEqual(until + PROTECTED_RETRY_HOURS.min * HOUR);
      expect(due).toBeLessThanOrEqual(until + PROTECTED_RETRY_HOURS.max * HOUR);
    }
    // Protection that ran out is no protection.
    expect(revengeVerdict(facts(target({ protectedUntil: NOW })), BOT, Math.random)).toEqual({ act: "run" });
  });

  test("a wait that would end at or past the give-up time gives up instead", () => {
    const giveupAt = NOW + 10 * HOUR;
    expect(revengeVerdict(facts({ giveupAt, ...target({ protectedUntil: NOW + 9 * HOUR }) }), BOT, () => 0.5)).toEqual({
      act: "cancel",
      reason: "gaveUp",
    });
    expect(revengeVerdict(facts({ giveupAt: NOW + 10 * MINUTE, ...target({ online: true }) }), BOT, () => 0)).toEqual({
      act: "cancel",
      reason: "gaveUp",
    });
  });

  test("the caps count revenges that happened: 2 on the player and 1 by this bot in any 24 hours", () => {
    // One by another bot: room for one more.
    expect(revengeVerdict(facts({ landed: [landed(OTHER_BOT, 3)] }), BOT, Math.random)).toEqual({ act: "run" });
    // This bot 20 hours ago: the pair's place frees 4 hours from now.
    const pair = revengeVerdict(facts({ landed: [landed(BOT, 20)] }), BOT, () => 0);
    expect(pair).toEqual({ act: "postpone", due: NOW + 4 * HOUR + BUSY_RETRY_MINUTES.min * MINUTE, reason: "caps" });
    // Two by other bots, 10 and 2 hours ago: the first leaves the window in 14 hours.
    const full = revengeVerdict(facts({ landed: [landed(OTHER_BOT, 10), landed(OTHER_BOT + 1, 2)] }), BOT, () => 0);
    expect(full).toEqual({ act: "postpone", due: NOW + 14 * HOUR + BUSY_RETRY_MINUTES.min * MINUTE, reason: "caps" });
  });
});

describe("capsFreeAt", () => {
  test("the first time a landed attack leaves the window and the caps hold", () => {
    expect(capsFreeAt(NOW, BOT, [landed(BOT, 1), landed(OTHER_BOT, 20)])).toBe(NOW + 23 * HOUR);
    expect(capsFreeAt(NOW, BOT, [landed(OTHER_BOT, 1), landed(OTHER_BOT + 1, 20)])).toBe(NOW + 4 * HOUR);
    expect(capsFreeAt(NOW, BOT, [])).toBe(NOW);
  });
});

describe("the runner's answers", () => {
  test("no replay worker free: again in 5 minutes, or give up", () => {
    expect(slotBusyVerdict(NOW, NOW + HOUR)).toEqual({ act: "postpone", due: NOW + SLOT_RETRY_MINUTES * MINUTE, reason: "busy" });
    expect(slotBusyVerdict(NOW, NOW + MINUTE)).toEqual({ act: "cancel", reason: "gaveUp" });
  });

  test("refused by the attack load at the last moment: again in 15-60 minutes, or give up", () => {
    expect(refusedVerdict(NOW, NOW + 2 * HOUR, () => 0)).toEqual({
      act: "postpone",
      due: NOW + BUSY_RETRY_MINUTES.min * MINUTE,
      reason: "refused",
    });
    expect(refusedVerdict(NOW, NOW + 10 * MINUTE, () => 0)).toEqual({ act: "cancel", reason: "gaveUp" });
  });
});

describe("helpers", () => {
  test("under attack is a live attackid whose last attack began under 7 minutes ago", () => {
    expect(underAttackAt({ attackid: 0, attacks: [{ starttime: NOW }] }, NOW)).toBe(false);
    expect(underAttackAt({ attackid: 5, attacks: [{ starttime: NOW - 60 }] }, NOW)).toBe(true);
    expect(underAttackAt({ attackid: 5, attacks: [{ starttime: NOW - 7 * MINUTE }] }, NOW)).toBe(false);
    expect(underAttackAt({ attackid: 5, attacks: [] }, NOW)).toBe(false);
  });

  test("a job without a give-up time gives up 72 hours after it was booked", () => {
    const booked = new Date(NOW * 1000);
    expect(giveupOf(null, booked)).toBe(NOW + 72 * HOUR);
    expect(giveupOf(new Date((NOW + HOUR) * 1000), booked)).toBe(NOW + HOUR);
  });
});
