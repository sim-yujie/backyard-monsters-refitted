import { afterEach, describe, expect, it, vi } from "vitest";
import { GESTURE_EVENTS, MusicPlayer, defaultAudio, type AudioLike, type GestureTarget } from "./MusicPlayer";
import { TUNES } from "./tunes";

/** An `<audio>` stand-in: `play` resolves, or rejects while the browser blocks sound. */
class FakeAudio implements AudioLike {
  loop = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  plays = 0;
  constructor(
    readonly url: string,
    private readonly page: FakePage,
  ) {}
  play(): Promise<void> {
    this.plays += 1;
    if (this.page.blocked) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

class FakePage implements GestureTarget {
  blocked = false;
  readonly listeners = new Map<string, Set<() => void>>();
  readonly audios: FakeAudio[] = [];
  timers: { run: () => void; live: boolean }[] = [];
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
  /** Runs every live fade timer once. */
  tick(times = 1): void {
    for (let i = 0; i < times; i += 1) for (const timer of this.timers.filter((t) => t.live)) timer.run();
  }
  player(canPlayOgg = false): MusicPlayer {
    return new MusicPlayer({
      canPlayOgg,
      createAudio: (url) => {
        const audio = new FakeAudio(url, this);
        this.audios.push(audio);
        return audio;
      },
      gestures: this,
      setInterval: (run) => {
        const timer = { run, live: true };
        this.timers.push(timer);
        return timer;
      },
      clearInterval: (handle) => {
        (handle as { live: boolean }).live = false;
      },
    });
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const audioFor = (page: FakePage, url: string) => page.audios.find((audio) => audio.url === url);

describe("MusicPlayer", () => {
  it("plays nothing until the screen wants a tune and music is on", async () => {
    const page = new FakePage();
    const player = page.player();
    player.want("yard");
    expect(page.audios).toHaveLength(0);
    player.setEnabled(true);
    await settle();
    const yard = audioFor(page, TUNES.yard.url)!;
    expect(yard.paused).toBe(false);
    expect(yard.loop).toBe(true);
    expect(yard.volume).toBe(0.6);
    expect(player.playing).toBe("yard");
  });

  it("fades the old tune out and starts the new one at Flash's volume", async () => {
    const page = new FakePage();
    const player = page.player();
    player.setEnabled(true);
    player.want("yard");
    await settle();
    player.want("attack");
    await settle();
    const yard = audioFor(page, TUNES.yard.url)!;
    const attack = audioFor(page, TUNES.attack.url)!;
    expect(attack.paused).toBe(false);
    expect(attack.volume).toBe(0.7);
    expect(yard.paused).toBe(false);
    page.tick(3);
    expect(yard.volume).toBeLessThan(0.6);
    page.tick(20);
    expect(yard.paused).toBe(true);
    expect(page.timers.every((timer) => !timer.live)).toBe(true);
  });

  it("the fade ends on its count even where the page cannot change the volume (iOS)", async () => {
    const page = new FakePage();
    const player = page.player();
    player.setEnabled(true);
    player.want("yard");
    await settle();
    const yard = audioFor(page, TUNES.yard.url)!;
    Object.defineProperty(yard, "volume", { get: () => 1, set: () => {} });
    player.want(null);
    page.tick(30);
    expect(yard.paused).toBe(true);
  });

  it("turning music off stops it; turning it back on starts the screen's tune from the top", async () => {
    const page = new FakePage();
    const player = page.player();
    player.setEnabled(true);
    player.want("yard");
    await settle();
    const yard = audioFor(page, TUNES.yard.url)!;
    yard.currentTime = 30;
    player.setEnabled(false);
    expect(player.playing).toBeNull();
    page.tick(20);
    expect(yard.paused).toBe(true);
    player.setEnabled(true);
    await settle();
    expect(yard.paused).toBe(false);
    expect(yard.currentTime).toBe(0);
    expect(yard.volume).toBe(0.6);
  });

  it("the same tune asked for again keeps playing where it is", async () => {
    const page = new FakePage();
    const player = page.player();
    player.setEnabled(true);
    player.want("yard");
    await settle();
    const yard = audioFor(page, TUNES.yard.url)!;
    yard.currentTime = 12;
    player.want("yard");
    expect(yard.currentTime).toBe(12);
    expect(yard.plays).toBe(1);
  });

  it("a blocked start waits for the first press, then starts inside it and stops listening", async () => {
    const page = new FakePage();
    page.blocked = true;
    const player = page.player();
    player.setEnabled(true);
    player.want("yard");
    await settle();
    expect(player.blocked).toBe(true);
    expect(page.listening()).toBe(GESTURE_EVENTS.length);
    page.blocked = false;
    page.press("pointerup");
    await settle();
    expect(audioFor(page, TUNES.yard.url)!.paused).toBe(false);
    expect(player.blocked).toBe(false);
    expect(page.listening()).toBe(0);
  });

  it("a press after the screen changed starts the new screen's tune", async () => {
    const page = new FakePage();
    page.blocked = true;
    const player = page.player();
    player.setEnabled(true);
    player.want("yard");
    await settle();
    player.want("attack");
    await settle();
    page.blocked = false;
    page.press("keydown");
    await settle();
    expect(audioFor(page, TUNES.attack.url)!.paused).toBe(false);
    expect(audioFor(page, TUNES.yard.url)!.paused).toBe(true);
  });

  it("streams the Ogg copy where the browser plays Ogg, the MP3 where it does not (iPhone)", async () => {
    for (const canPlayOgg of [true, false]) {
      const page = new FakePage();
      const player = page.player(canPlayOgg);
      player.setEnabled(true);
      player.want("yard");
      player.want("attack");
      await settle();
      expect(page.audios.map((audio) => audio.url)).toEqual([
        canPlayOgg ? TUNES.yard.ogg : TUNES.yard.url,
        TUNES.attack.url,
      ]);
    }
  });

  it("silence stops listening for a press", async () => {
    const page = new FakePage();
    page.blocked = true;
    const player = page.player();
    player.setEnabled(true);
    player.want("yard");
    await settle();
    player.want(null);
    expect(page.listening()).toBe(0);
  });

  it("destroy pauses everything and lets go of the listeners", async () => {
    const page = new FakePage();
    page.blocked = true;
    const player = page.player();
    player.setEnabled(true);
    player.want("underAttack");
    await settle();
    player.destroy();
    expect(page.listening()).toBe(0);
    expect(page.audios.every((audio) => audio.paused)).toBe(true);
  });
});

describe("MusicPlayer volume (the music slider)", () => {
  it("plays each tune at its Flash volume times the slider's gain, and follows a move at once", async () => {
    const page = new FakePage();
    const player = page.player();
    player.setVolume(0.49);
    player.want("attack");
    player.setEnabled(true);
    await settle();
    const audio = page.audios[0]!;
    expect(audio.volume).toBeCloseTo(TUNES.attack.volume * 0.49);
    player.setVolume(1);
    expect(audio.volume).toBeCloseTo(TUNES.attack.volume);
    player.setVolume(Number.NaN);
    expect(audio.volume).toBe(0);
    player.destroy();
  });

  it("fades out from the level it set, in steps", async () => {
    const page = new FakePage();
    const player = page.player();
    player.setVolume(0.25);
    player.want("attack");
    player.setEnabled(true);
    await settle();
    const audio = page.audios[0]!;
    player.setEnabled(false);
    // 0.7 x 0.25 = 0.175: four steps of 0.05 down, then paused.
    page.tick(3);
    expect(audio.paused).toBe(false);
    expect(audio.volume).toBeCloseTo(0.05);
    page.tick(1);
    expect(audio.paused).toBe(true);
    // A move while it fades leaves the fade alone.
    player.setVolume(1);
    expect(audio.volume).toBeCloseTo(0.05);
    player.destroy();
  });

  it("where the page's volume is ignored, sets the level on the route's gain and resumes it in the press", async () => {
    const page = new FakePage();
    const levels: number[] = [];
    let running = false;
    let resumes = 0;
    const player = new MusicPlayer({
      canPlayOgg: false,
      createAudio: (url) => {
        const audio = new FakeAudio(url, page);
        page.audios.push(audio);
        return audio;
      },
      gestures: page,
      setInterval: () => ({ live: true }),
      clearInterval: () => {},
      route: () => ({
        setLevel: (level) => levels.push(level),
        get running() {
          return running;
        },
        resume: () => {
          resumes += 1;
        },
      }),
    });
    player.setVolume(0.49);
    player.want("attack");
    player.setEnabled(true);
    await settle();
    const audio = page.audios[0]!;
    expect(audio.volume).toBe(1);
    expect(levels.at(-1)).toBeCloseTo(TUNES.attack.volume * 0.49);
    // The element plays, but into a context still held back: it waits for a press.
    expect(resumes).toBe(1);
    expect(page.listening()).toBeGreaterThan(0);
    running = true;
    page.press();
    await settle();
    expect(resumes).toBe(2);
    expect(page.listening()).toBe(0);
    player.setVolume(1);
    expect(levels.at(-1)).toBeCloseTo(TUNES.attack.volume);
    player.destroy();
  });
});

describe("the music element (art from another address, VITE_ART_URL)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks with CORS, set before the address so the first download already has it", () => {
    const steps: string[] = [];
    class FakeAudio {
      constructor(url?: string) {
        if (url !== undefined) steps.push(`constructed with ${url}`);
      }
      set crossOrigin(value: string) {
        steps.push(`crossOrigin=${value}`);
      }
      set preload(value: string) {
        steps.push(`preload=${value}`);
      }
      set src(value: string) {
        steps.push(`src=${value}`);
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    defaultAudio("https://cdn.example.test/assets/sounds/music/yard-theme.mp3");
    expect(steps).toEqual([
      "crossOrigin=anonymous",
      "preload=auto",
      "src=https://cdn.example.test/assets/sounds/music/yard-theme.mp3",
    ]);
  });
});

describe("MusicPlayer behind a gate (beta 9: the yard's pictures first)", () => {
  const gated = (page: FakePage, gate: Promise<void>, asked: { n: number }) =>
    new MusicPlayer({
      canPlayOgg: false,
      createAudio: (url) => {
        const audio = new FakeAudio(url, page);
        page.audios.push(audio);
        return audio;
      },
      gestures: page,
      gate: () => {
        asked.n += 1;
        return gate;
      },
    });

  it("downloads nothing until the gate opens, then starts the tune the screen wants by then", async () => {
    const page = new FakePage();
    let open!: () => void;
    const asked = { n: 0 };
    const player = gated(page, new Promise<void>((resolve) => (open = resolve)), asked);
    player.setEnabled(true);
    player.want("yard");
    player.want("attack");
    await settle();
    expect(page.audios).toHaveLength(0);
    expect(asked.n).toBe(1);
    open();
    await settle();
    expect(page.audios).toHaveLength(1);
    expect(page.audios[0]?.url).toBe(TUNES.attack.url);
    expect(page.audios[0]?.paused).toBe(false);
    // Once open, a change of tune starts at once.
    player.want("yard");
    await settle();
    expect(page.audios).toHaveLength(2);
  });

  it("starts nothing when the music was turned off while it waited", async () => {
    const page = new FakePage();
    let open!: () => void;
    const player = gated(page, new Promise<void>((resolve) => (open = resolve)), { n: 0 });
    player.setEnabled(true);
    player.want("yard");
    player.setEnabled(false);
    open();
    await settle();
    expect(page.audios).toHaveLength(0);
  });
});
