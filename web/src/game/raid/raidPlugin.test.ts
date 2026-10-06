// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { RaidResult } from "@/api/raid";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackSessionState } from "@/game/attack/AttackSession";
import { battlePlugin } from "@/game/attack/plugins/battle";
import { TROJAN_HORSE_TYPE } from "@/game/trojan/trojanHorse";
import { TRAP_BANNER, TRAP_BANNER_MS } from "@/game/trojan/trojanText";
import { DOOR_OPEN_MS, RAID_PLUGINS, createRaidPlugin, raidPlugin } from "./raidPlugin";
import { consumeRaidNote, consumeRaidResult, type RaidRun } from "./raidSession";
import { DONT_PANIC } from "./raidText";

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

const run = (trojan = false): RaidRun =>
  ({
    raid: { id: "r1", phase: "fighting", tribe: "Kozu", monsters: { C2: 3 }, attackAt: 1_000, warned: 1 },
    fight: {
      seed: 7,
      events: [{ kind: "raid", t: 0, x: 900, y: -700, r: 80, monsters: { C2: 3 } }, { kind: "fling", t: 5 }],
      tick: 480,
      seconds: 6,
      yard: { buildingdata: {}, buildinghealthdata: {}, resources: {} },
      defence: null,
    },
    save: {},
    ...(trojan ? { trojan: true } : {}),
  }) as unknown as RaidRun;

const fakeSession = () => {
  let phase: AttackSessionState["phase"] = "running";
  let tick = 0;
  const listeners = new Set<(state: AttackSessionState) => void>();
  const state = () => ({ phase, tick }) as AttackSessionState;
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
    /** Moves the playback's tick forward, as `advance` would each frame. */
    advanceTick: (next: number) => {
      tick = next;
      for (const listener of listeners) listener(state());
    },
  };
};

const mount = (
  finish: () => Promise<unknown>,
  withRun = true,
  theRun: RaidRun = run(),
  renderer: { setAnimFrame: ReturnType<typeof vi.fn>; yardToWorld: ReturnType<typeof vi.fn> } = {
    setAnimFrame: vi.fn(),
    yardToWorld: vi.fn(),
  },
) => {
  const session = fakeSession();
  const hudSlot = document.createElement("span");
  const goToYard = vi.fn();
  const clearRaid = vi.fn();
  const mounts = {
    session,
    hudSlot,
    goToYard,
    renderer,
    ...(withRun ? { raid: theRun } : {}),
  } as unknown as AttackMounts;
  const plugin = createRaidPlugin({
    api: { finish: vi.fn(finish) as never },
    serverNow: () => 1_000,
    clearRaid,
    wait: async () => {},
  });
  const teardown = plugin(mounts);
  return { session, hudSlot, goToYard, clearRaid, renderer, teardown };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const HORSE_ID = 5;

const trojanRunWithHorse = (): RaidRun =>
  ({
    raid: { id: "r1", phase: "fighting", tribe: "wild", monsters: { C1: 2 }, attackAt: 1_000, warned: 1 },
    fight: {
      seed: 7,
      events: [
        { kind: "raid", t: 0, x: 820, y: -592, r: 0, monsters: { C1: 1 } },
        { kind: "raid", t: 40, x: 820, y: -592, r: 0, monsters: { C1: 1 } },
      ],
      tick: 960,
      seconds: 46,
      yard: {
        buildingdata: { [HORSE_ID]: { X: 0, Y: 0, t: TROJAN_HORSE_TYPE, id: HORSE_ID } },
        buildinghealthdata: {},
        resources: {},
      },
      defence: null,
    },
    save: {},
    trojan: true,
  }) as unknown as RaidRun;

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

  it("shows the trap banner before Don't Panic! on a Trojan Horse's fight (#327)", () => {
    vi.useFakeTimers();
    try {
      const t = mount(async () => ({}), true, run(true));
      expect(t.hudSlot.textContent).toBe(TRAP_BANNER);
      expect(t.session.playScript).not.toHaveBeenCalled();

      vi.advanceTimersByTime(TRAP_BANNER_MS);

      expect(t.session.playScript).toHaveBeenCalledTimes(1);
      expect(t.hudSlot.textContent).toBe(DONT_PANIC);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the belly door on each spawn and closes it shortly after (#327)", () => {
    vi.useFakeTimers();
    try {
      const t = mount(async () => ({}), true, trojanRunWithHorse());
      vi.advanceTimersByTime(TRAP_BANNER_MS); // the trap banner clears, the fight starts playing

      t.session.advanceTick(0); // the first wave's tick
      expect(t.renderer.setAnimFrame).toHaveBeenCalledTimes(1);
      expect(t.renderer.setAnimFrame).toHaveBeenLastCalledWith(HORSE_ID, 0, 1);

      vi.advanceTimersByTime(DOOR_OPEN_MS);
      expect(t.renderer.setAnimFrame).toHaveBeenCalledTimes(2);
      expect(t.renderer.setAnimFrame).toHaveBeenLastCalledWith(HORSE_ID, 0, 0);

      t.session.advanceTick(40); // the second wave's tick
      expect(t.renderer.setAnimFrame).toHaveBeenCalledTimes(3);
      expect(t.renderer.setAnimFrame).toHaveBeenLastCalledWith(HORSE_ID, 0, 1);

      vi.advanceTimersByTime(DOOR_OPEN_MS);
      expect(t.renderer.setAnimFrame).toHaveBeenCalledTimes(4);
      expect(t.renderer.setAnimFrame).toHaveBeenLastCalledWith(HORSE_ID, 0, 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never touches the door on a plain wild raid (no horse on the fight's yard)", () => {
    const t = mount(async () => ({}));
    t.session.advanceTick(480);
    expect(t.renderer.setAnimFrame).not.toHaveBeenCalled();
  });
});
