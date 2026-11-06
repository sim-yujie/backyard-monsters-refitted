import { describe, expect, it, vi } from "vitest";
import { volumeGain } from "./soundVolume";

describe("volumeGain", () => {
  it("squares the slider: 100 full, 70 about -6 dB, 50 a quarter, 0 silent", () => {
    expect(volumeGain(100)).toBe(1);
    expect(volumeGain(70)).toBeCloseTo(0.49);
    expect(20 * Math.log10(volumeGain(70))).toBeCloseTo(-6.2, 1);
    expect(volumeGain(50)).toBeCloseTo(0.25);
    expect(volumeGain(0)).toBe(0);
  });

  it("keeps to 0-1 whatever it is given", () => {
    expect(volumeGain(150)).toBe(1);
    expect(volumeGain(-5)).toBe(0);
    expect(volumeGain(Number.NaN)).toBe(0);
  });
});

describe("sharedAudioContext", () => {
  it("is null, not a crash, where the browser has Web Audio switched off", async () => {
    vi.resetModules();
    const Blocked = vi.fn(function () {
      throw new Error("Web Audio API is disabled due to your security policy");
    });
    vi.stubGlobal("AudioContext", Blocked);
    try {
      const { sharedAudioContext } = await import("./soundVolume");
      expect(sharedAudioContext()).toBeNull();
      // Asked once a page: later sounds stay silent without trying again.
      expect(sharedAudioContext()).toBeNull();
      expect(Blocked).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
