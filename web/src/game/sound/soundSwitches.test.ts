import { afterEach, describe, expect, it } from "vitest";
import {
  loadSoundSwitches,
  onSoundSwitches,
  resetSoundSwitchesForTest,
  setSoundSwitch,
  soundSwitches,
  type SoundSwitches,
} from "./soundSwitches";

interface Fake {
  account: number | null;
  stored: SoundSwitches;
  fetches: number;
  saves: Partial<SoundSwitches>[];
  failSave: boolean;
  release: (() => void) | null;
  holdFetch: boolean;
}

const fake = (stored: SoundSwitches = { music: true, effects: true }): Fake => {
  const state: Fake = { account: 7, stored, fetches: 0, saves: [], failSave: false, release: null, holdFetch: false };
  resetSoundSwitchesForTest({
    account: () => state.account,
    fetch: () => {
      state.fetches += 1;
      const answer = { ...state.stored };
      if (!state.holdFetch) return Promise.resolve(answer);
      return new Promise((resolve) => {
        state.release = () => resolve(answer);
      });
    },
    save: async (change) => {
      state.saves.push(change);
      if (state.failSave) throw new Error("offline");
      state.stored = { ...state.stored, ...change };
      return { ...state.stored };
    },
  });
  return state;
};

afterEach(() => resetSoundSwitchesForTest());

describe("soundSwitches", () => {
  it("is unknown until read, and read once per account", async () => {
    const server = fake({ music: false, effects: true });
    expect(soundSwitches()).toBeNull();
    await Promise.all([loadSoundSwitches(), loadSoundSwitches()]);
    await loadSoundSwitches();
    expect(soundSwitches()).toEqual({ music: false, effects: true });
    expect(server.fetches).toBe(1);
  });

  it("forgets on sign-out and reads again for the next account", async () => {
    const server = fake();
    await loadSoundSwitches();
    server.account = null;
    await loadSoundSwitches();
    expect(soundSwitches()).toBeNull();
    server.account = 8;
    server.stored = { music: false, effects: false };
    await loadSoundSwitches();
    expect(soundSwitches()).toEqual({ music: false, effects: false });
    expect(server.fetches).toBe(2);
  });

  it("a change shows at once, is saved with only that switch, and tells listeners", async () => {
    const server = fake();
    await loadSoundSwitches();
    const seen: (SoundSwitches | null)[] = [];
    onSoundSwitches((switches) => seen.push(switches));
    const saving = setSoundSwitch("music", false);
    expect(soundSwitches()).toEqual({ music: false, effects: true });
    await saving;
    expect(server.saves).toEqual([{ music: false }]);
    expect(seen.at(-1)).toEqual({ music: false, effects: true });
  });

  it("a failed save puts the switch back and rejects", async () => {
    const server = fake();
    await loadSoundSwitches();
    server.failSave = true;
    await expect(setSoundSwitch("effects", false)).rejects.toThrow("offline");
    expect(soundSwitches()).toEqual({ music: true, effects: true });
  });

  it("a read still out when the player flips a switch does not undo the flip", async () => {
    const server = fake({ music: true, effects: true });
    server.holdFetch = true;
    const reading = loadSoundSwitches();
    await setSoundSwitch("music", false);
    server.release?.();
    await reading;
    expect(soundSwitches()).toEqual({ music: false, effects: true });
  });

  it("a failed read stays unknown and is tried again", async () => {
    const server = fake();
    resetSoundSwitchesForTest({
      account: () => 7,
      fetch: () => {
        server.fetches += 1;
        return server.fetches === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(server.stored);
      },
      save: async () => server.stored,
    });
    await loadSoundSwitches();
    expect(soundSwitches()).toBeNull();
    await loadSoundSwitches();
    expect(soundSwitches()).toEqual({ music: true, effects: true });
  });
});
