import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { watchEvents, watchRefusal, watchTarget } from "@/game/autoAttack/watchRun";
import manifest from "@/game/combat/rules/MANIFEST.json";
import { fixtureRun, type DefenceReplayFixture } from "./defenceFixture";
import {
  CLIENT_RULES_VERSION,
  DEFENCE_REFUSAL_TEXT,
  defenceDrift,
  defenceReadout,
  defenceRefusal,
  defenceWatchOf,
  logDefenceDrift,
  storedDamageOf,
} from "./defenceWatch";

/**
 * The defence watch source (issue #362, `docs/design/defence-replays.md`
 * §4, §7): whether this client may play a stored defence, the target and
 * roster the watch scene builds from it, and the drift check.
 */

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/defence-replay-mixed-waves.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as DefenceReplayFixture;
const run = (rulesVersion = CLIENT_RULES_VERSION) => fixtureRun(fixture, { rulesVersion });

describe("the version check", () => {
  it("reads the bundle's own rules version from the rules MANIFEST", () => {
    expect(CLIENT_RULES_VERSION).toBe(manifest.version);
    expect(CLIENT_RULES_VERSION).toMatch(/^[0-9a-f]{16}$/);
  });

  it("plays a replay fought under this client's rules that the server also calls playable", () => {
    expect(defenceRefusal({ hasReplay: true, playable: true, rulesVersion: "abc" }, "abc")).toBeNull();
    expect(watchRefusal(run())).toBeNull();
  });

  it("refuses one fought under other rules, whatever the server says", () => {
    expect(defenceRefusal({ hasReplay: true, playable: true, rulesVersion: "old" }, "new")).toBe("update");
    expect(watchRefusal(run("0123456789abcdef"))).toBe("update");
  });

  it("refuses one the server no longer calls playable, for a client that has not reloaded", () => {
    expect(defenceRefusal({ hasReplay: true, playable: false, rulesVersion: "abc" }, "abc")).toBe("update");
  });

  it("refuses one kept without its battle, and a payload of another format", () => {
    expect(defenceRefusal({ hasReplay: false, playable: false, rulesVersion: "abc" }, "abc")).toBe("missing");
    const other = { ...run(), replay: { ...run().replay, v: 2 as unknown as 1 } };
    expect(watchRefusal(other)).toBe("update");
  });

  it("says why in the owner's words", () => {
    expect(DEFENCE_REFUSAL_TEXT.update).toBe("Replay not available after a game update");
    expect(DEFENCE_REFUSAL_TEXT.missing).toBe("Replay not available");
  });

  it("turns an API answer into a run, or a refusal", () => {
    const answer = { defence: run().defence, replay: fixture.replay };
    const ok = defenceWatchOf(answer);
    expect("run" in ok && ok.run.kind).toBe("defence");
    expect(defenceWatchOf(answer, "ffffffffffffffff")).toEqual({ refusal: "update" });
  });
});

describe("the target", () => {
  it("is the player's own yard as fought, with a roster of exactly what the battle flings", () => {
    const target = watchTarget(run());
    expect(target.kind).toBe("main");
    expect(target.name).toBe("Bramble");
    expect(target.load?.buildingdata).toEqual(fixture.replay.load.buildingdata);
    expect(target.roster.monsters).toEqual({ C1: 120, C2: 60, C3: 40, C4: 40, C6: 30, C7: 30, C8: 20 });
    expect(target.roster.levels).toEqual(fixture.replay.levels);
    expect(target.roster.siege).toBeNull();
    // Krallen, as stored, so the battle layer starts the right sheet.
    expect(target.roster.champions).toEqual([expect.objectContaining({ t: 5, l: 5, pl: 2, hp: 62_000, status: 0 })]);
  });

  it("fights at the academy levels the server fought at", () => {
    const target = watchTarget(run());
    expect(target.load?.attackeracademy).toEqual(fixture.replay.levels);
  });

  it("names a flung champion the payload did not store from its fling", () => {
    const bare = { ...run(), replay: { ...run().replay, champion: [] } };
    expect(watchTarget(bare).roster.champions).toEqual([expect.objectContaining({ t: 5, l: 5, pl: 2 })]);
  });

  it("keeps the siege the attacker fought with", () => {
    const sieged = { ...run(), replay: { ...run().replay, siege: { trojan: 1 } } };
    expect(watchTarget(sieged).roster.siege).toEqual({ trojan: 1 });
  });

  it("plays every event the server fought", () => {
    expect(watchEvents(run())).toHaveLength(fixture.replay.events.length);
  });
});

describe("the drift check", () => {
  it("rounds the engine's damage as the server stores it", () => {
    expect(storedDamageOf(72.9)).toBe(72);
    expect(storedDamageOf(-1)).toBe(0);
    expect(storedDamageOf(140)).toBe(100);
    expect(storedDamageOf(Number.NaN)).toBe(0);
  });

  it("is quiet when the engine reaches the stored damage, and names both when it does not", () => {
    const stored = fixture.defence.damageAfter;
    expect(defenceDrift(run(), stored + 0.4, 33_600)).toBeNull();
    expect(defenceDrift(run(), stored - 3, 33_600)).toEqual({
      id: fixture.defence.id,
      rulesVersion: CLIENT_RULES_VERSION,
      stored,
      replayed: stored - 3,
      tick: 33_600,
    });
  });

  it("checks the defender's loss too, when given it, and names both sides of a loot drift", () => {
    const stored = fixture.defence.damageAfter;
    const loot = fixture.defence.loot as { r1: number; r2: number; r3: number; r4: number };
    expect(defenceDrift(run(), stored, 33_600, { ...loot, r1: loot.r1 + 0.7 })).toBeNull();
    const drift = defenceDrift(run(), stored, 33_600, { ...loot, r1: loot.r1 + 5_000 });
    expect(drift).toMatchObject({ stored, replayed: stored, tick: 33_600 });
    expect(drift?.loot).toEqual({ stored: loot, replayed: { ...loot, r1: loot.r1 + 5_000 } });
    // A damage drift alone carries no loot.
    expect(defenceDrift(run(), stored - 3, 33_600, loot)?.loot).toBeUndefined();
  });

  it("logs a drift as defence-replay-drift", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drift = { id: 1, rulesVersion: "abc", stored: 30, replayed: 29, tick: 100 };
    logDefenceDrift(drift);
    expect(warn).toHaveBeenCalledWith("defence-replay-drift", drift);
    warn.mockRestore();
  });
});

describe("the attack strip on a defence replay", () => {
  /** A yard already 20% damaged before the attack, which took it to 55%. */
  const defence = { damageDone: 35, damageAfter: 55, loot: { r1: 1_000, r2: 2_000 } };
  const loss = (r1: number, r2 = 0) => ({ r1, r2, r3: 0, r4: 0 });

  it("reads what the defender has lost so far, not the attacker's gain", () => {
    expect(defenceReadout(defence, 40, loss(612.9, 3), false).loot).toEqual({ r1: 612, r2: 3, r3: 0, r4: 0 });
  });

  it("never reads more of a resource than one attack takes from the pool (10,000,000), playing or over", () => {
    expect(defenceReadout(defence, 40, loss(24_497_189, 9_999_999), false).loot).toEqual({ r1: 10_000_000, r2: 9_999_999, r3: 0, r4: 0 });
    const big = { ...defence, loot: { r1: 34_699_101, r2: 17_677_619 } };
    expect(defenceReadout(big, 55, loss(0), true).loot).toEqual({ r1: 10_000_000, r2: 10_000_000, r3: 0, r4: 0 });
  });

  it("reads this attack's damage alone, not the yard's whole damage", () => {
    expect(defenceReadout(defence, 20, loss(0), false).damage).toBe(0);
    expect(defenceReadout(defence, 40.9, loss(0), false).damage).toBe(20);
    expect(defenceReadout(defence, 55.2, loss(0), false).damage).toBe(35);
    // A yard the engine found a little less damaged than the server did never reads below nothing.
    expect(defenceReadout(defence, 18, loss(0), false).damage).toBe(0);
    expect(defenceReadout(defence, Number.NaN, loss(0), false).damage).toBe(0);
  });

  it("ends on the stored figures, whatever the engine reached", () => {
    expect(defenceReadout(defence, 61, loss(1_300, 1_900), true)).toEqual({
      damage: 35,
      loot: { r1: 1_000, r2: 2_000, r3: 0, r4: 0 },
    });
  });
});
