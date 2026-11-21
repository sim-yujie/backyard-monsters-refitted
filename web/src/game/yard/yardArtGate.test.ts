import { describe, expect, it } from "vitest";
import { MUSIC_WAIT_MAX_MS, makeGate, musicGate } from "./yardArtGate";

describe("yardArtGate (beta 9: the yard's pictures first)", () => {
  it("settles once, on the first open", async () => {
    const gate = makeGate();
    let settled = 0;
    void gate.promise.then(() => (settled += 1));
    await Promise.resolve();
    expect(gate.isOpen).toBe(false);
    gate.open();
    gate.open();
    await Promise.resolve();
    expect(gate.isOpen).toBe(true);
    expect(settled).toBe(1);
  });

  it("lets the music go at the gate, or after the longest wait if the gate never opens", async () => {
    const gate = makeGate();
    const waits: number[] = [];
    let timeUp!: () => void;
    let done = false;
    void musicGate(
      (ms) => {
        waits.push(ms);
        return new Promise((resolve) => (timeUp = resolve));
      },
      gate,
    ).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    expect(waits).toEqual([MUSIC_WAIT_MAX_MS]);
    timeUp();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(true);
  });

  it("does not wait at all once the gate is open", async () => {
    const gate = makeGate();
    gate.open();
    const waits: number[] = [];
    await musicGate((ms) => (waits.push(ms), new Promise(() => {})), gate);
    expect(waits).toEqual([]);
  });
});
