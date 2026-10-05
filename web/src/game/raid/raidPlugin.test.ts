// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { RaidResult } from "@/api/raid";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackSessionState } from "@/game/attack/AttackSession";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { RAID_PLUGINS, createRaidPlugin, raidPlugin } from "./raidPlugin";
import { consumeRaidNote, consumeRaidResult, type RaidRun } from "./raidSession";

/**
 * The raid scene's package (issue #226 WP4): plays the server's waves, says
 * "Don't Panic!", and when the fight ends lands it and opens the yard.
 */

const RESULT: RaidResult = {
  id: "r1",
  tribe: "Kozu",
  at: 1_000,
  defended: false,
  health: 0.5,
  stolen: { r1: 10, r2: 0, r3: 0, r4: 0 },
  shiny: 0,
  damaged: [1],
  housedLost: 0,
};

const run = (): RaidRun =>
  ({
    raid: { id: "r1", phase: "fighting", tribe: "Kozu", monsters: { C2: 3 }, attackAt: 1_000, warned: 1 },
    fight: {
      seed: 7,
      events: [{ kind: "raid", t: 0, x: 900, y: -700, r: 80, monsters: { C2: 3 } }, { kind: "fling", t: 5 }],
      hitLimit: 30,
      tick: 480,
      seconds: 6,
      yard: { buildingdata: {}, buildinghealthdata: {}, resources: {} },
      defence: null,
    },
    save: {},
  }) as unknown as RaidRun;

const fakeSession = () => {
  let phase: AttackSessionState["phase"] = "running";
  const listeners = new Set<(state: AttackSessionState) => void>();
  const state = () => ({ phase }) as AttackSessionState;
  return {
    playScript: vi.fn(),
    state,
    subscribe: (listener: (state: AttackSessionState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    end: () => {
      phase = "ended";
      for (const listener of listeners) listener(state());
    },
  };
};

const mount = (finish: () => Promise<unknown>, withRun = true) => {
  const session = fakeSession();
  const hudSlot = document.createElement("span");
  const goToYard = vi.fn();
  const clearRaid = vi.fn();
  const mounts = { session, hudSlot, goToYard, ...(withRun ? { raid: run() } : {}) } as unknown as AttackMounts;
  const plugin = createRaidPlugin({
    api: { finish: vi.fn(finish) as never },
    serverNow: () => 1_000,
    clearRaid,
    wait: async () => {},
  });
  const teardown = plugin(mounts);
  return { session, hudSlot, goToYard, clearRaid, teardown };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("raidPlugin", () => {
  it("mounts with the battle layer alone", () => {
    expect(RAID_PLUGINS).toEqual([battlePlugin, raidPlugin]);
  });

  it("does nothing on any other attack", () => {
    const { session, hudSlot } = mount(async () => ({}), false);
    expect(session.playScript).not.toHaveBeenCalled();
    expect(hudSlot.children).toHaveLength(0);
  });

  it("plays the server's raid waves only, to its end tick, with Don't Panic!", () => {
    const { session, hudSlot } = mount(async () => ({}));
    expect(session.playScript).toHaveBeenCalledTimes(1);
    const [events, end] = session.playScript.mock.calls[0]!;
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("raid");
    expect(end).toBe(480);
    expect(hudSlot.textContent).toBe("Don't Panic!");
  });

  it("lands the fight when it ends and opens the yard on the result", async () => {
    const t = mount(async () => ({ error: 0, result: RESULT }));
    t.session.end();
    await settle();
    expect(consumeRaidResult()).toEqual(RESULT);
    expect(t.clearRaid).toHaveBeenCalled();
    expect(t.goToYard).toHaveBeenCalledTimes(1);
  });

  it("opens the yard with a line when the raid was called off", async () => {
    const t = mount(async () => {
      throw new ApiError("refused", { status: 409, details: { data: { reason: "cancelled" } } });
    });
    t.session.end();
    await settle();
    expect(consumeRaidResult()).toBeNull();
    expect(consumeRaidNote()).toContain("called off");
    expect(t.goToYard).toHaveBeenCalledTimes(1);
  });

  it("keeps the result but does not leave once the scene has gone", async () => {
    let release: (value: unknown) => void = () => {};
    const t = mount(() => new Promise((resolve) => (release = resolve)));
    t.session.end();
    if (typeof t.teardown === "function") t.teardown();
    release({ error: 0, result: RESULT });
    await settle();
    expect(consumeRaidResult()).toEqual(RESULT);
    expect(t.goToYard).not.toHaveBeenCalled();
    expect(t.hudSlot.children).toHaveLength(0);
  });
});
