import { GESTURE_EVENTS, type GestureTarget } from "./MusicPlayer";

/**
 * Plays the game's short sound effects, the way Flash's `SOUNDS.Play` did
 * (`client/scripts/SOUNDS.as:243-256`): each one fire-and-forget, at Flash's
 * default volume of 0.8, never while the player has sound effects off.
 *
 * The first effects are the collect sounds (owner, 2026-10-26): every
 * resource ball a bank throws pops as it leaves the harvester (`bankfire`)
 * and plops as it lands on the Town Hall (`bankland`), from
 * `ResourcePackage.as:36-43,97-103`. The files are Flash's own, which the
 * game server already serves under `/assets/sounds/uisounds/`. On the
 * Inferno yard the balls make the Inferno's own pair (`ibankfire`,
 * `ibankland`, under `/assets/sounds/infernosounds/`), as Flash's did on
 * `BASE.isInfernoMainYardOrOutpost` (Inferno WP 7.2).
 *
 * **Not a burst.** Flash let one sound start at most three times at once and
 * then about once a frame (`SOUNDS.as:245-246,258-262`), so Collect all on a
 * big yard rattled. Here an effect does not start again within
 * {@link MIN_GAP_MS} of its last start: Collect all on forty harvesters
 * sounds like one harvester banking, and a pop or two never stack.
 *
 * Effects go through Web Audio rather than `<audio>` elements: they overlap
 * freely, start on time from the frame loop, and the two files are a few KB
 * decoded. Browsers hold Web Audio back until the player has tapped, clicked
 * or pressed a key, as they do music (`MusicPlayer.ts`); until then the
 * player listens for the next such press on the whole page and starts the
 * sound inside it. An effect asked for while sound is held back is dropped,
 * not saved up, so nothing goes off late in a heap.
 */

export type Effect = "bankfire" | "bankland" | "ibankfire" | "ibankland";

export interface EffectFile {
  readonly url: string;
  /** Flash's volume for it: `SOUNDS.Play`'s default. */
  readonly volume: number;
}

export const EFFECTS: Readonly<Record<Effect, EffectFile>> = {
  bankfire: { url: "/assets/sounds/uisounds/sound_bankfire.mp3", volume: 0.8 },
  bankland: { url: "/assets/sounds/uisounds/sound_bankland.mp3", volume: 0.8 },
  ibankfire: { url: "/assets/sounds/infernosounds/sound_ibankfire.mp3", volume: 0.8 },
  ibankland: { url: "/assets/sounds/infernosounds/sound_ibankland.mp3", volume: 0.8 },
};

/** The least time between two starts of one effect: two Flash frames at 40 fps. */
export const MIN_GAP_MS = 50;

/** The sound card, as the player uses it: Web Audio in the browser, a stand-in in tests. */
export interface EffectsBackend {
  /** False while the browser holds sound back (suspended, or interrupted on iOS). */
  readonly running: boolean;
  resume(): Promise<void>;
  /** Fetches and decodes one file. */
  load(url: string): Promise<unknown>;
  /** Starts a decoded file once, at `volume`. */
  start(sound: unknown, volume: number): void;
}

export interface EffectsPlayerOptions {
  /** Made on first need; null where the browser has no Web Audio. */
  readonly createBackend?: () => EffectsBackend | null;
  readonly gestures?: GestureTarget;
  /** Milliseconds, for the gap between starts. */
  readonly now?: () => number;
}

type WebkitWindow = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

const webAudio = (): EffectsBackend | null => {
  const Context = globalThis.AudioContext ?? (globalThis as WebkitWindow).webkitAudioContext;
  if (!Context) return null;
  const context = new Context();
  return {
    get running() {
      return context.state === "running";
    },
    resume: () => context.resume(),
    load: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return context.decodeAudioData(await response.arrayBuffer());
    },
    start(sound, volume) {
      const source = context.createBufferSource();
      source.buffer = sound as AudioBuffer;
      const gain = context.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(context.destination);
      source.start();
    },
  };
};

export class EffectsPlayer {
  private readonly createBackend: () => EffectsBackend | null;
  private readonly gestures: GestureTarget | null;
  private readonly now: () => number;
  private backend: EffectsBackend | null = null;
  private made = false;
  private readonly sounds = new Map<Effect, unknown>();
  private readonly loading = new Set<Effect>();
  private readonly lastStart = new Map<Effect, number>();
  private enabled = false;
  private waitingForGesture = false;

  constructor(options: EffectsPlayerOptions = {}) {
    this.createBackend = options.createBackend ?? webAudio;
    this.gestures = options.gestures ?? (typeof document === "undefined" ? null : document);
    this.now = options.now ?? (() => performance.now());
  }

  /** The player's sound effects switch. Off, nothing plays and no sound card is opened. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopListening();
    else if (!this.backend?.running) this.listen();
  }

  /** True while the browser holds sound back and the player waits for a press. */
  get blocked(): boolean {
    return this.waitingForGesture;
  }

  /** Starts `effect` now; false when it stays silent (off, held back, not loaded yet or just played). */
  play(effect: Effect): boolean {
    if (!this.enabled) return false;
    const backend = this.open();
    if (!backend) return false;
    if (!backend.running) {
      this.unlock();
      return false;
    }
    const sound = this.sounds.get(effect);
    if (sound === undefined) {
      this.load(effect);
      return false;
    }
    const now = this.now();
    const last = this.lastStart.get(effect);
    if (last !== undefined && now - last < MIN_GAP_MS) return false;
    this.lastStart.set(effect, now);
    backend.start(sound, EFFECTS[effect].volume);
    return true;
  }

  /** Lets go of the page's listeners. */
  destroy(): void {
    this.stopListening();
  }

  /** The sound card, opened on first need, with every effect's file asked for. */
  private open(): EffectsBackend | null {
    if (!this.made) {
      this.made = true;
      this.backend = this.createBackend();
      if (this.backend) for (const effect of Object.keys(EFFECTS) as Effect[]) this.load(effect);
    }
    return this.backend;
  }

  private load(effect: Effect): void {
    const backend = this.backend;
    if (!backend || this.sounds.has(effect) || this.loading.has(effect)) return;
    this.loading.add(effect);
    backend.load(EFFECTS[effect].url).then(
      (sound) => {
        this.loading.delete(effect);
        this.sounds.set(effect, sound);
      },
      // Asked for again on the effect's next play.
      () => this.loading.delete(effect),
    );
  }

  /** Asks the browser to let sound out; a refusal waits for the next press. */
  private unlock(): void {
    const backend = this.backend;
    if (!backend) return;
    this.listen();
    backend.resume().then(
      () => {
        if (backend.running) this.stopListening();
      },
      () => {},
    );
  }

  private readonly onGesture = (): void => {
    if (!this.enabled) {
      this.stopListening();
      return;
    }
    // Opened inside the press, which iPhones want.
    if (this.open()) this.unlock();
    else this.stopListening();
  };

  private listen(): void {
    if (this.waitingForGesture || !this.gestures) return;
    this.waitingForGesture = true;
    for (const type of GESTURE_EVENTS) {
      this.gestures.addEventListener(type, this.onGesture, { capture: true, passive: true });
    }
  }

  private stopListening(): void {
    if (!this.waitingForGesture || !this.gestures) return;
    this.waitingForGesture = false;
    for (const type of GESTURE_EVENTS) {
      this.gestures.removeEventListener(type, this.onGesture, { capture: true });
    }
  }
}
