import { tuneFile, tuneUrl, type Tune } from "./tunes";

/**
 * Plays one tune at a time, looping, the way Flash's music did
 * (`client/scripts/SOUNDS.as:212-278`): a change of tune fades the old one
 * out over about half a second and starts the new one at its full volume,
 * with no fade-in.
 *
 * It is told two things: which tune the screen wants ({@link want}) and
 * whether the player has music on ({@link setEnabled}). Until both say play,
 * nothing does; turning music off fades the tune out, turning it on starts
 * the screen's tune from the top, as Flash's switch did.
 *
 * Each tune streams through a plain `<audio>` element rather than being
 * unpacked into memory: three minutes of stereo would take about 70 MB on a
 * phone that way. Such an element also keeps playing in a background tab,
 * as the owner wants (answer S10), and does not follow the game's clock, so
 * an attack or a replay at 2x or 4x leaves the music as it is.
 *
 * Browsers refuse to start sound before the player has tapped, clicked or
 * pressed a key on the page. A refused start is not an error: the player
 * listens for the next such press on the whole page and starts the music
 * inside it, with nothing on screen to ask for it.
 */

/** The part of an `HTMLAudioElement` the player uses, so tests can stand one in. */
export interface AudioLike {
  loop: boolean;
  volume: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
}

/** Where the player listens for the press that lets sound start. */
export interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void, options?: EventListenerOptions): void;
}

export interface MusicPlayerOptions {
  readonly createAudio?: (url: string) => AudioLike;
  /** Whether the browser plays Ogg Vorbis; asked of the browser when left out. */
  readonly canPlayOgg?: boolean;
  readonly gestures?: GestureTarget;
  readonly setInterval?: (run: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

/**
 * The presses a browser counts as letting a page make sound. Touch counts on
 * the finger's lift (`pointerup`, `touchend`), a mouse on the press.
 */
export const GESTURE_EVENTS = ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const;

/** Flash's fade: 0.05 a frame (`SOUNDS.as:268`), here every 25 ms, a 40 fps frame. */
const FADE_STEP = 0.05;
const FADE_TICK_MS = 25;

/** Safari on iPhone says no, and gets the MP3. */
const browserPlaysOgg = (): boolean =>
  typeof document !== "undefined" && document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"') !== "";

const defaultAudio = (url: string): AudioLike => {
  const audio = new Audio(url);
  audio.preload = "auto";
  return audio;
};

interface Fading {
  readonly audio: AudioLike;
  readonly handle: unknown;
}

export class MusicPlayer {
  private readonly createAudio: (url: string) => AudioLike;
  private readonly canPlayOgg: boolean;
  private readonly gestures: GestureTarget | null;
  private readonly startTimer: (run: () => void, ms: number) => unknown;
  private readonly stopTimer: (handle: unknown) => void;
  private readonly elements = new Map<Tune, AudioLike>();

  private wanted: Tune | null = null;
  private enabled = false;
  /** The tune playing, or asked to play and waiting for a press. */
  private current: Tune | null = null;
  private fading: Fading[] = [];
  private waitingForGesture = false;

  constructor(options: MusicPlayerOptions = {}) {
    this.createAudio = options.createAudio ?? defaultAudio;
    this.canPlayOgg = options.canPlayOgg ?? browserPlaysOgg();
    this.gestures = options.gestures ?? (typeof document === "undefined" ? null : document);
    this.startTimer = options.setInterval ?? ((run, ms) => setInterval(run, ms));
    this.stopTimer = options.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  }

  /** The tune the screen wants; null for silence. */
  want(tune: Tune | null): void {
    this.wanted = tune;
    this.sync();
  }

  /** The player's music switch. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.sync();
  }

  /** What is playing (or waiting for the first press to), for the dev hook and tests. */
  get playing(): Tune | null {
    return this.current;
  }

  /** True while the browser has refused to start and the player waits for a press. */
  get blocked(): boolean {
    return this.waitingForGesture;
  }

  /** Stops everything at once and lets go of every listener. */
  destroy(): void {
    this.stopListening();
    for (const fade of this.fading) {
      this.stopTimer(fade.handle);
      fade.audio.pause();
    }
    this.fading = [];
    if (this.current) this.elements.get(this.current)?.pause();
    this.current = null;
  }

  private sync(): void {
    const next = this.enabled ? this.wanted : null;
    if (next === this.current) return;
    if (this.current) this.fadeOut(this.current);
    this.current = next;
    if (next) this.start(next);
    else this.stopListening();
  }

  private element(tune: Tune): AudioLike {
    let audio = this.elements.get(tune);
    if (!audio) {
      audio = this.createAudio(tuneUrl(tuneFile(tune), this.canPlayOgg));
      audio.loop = true;
      this.elements.set(tune, audio);
    }
    return audio;
  }

  private start(tune: Tune): void {
    const audio = this.element(tune);
    // A tune still fading out from a moment ago starts over at full volume.
    this.cancelFade(audio);
    audio.volume = tuneFile(tune).volume;
    audio.currentTime = 0;
    this.attempt(tune);
  }

  /** Asks the browser to play the current tune; a refusal waits for the next press. */
  private attempt(tune: Tune): void {
    let started: Promise<void>;
    try {
      started = this.element(tune).play();
    } catch {
      this.listen();
      return;
    }
    started.then(
      () => {
        if (this.current === tune) this.stopListening();
      },
      () => {
        if (this.current === tune) this.listen();
      },
    );
  }

  private readonly onGesture = (): void => {
    if (this.current) this.attempt(this.current);
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

  /**
   * Turns a tune down step by step and pauses it at the end. The steps are
   * counted, not read back from the volume: iOS ignores a page's volume, and
   * there the tune simply stops when the fade would have ended.
   */
  private fadeOut(tune: Tune): void {
    const audio = this.elements.get(tune);
    if (!audio) return;
    this.cancelFade(audio);
    const from = audio.volume;
    let steps = Math.max(1, Math.ceil(from / FADE_STEP));
    const handle = this.startTimer(() => {
      steps -= 1;
      if (steps <= 0) {
        this.cancelFade(audio);
        audio.pause();
        return;
      }
      audio.volume = Math.max(0, Math.min(1, steps * FADE_STEP));
    }, FADE_TICK_MS);
    this.fading.push({ audio, handle });
  }

  private cancelFade(audio: AudioLike): void {
    const fade = this.fading.find((entry) => entry.audio === audio);
    if (!fade) return;
    this.stopTimer(fade.handle);
    this.fading = this.fading.filter((entry) => entry !== fade);
  }
}
