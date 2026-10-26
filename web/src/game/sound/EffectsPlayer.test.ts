import { describe, expect, it } from "vitest";
import { EFFECTS, EffectsPlayer, MIN_GAP_MS, type EffectsBackend } from "./EffectsPlayer";
import type { GestureTarget } from "./MusicPlayer";

/** A Web Audio stand-in: held back until a press resumes it, files loaded by hand. */
class FakeCard implements EffectsBackend {
  running = false;
  /** Whether `resume` lets sound out: only inside a press, on an iPhone. */
  resumeWorks = true;
  resumes = 0;
  readonly starts: { sound: unknown; volume: number }[] = [];
  readonly pending = new Map<string, { resolve: (sound: unknown) => void; reject: () => void }>();
  readonly loads: string[] = [];
  resume(): Promise<void> {
    this.resumes += 1;
    if (this.resumeWorks) this.running = true;
    return Promise.resolve();
  }
  load(url: string): Promise<unknown> {
    this.loads.push(url);
    return new Promise((resolve, reject) => this.pending.set(url, { resolve, reject: () => reject(new Error("404")) }));
  }
  start(sound: unknown, volume: number): void {
    this.starts.push({ sound, volume });
  }
  /** Finishes every file asked for. */
  async loadAll(): Promise<void> {
    for (const [url, { resolve }] of this.pending) resolve(`decoded ${url}`);
    this.pending.clear();
    await Promise.resolve();
  }
}

class FakePage implements GestureTarget {
  readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  listening(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
  press(type = "pointerdown"): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

const setup = (opened = true) => {
  const page = new FakePage();
  const card = new FakeCard();
  card.running = opened;
  let made = 0;
  const clock = { now: 1_000 };
  const player = new EffectsPlayer({
    createBackend: () => {
      made += 1;
      return card;
    },
    gestures: page,
    now: () => clock.now,
  });
  return { page, card, clock, player, made: () => made };
};

/** A player with sound effects on and both files loaded. */
const ready = async () => {
  const world = setup();
  world.player.setEnabled(true);
  world.player.play("bankfire");
  await world.card.loadAll();
  return world;
};

describe("EffectsPlayer", () => {
  it("plays a collect pop at Flash's volume once its file is in", async () => {
    const { card, player } = await ready();
    expect(player.play("bankfire")).toBe(true);
    expect(card.starts).toEqual([{ sound: `decoded ${EFFECTS.bankfire.url}`, volume: 0.8 }]);
    expect(card.loads).toEqual([EFFECTS.bankfire.url, EFFECTS.bankland.url]);
  });

  it("stays silent, and opens no sound card, with sound effects off", () => {
    const { page, card, player, made } = setup();
    player.setEnabled(false);
    expect(player.play("bankfire")).toBe(false);
    expect(player.play("bankland")).toBe(false);
    page.press();
    expect(made()).toBe(0);
    expect(card.starts).toHaveLength(0);
    expect(page.listening()).toBe(0);
  });

  it("goes silent when sound effects are turned off, and plays again when back on", async () => {
    const { card, clock, player } = await ready();
    player.setEnabled(false);
    expect(player.play("bankland")).toBe(false);
    player.setEnabled(true);
    clock.now += MIN_GAP_MS;
    expect(player.play("bankland")).toBe(true);
    expect(card.starts).toHaveLength(1);
  });

  it("does not start one effect again within the gap, so a big bank does not rattle", async () => {
    const { card, clock, player } = await ready();
    // Collect all on a big yard: forty balls leave in the same frame.
    const started = Array.from({ length: 40 }, () => player.play("bankfire"));
    expect(started.filter(Boolean)).toHaveLength(1);
    // Another effect has a gap of its own.
    expect(player.play("bankland")).toBe(true);
    clock.now += MIN_GAP_MS - 1;
    expect(player.play("bankfire")).toBe(false);
    clock.now += 1;
    expect(player.play("bankfire")).toBe(true);
    expect(card.starts).toHaveLength(3);
  });

  it("drops an effect asked for before its file is in, rather than playing it late", async () => {
    const { card, player } = setup();
    player.setEnabled(true);
    expect(player.play("bankland")).toBe(false);
    await card.loadAll();
    expect(card.starts).toHaveLength(0);
    expect(player.play("bankland")).toBe(true);
  });

  it("asks for a file again after it failed to load", async () => {
    const { card, player } = setup();
    player.setEnabled(true);
    player.play("bankfire");
    for (const { reject } of card.pending.values()) reject();
    card.pending.clear();
    await settle();
    expect(player.play("bankfire")).toBe(false);
    expect(card.loads.filter((url) => url === EFFECTS.bankfire.url)).toHaveLength(2);
    await card.loadAll();
    expect(player.play("bankfire")).toBe(true);
  });

  it("waits for the player's first press while the browser holds sound back, dropping what came before", async () => {
    const { page, card, player, made } = setup(false);
    card.resumeWorks = false;
    player.setEnabled(true);
    expect(player.blocked).toBe(true);
    expect(made()).toBe(0);
    // A pop from the frame loop: not a press, so the browser still says no.
    expect(player.play("bankfire")).toBe(false);
    await card.loadAll();
    await settle();
    expect(player.blocked).toBe(true);
    // The press opens it.
    card.resumeWorks = true;
    page.press("touchend");
    await settle();
    expect(player.blocked).toBe(false);
    expect(page.listening()).toBe(0);
    expect(card.starts).toHaveLength(0);
    expect(player.play("bankfire")).toBe(true);
  });

  it("opens the sound card inside the first press", async () => {
    const { page, card, made, player } = setup(false);
    player.setEnabled(true);
    expect(made()).toBe(0);
    page.press();
    expect(made()).toBe(1);
    expect(card.resumes).toBe(1);
    await settle();
    expect(player.blocked).toBe(false);
  });

  it("listens again when a phone takes sound away later, as a call does", async () => {
    const { page, card, player } = await ready();
    card.running = false;
    card.resumeWorks = false;
    expect(player.play("bankfire")).toBe(false);
    await settle();
    expect(player.blocked).toBe(true);
    card.resumeWorks = true;
    page.press();
    await settle();
    expect(player.play("bankfire")).toBe(true);
  });

  it("does nothing where the browser has no Web Audio", () => {
    const page = new FakePage();
    const player = new EffectsPlayer({ createBackend: () => null, gestures: page });
    player.setEnabled(true);
    page.press();
    expect(player.play("bankfire")).toBe(false);
    expect(page.listening()).toBe(0);
  });
});
