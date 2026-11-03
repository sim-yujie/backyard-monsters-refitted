import { describe, expect, it, vi } from "vitest";
import { cachedTiltChoice, loadTiltChoice, rememberTiltChoice, saveTiltChoice, TILT_CHOICE_KEY, UNKNOWN_CHOICE } from "./tiltSetting";

/**
 * The "Tilted map" choice (MR2 look plan step 4): the account holds it, this
 * browser keeps the last answer so the map opens in the right shape at once.
 */

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
};

describe("the tilted map choice", () => {
  it("opens flat on a browser that has never asked the account, with the choice itself on", () => {
    expect(cachedTiltChoice(memory())).toEqual(UNKNOWN_CHOICE);
    expect(UNKNOWN_CHOICE).toEqual({ allowed: false, tilted: true });
  });

  it("keeps the account's last answer in this browser", () => {
    const store = memory();
    rememberTiltChoice({ allowed: true, tilted: false }, store);
    expect(cachedTiltChoice(store)).toEqual({ allowed: true, tilted: false });
  });

  it("shrugs off a broken or missing store", () => {
    expect(cachedTiltChoice(memory({ [TILT_CHOICE_KEY]: "{not json" }))).toEqual(UNKNOWN_CHOICE);
    expect(cachedTiltChoice(null)).toEqual(UNKNOWN_CHOICE);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(cachedTiltChoice(throwing)).toEqual(UNKNOWN_CHOICE);
    expect(() => rememberTiltChoice({ allowed: true, tilted: true }, throwing)).not.toThrow();
  });

  it("asks the account and keeps what it says", async () => {
    const store = memory();
    const fetch = vi.fn().mockResolvedValue({ allowed: true, tilted: true });
    expect(await loadTiltChoice(fetch, store)).toEqual({ allowed: true, tilted: true });
    expect(cachedTiltChoice(store)).toEqual({ allowed: true, tilted: true });
  });

  it("stores a flat map on the account and keeps the server's answer", async () => {
    const store = memory();
    const save = vi.fn().mockResolvedValue({ allowed: true, tilted: false });
    expect(await saveTiltChoice(false, save, store)).toEqual({ allowed: true, tilted: false });
    expect(save).toHaveBeenCalledWith(false);
    expect(cachedTiltChoice(store).tilted).toBe(false);
  });

  it("keeps the old answer when the account cannot be reached", async () => {
    const store = memory();
    rememberTiltChoice({ allowed: true, tilted: true }, store);
    await expect(loadTiltChoice(() => Promise.reject(new Error("offline")), store)).rejects.toThrow();
    expect(cachedTiltChoice(store)).toEqual({ allowed: true, tilted: true });
  });
});
