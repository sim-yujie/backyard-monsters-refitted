import { lightMusic } from "@/game/quality";
import { pageVolumeIgnored, sharedAudioContext } from "./soundVolume";
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
 *
 * **The music slider** ({@link MusicPlayer.setVolume}, owner 4 Nov 2026)
 * scales each tune's Flash volume. Safari on iPhone and iPad ignores a
 * page's `audio.volume`, so there (`pageVolumeIgnored`) each tune's element
 * is routed through a Web Audio gain on the page's shared context instead
 * ({@link MusicRoute}): the slider and the fades work there too. The cost:
 * that context is held back until a press like any other sound, and iOS
 * stops it when the page goes to the background.
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

/** A tune's element routed through a Web Audio gain (iPhone, iPad). */
export interface MusicRoute {
  /** The gain the tune plays at, 0-1. */
  setLevel(level: number): void;
  /** False while the browser holds the context back. */
  readonly running: boolean;
  /** Asks for the context to run; inside a press, that is allowed. */
  resume(): void;
}

/** The Web Audio route, made where the page's volume is ignored; null elsewhere. */
const defaultRoute = (audio: AudioLike): MusicRoute | null => {
  if (!pageVolumeIgnored()) return null;
  const context = sharedAudioContext();
  if (!context || typeof HTMLMediaElement === "undefined" || !(audio instanceof HTMLMediaElement)) return null;
  try {
    const gain = context.createGain();
    context.createMediaElementSource(audio).connect(gain).connect(context.destination);
    return {
      setLevel: (level) => {
        gain.gain.value = level;
      },
      get running() {
        return context.state === "running";
      },
      resume: () => {
        context.resume().catch(() => {});
      },
    };
  } catch {
    return null;
  }
};

export interface MusicPlayerOptions {
  readonly createAudio?: (url: string) => AudioLike;
  /** Whether the browser plays Ogg Vorbis; asked of the browser when left out. */
  readonly canPlayOgg?: boolean;
  /** Whether to stream a tune's lighter copy: the Quality setting's, when left out. */
  readonly light?: () => boolean;
  readonly gestures?: GestureTarget;
  readonly setInterval?: (run: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  /** Routes a new element through a gain; the Web Audio route on iOS when left out. */
  readonly route?: (audio: AudioLike) => MusicRoute | null;
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
  private readonly light: () => boolean;
  private readonly gestures: GestureTarget | null;
  private readonly startTimer: (run: () => void, ms: number) => unknown;
  private readonly stopTimer: (handle: unknown) => void;
  private readonly elements = new Map<Tune, AudioLike>();
  private readonly route: (audio: AudioLike) => MusicRoute | null;
  private readonly routes = new Map<AudioLike, MusicRoute>();
  /** Each element's level as last set, which iOS will not read back from `volume`. */
  private readonly levels = new Map<AudioLike, number>();
  /** The music slider's gain (`soundVolume.ts`). */
  private scale = 1;

  private wanted: Tune | null = null;
  private enabled = false;
  /** The tune playing, or asked to play and waiting for a press. */
  private current: Tune | null = null;
  private fading: Fading[] = [];
  private waitingForGesture = false;

  constructor(options: MusicPlayerOptions = {}) {
    this.createAudio = options.createAudio ?? defaultAudio;
    this.canPlayOgg = options.canPlayOgg ?? browserPlaysOgg();
    this.light = options.light ?? (() => lightMusic());
    this.gestures = options.gestures ?? (typeof document === "undefined" ? null : document);
    this.startTimer = options.setInterval ?? ((run, ms) => setInterval(run, ms));
    this.stopTimer = options.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    this.route = options.route ?? defaultRoute;
  }

  /**
   * The music slider, as a gain 0-1 (`volumeGain`). The tune playing
   * follows at once; one fading out keeps fading.
   */
  setVolume(gain: number): void {
    this.scale = Math.min(1, Math.max(0, Number.isFinite(gain) ? gain : 0));
    const current = this.current;
    if (!current) return;
    const audio = this.elements.get(current);
    if (audio && !this.fading.some((fade) => fade.audio === audio)) {
      this.setLevel(audio, tuneFile(current).volume * this.scale);
    }
  }

  /** The slider's gain as set. */
  get volume(): number {
    return this.scale;
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
      // The copy is picked once a page: a Quality change shows from the next visit.
      audio = this.createAudio(tuneUrl(tuneFile(tune), this.canPlayOgg, this.light()));
      audio.loop = true;
      this.elements.set(tune, audio);
      const route = this.route(audio);
      if (route) this.routes.set(audio, route);
    }
    return audio;
  }

  private start(tune: Tune): void {
    const audio = this.element(tune);
    // A tune still fading out from a moment ago starts over at full volume.
    this.cancelFade(audio);
    this.setLevel(audio, tuneFile(tune).volume * this.scale);
    audio.currentTime = 0;
    this.attempt(tune);
  }

  /** Asks the browser to play the current tune; a refusal waits for the next press. */
  private attempt(tune: Tune): void {
    const audio = this.element(tune);
    const route = this.routes.get(audio);
    route?.resume();
    let started: Promise<void>;
    try {
      started = audio.play();
    } catch {
      this.listen();
      return;
    }
    started.then(
      () => {
        if (this.current !== tune) return;
        // Routed, the element plays into a context that may still be held back.
        if (route && !route.running) this.listen();
        else this.stopListening();
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
   * counted from the level as set, not read back from the volume, which iOS
   * does not report; there the steps go to the tune's gain.
   */
  private fadeOut(tune: Tune): void {
    const audio = this.elements.get(tune);
    if (!audio) return;
    this.cancelFade(audio);
    const from = this.levels.get(audio) ?? audio.volume;
    let steps = Math.max(1, Math.ceil(from / FADE_STEP));
    const handle = this.startTimer(() => {
      steps -= 1;
      if (steps <= 0) {
        this.cancelFade(audio);
        audio.pause();
        return;
      }
      this.setLevel(audio, Math.max(0, Math.min(1, steps * FADE_STEP)));
    }, FADE_TICK_MS);
    this.fading.push({ audio, handle });
  }

  /** Sets a tune's level: on its gain where routed, else on the element. */
  private setLevel(audio: AudioLike, level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    this.levels.set(audio, clamped);
    const route = this.routes.get(audio);
    if (route) route.setLevel(clamped);
    else audio.volume = clamped;
  }

  private cancelFade(audio: AudioLike): void {
    const fade = this.fading.find((entry) => entry.audio === audio);
    if (!fade) return;
    this.stopTimer(fade.handle);
    this.fading = this.fading.filter((entry) => entry !== fade);
  }
}
