import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoundSwitches } from "./soundSwitches";

/**
 * `playEffect` follows the player's sound effects switch: the game's own
 * effects player over a stand-in Web Audio.
 */

interface Card {
  made: number;
  starts: number;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const load = async (switches: SoundSwitches | null) => {
  vi.resetModules();
  const card: Card = { made: 0, starts: 0 };
  class FakeContext {
    state = "running";
    destination = {};
    constructor() {
      card.made += 1;
    }
    resume = () => Promise.resolve();
    decodeAudioData = () => Promise.resolve({});
    createGain = () => ({ gain: { value: 1 }, connect: (next: unknown) => next });
    createBufferSource = () => ({
      buffer: null,
      connect: (next: unknown) => next,
      start: () => {
        card.starts += 1;
      },
    });
  }
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
  const switchesModule = await import("./soundSwitches");
  let stored = switches ?? { music: false, effects: false };
  switchesModule.resetSoundSwitchesForTest({
    account: () => 7,
    fetch: () => Promise.resolve(stored),
    save: (change) => {
      stored = { ...stored, ...change };
      return Promise.resolve(stored);
    },
  });
  if (switches) await switchesModule.loadSoundSwitches();
  const { playEffect } = await import("./sound");
  /** Plays twice: the first asks for the file, the second hears it. */
  const pop = async (): Promise<void> => {
    playEffect("bankland");
    await settle();
    playEffect("bankland");
  };
  return { card, pop, setSoundSwitch: switchesModule.setSoundSwitch };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playEffect", () => {
  it("plays with sound effects on", async () => {
    const { card, pop } = await load({ music: false, effects: true });
    await pop();
    expect(card.starts).toBe(1);
  });

  it("stays silent with sound effects off, without opening a sound card", async () => {
    const { card, pop } = await load({ music: true, effects: false });
    await pop();
    expect(card.made).toBe(0);
    expect(card.starts).toBe(0);
  });

  it("stays silent until the switches are known", async () => {
    const { card, pop } = await load(null);
    await pop();
    expect(card.starts).toBe(0);
  });

  it("follows the switch as the player turns it off", async () => {
    const { card, pop, setSoundSwitch } = await load({ music: false, effects: true });
    await pop();
    await setSoundSwitch("effects", false);
    await pop();
    expect(card.starts).toBe(1);
  });
});
