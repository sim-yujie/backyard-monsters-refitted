import { GESTURE_EVENTS, type GestureTarget } from "./MusicPlayer";
import { sharedAudioContext } from "./soundVolume";

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
 * sounds like one harvester banking, and a pop or two never stack. A family
 * of takes (the monsters' hits, their splats) shares one more gap,
 * {@link GROUP_GAP_MS}, so a fifty-monster attack does not turn into noise.
 *
 * An attack's sounds (`game/attack/attackSounds.ts`) are fetched only once
 * an attack opens ({@link EffectsPlayer.preload}), so the game's first load
 * carries just the few collect and yard sounds.
 *
 * Effects go through Web Audio rather than `<audio>` elements: they overlap
 * freely, start on time from the frame loop, and the files are a few KB
 * each. Browsers hold Web Audio back until the player has tapped, clicked
 * or pressed a key, as they do music (`MusicPlayer.ts`); until then the
 * player listens for the next such press on the whole page and starts the
 * sound inside it. An effect asked for while sound is held back is dropped,
 * not saved up, so nothing goes off late in a heap.
 */

/** Where the game server keeps Flash's sound folders (`SOUNDS.as:35-45`). */
const UI = "/assets/sounds/uisounds/";
const ATTACK = "/assets/sounds/attacksounds/";
const OTHER = "/assets/sounds/othersounds/";
const INFERNO = "/assets/sounds/infernosounds/";

/**
 * Effects that come as a family of takes, as Flash's `"hit" + int(1 + Math.random() * 3)`:
 * one of a family starts at most once in {@link GROUP_GAP_MS}, so fifty
 * monsters biting at once sound like a fight, not a rattle.
 */
export type EffectGroup =
  | "hit"
  | "splat"
  | "land"
  | "damage"
  | "destroy"
  | "growl"
  | "magma"
  | "crack"
  | "shatter"
  | "loot";

export interface EffectFile {
  readonly url: string;
  /** Flash's volume for it: `SOUNDS.Play`'s default, or what its caller passed. */
  readonly volume: number;
  /**
   * An attack's sound (`game/attack/attackSounds.ts`): fetched only once an
   * attack asks for it ({@link EffectsPlayer.preload}), never on game load.
   */
  readonly attack?: true;
  readonly group?: EffectGroup;
}

const effects = {
  bankfire: { url: `${UI}sound_bankfire.mp3`, volume: 0.8 },
  bankland: { url: `${UI}sound_bankland.mp3`, volume: 0.8 },
  // An attack's loot orb (`ParticleLoot.as:27`): Flash's same plop, kept to
  // one per LOOT_GAP_MS so twenty buildings looted at once are not twenty.
  loot: { url: `${UI}sound_bankland.mp3`, volume: 0.8, attack: true, group: "loot" },
  ibankfire: { url: `${INFERNO}sound_ibankfire.mp3`, volume: 0.8 },
  ibankland: { url: `${INFERNO}sound_ibankland.mp3`, volume: 0.8 },
  // The Monster Juicer blending (`BUILDING9.as:79-81`) and a giblet landing (`GIBLET.as:58`).
  juice: { url: `${OTHER}sound_juice.mp3`, volume: 0.8 },
  splat5: { url: `${ATTACK}sound_splat5.mp3`, volume: 0.8 },

  // ── An attack's sounds; `attackSounds.ts` says which Flash call plays each ──
  // A trap going off (`BTRAP.as:147`); the Modern look layers a building's fall over a Heavy Trap's, louder.
  trap: { url: `${ATTACK}sound_trap.mp3`, volume: 0.8, attack: true },
  trapheavy: { url: `${ATTACK}building_destroy_1.mp3`, volume: 1, attack: true },
  // The towers' shots, and the bunker's door.
  splash1: { url: `${ATTACK}sound_splash1.mp3`, volume: 0.8, attack: true },
  snipe1: { url: `${ATTACK}sound_snipe1.mp3`, volume: 0.8, attack: true },
  laser: { url: `${ATTACK}sound_laser.mp3`, volume: 0.8, attack: true },
  railgun1: { url: `${ATTACK}sound_railgun1.mp3`, volume: 0.8, attack: true },
  lightningstart: { url: `${ATTACK}sound_lightningstart.mp3`, volume: 0.8, attack: true },
  lightningfire: { url: `${ATTACK}sound_lightningfire.mp3`, volume: 0.8, attack: true },
  lightningend: { url: `${ATTACK}sound_lightningend.mp3`, volume: 0.8, attack: true },
  bunkerdoor: { url: `${ATTACK}bunkerdoor.mp3`, volume: 0.8, attack: true },
  // The Inferno's towers, and Korath's quake.
  icannon: { url: `${INFERNO}inferno_cannonfire.mp3`, volume: 0.8, attack: true },
  isniper: { url: `${INFERNO}inferno_sniperfire.mp3`, volume: 0.8, attack: true },
  magma1: { url: `${INFERNO}sound_magma_attack1.mp3`, volume: 0.8, attack: true, group: "magma" },
  magma2: { url: `${INFERNO}sound_magma_attack2.mp3`, volume: 0.8, attack: true, group: "magma" },
  quake: { url: `${INFERNO}sound_quake_attack.mp3`, volume: 0.8, attack: true },
  // The monsters' swings, quiet: Flash played them at 0.1 to 0.2.
  hit1: { url: `${ATTACK}sound_hit1.mp3`, volume: 0.15, attack: true, group: "hit" },
  hit2: { url: `${ATTACK}sound_hit2.mp3`, volume: 0.15, attack: true, group: "hit" },
  hit3: { url: `${ATTACK}sound_hit3.mp3`, volume: 0.15, attack: true, group: "hit" },
  hit4: { url: `${ATTACK}sound_hit4.mp3`, volume: 0.15, attack: true, group: "hit" },
  ihit1: { url: `${INFERNO}sound_ihit1.mp3`, volume: 0.15, attack: true, group: "hit" },
  ihit2: { url: `${INFERNO}sound_ihit2.mp3`, volume: 0.15, attack: true, group: "hit" },
  ihit3: { url: `${INFERNO}sound_ihit3.mp3`, volume: 0.15, attack: true, group: "hit" },
  ihit4: { url: `${INFERNO}sound_ihit4.mp3`, volume: 0.15, attack: true, group: "hit" },
  ihit5: { url: `${INFERNO}sound_ihit5.mp3`, volume: 0.15, attack: true, group: "hit" },
  ihit6: { url: `${INFERNO}sound_ihit6.mp3`, volume: 0.15, attack: true, group: "hit" },
  ihit7: { url: `${INFERNO}sound_ihit7.mp3`, volume: 0.15, attack: true, group: "hit" },
  // A monster reaching what it will shoot at growls (`CreepBase.as:1482`).
  imonster1: { url: `${INFERNO}inferno_monster1.mp3`, volume: 0.8, attack: true, group: "growl" },
  imonster2: { url: `${INFERNO}inferno_monster2.mp3`, volume: 0.8, attack: true, group: "growl" },
  imonster3: { url: `${INFERNO}inferno_monster3.mp3`, volume: 0.8, attack: true, group: "growl" },
  imonster4: { url: `${INFERNO}inferno_monster4.mp3`, volume: 0.8, attack: true, group: "growl" },
  // A monster falling: the thud (`MonsterBase.dieFinish`) and its splat (`deathSplat`).
  monsterland1: { url: `${ATTACK}monster_land_1.mp3`, volume: 0.8, attack: true, group: "land" },
  monsterland2: { url: `${ATTACK}monster_land_2.mp3`, volume: 0.8, attack: true, group: "land" },
  monsterland3: { url: `${ATTACK}monster_land_3.mp3`, volume: 0.8, attack: true, group: "land" },
  monsterlanddave: { url: `${ATTACK}monster_land_dave.mp3`, volume: 0.8, attack: true },
  splat1: { url: `${ATTACK}sound_splat1.mp3`, volume: 0.8, attack: true, group: "splat" },
  splat2: { url: `${ATTACK}sound_splat2.mp3`, volume: 0.8, attack: true, group: "splat" },
  splat3: { url: `${ATTACK}sound_splat3.mp3`, volume: 0.8, attack: true, group: "splat" },
  // A building going to its damaged look, and falling (`BFOUNDATION.as:1070-1092`), by its level.
  damage1: { url: `${ATTACK}building_damage_1.mp3`, volume: 0.8, attack: true, group: "damage" },
  damage2: { url: `${ATTACK}building_damage_2.mp3`, volume: 0.8, attack: true, group: "damage" },
  damage3: { url: `${ATTACK}building_damage_3.mp3`, volume: 0.8, attack: true, group: "damage" },
  destroy1: { url: `${ATTACK}building_destroy_1.mp3`, volume: 0.8, attack: true, group: "destroy" },
  destroy2: { url: `${ATTACK}building_destroy_2.mp3`, volume: 0.8, attack: true, group: "destroy" },
  destroy3: { url: `${ATTACK}building_destroy_3.mp3`, volume: 0.8, attack: true, group: "destroy" },
  destroy4: { url: `${ATTACK}building_destroy_4.mp3`, volume: 0.8, attack: true, group: "destroy" },
  destroytownhall: { url: `${ATTACK}town_hall_destroy.mp3`, volume: 0.8, attack: true },
  // The catapult's bombs as they are thrown (`ResourceBombs.Trigger`).
  twigbomb: { url: `${ATTACK}sound_twigbomb.mp3`, volume: 0.8, attack: true },
  pebblebomb: { url: `${ATTACK}sound_pebblebomb.mp3`, volume: 0.8, attack: true },
  puttybomb: { url: `${ATTACK}sound_puttybomb.mp3`, volume: 0.8, attack: true },
  // A Wormzer going under and coming up (`MonsterBase.renderBurrow`), at half volume.
  dig: { url: `${ATTACK}wormzer_dig.mp3`, volume: 0.5, attack: true },
  arise: { url: `${ATTACK}wormzer_arise.mp3`, volume: 0.5, attack: true },
  // The siege weapons' one-off sounds (`Jars.as:12-16`, `Decoy.as:22,32`, `VacuumHose.as:195,255`).
  jarland: { url: `${OTHER}jar_land_2.mp3`, volume: 0.8, attack: true },
  jarcrack1: { url: `${OTHER}glass_cracking_1.mp3`, volume: 0.8, attack: true, group: "crack" },
  jarcrack2: { url: `${OTHER}glass_cracking_2.mp3`, volume: 0.8, attack: true, group: "crack" },
  jarcrack3: { url: `${OTHER}glass_cracking_3.mp3`, volume: 0.8, attack: true, group: "crack" },
  jarcrack4: { url: `${OTHER}glass_cracking_4.mp3`, volume: 0.8, attack: true, group: "crack" },
  jarexplode1: { url: `${OTHER}glass_explode_1.mp3`, volume: 0.8, attack: true, group: "shatter" },
  jarexplode2: { url: `${OTHER}glass_explode_2.mp3`, volume: 0.8, attack: true, group: "shatter" },
  decoyland: { url: `${OTHER}decoyLandSound.mp3`, volume: 0.8, attack: true },
  decoyexplode: { url: `${OTHER}decoyExplosionSound.mp3`, volume: 0.8, attack: true },
  vacuumstart: { url: `${OTHER}vacuumstart.mp3`, volume: 0.8, attack: true },
  vacuumbroken: { url: `${OTHER}vacuumbroken.mp3`, volume: 0.8, attack: true },
  vacuumoff: { url: `${OTHER}vacuumloopoff.mp3`, volume: 0.8, attack: true },
} as const satisfies Record<string, EffectFile>;

export type Effect = keyof typeof effects;

export const EFFECTS: Readonly<Record<Effect, EffectFile>> = effects;

/** Every attack sound ({@link EffectFile.attack}). */
export const ATTACK_EFFECTS: readonly Effect[] = (Object.keys(EFFECTS) as Effect[]).filter(
  (effect) => EFFECTS[effect].attack === true,
);

/** The least time between two starts of one effect: two Flash frames at 40 fps. */
export const MIN_GAP_MS = 50;

/** The least time between two starts of one {@link EffectGroup}: about ten a second. */
export const GROUP_GAP_MS = 100;

/**
 * The loot plop's own gap: about seven a second. Flash let one sound start
 * three times at once and then once a frame (`SOUNDS.as:245-246`), which a
 * swarm on a storage building turned into a buzz.
 */
export const LOOT_GAP_MS = 150;

const groupGap = (group: EffectGroup): number => (group === "loot" ? LOOT_GAP_MS : GROUP_GAP_MS);

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

const webAudio = (): EffectsBackend | null => {
  // Shared with the music on iPhones (`soundVolume.ts`), so one press lets both out.
  const context = sharedAudioContext();
  if (!context) return null;
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
  /** Decoded files by url: the Heavy Trap's fall and a building's are one file. */
  private readonly sounds = new Map<string, unknown>();
  private readonly loading = new Set<string>();
  /** The files fetched as soon as the sound card opens: every non-attack one, and what an attack asked for. */
  private readonly wanted = new Set<string>(
    (Object.keys(EFFECTS) as Effect[]).filter((effect) => EFFECTS[effect].attack !== true).map((effect) => EFFECTS[effect].url),
  );
  private readonly lastStart = new Map<Effect, number>();
  private readonly lastGroupStart = new Map<EffectGroup, number>();
  private enabled = false;
  private waitingForGesture = false;
  /** The effects slider's gain (`soundVolume.ts`), times each effect's own volume. */
  private scale = 1;

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

  /** The effects slider, as a gain 0-1 (`volumeGain`); 0 plays nothing. */
  setVolume(gain: number): void {
    this.scale = Math.min(1, Math.max(0, Number.isFinite(gain) ? gain : 0));
  }

  /** The slider's gain as set. */
  get volume(): number {
    return this.scale;
  }

  /**
   * Fetches `effects` now, ahead of their first play: an attack's sounds as
   * the attack opens, so the game's first load stays small. With sound
   * effects off nothing is fetched; they come when the sound card opens.
   */
  preload(effects: readonly Effect[]): void {
    for (const effect of effects) this.wanted.add(EFFECTS[effect].url);
    if (!this.enabled || !this.open()) return;
    for (const effect of effects) this.load(EFFECTS[effect].url);
  }

  /**
   * Starts `effect` now, at `volume` or its own; false when it stays silent
   * (off, held back, not loaded yet, or it or its family just played).
   */
  play(effect: Effect, volume?: number): boolean {
    if (!this.enabled || this.scale <= 0) return false;
    const backend = this.open();
    if (!backend) return false;
    if (!backend.running) {
      this.unlock();
      return false;
    }
    const file = EFFECTS[effect];
    const sound = this.sounds.get(file.url);
    if (sound === undefined) {
      this.load(file.url);
      return false;
    }
    const now = this.now();
    const last = this.lastStart.get(effect);
    if (last !== undefined && now - last < MIN_GAP_MS) return false;
    const group = file.group;
    const lastOfGroup = group === undefined ? undefined : this.lastGroupStart.get(group);
    if (group !== undefined && lastOfGroup !== undefined && now - lastOfGroup < groupGap(group)) return false;
    this.lastStart.set(effect, now);
    if (group !== undefined) this.lastGroupStart.set(group, now);
    backend.start(sound, (volume ?? file.volume) * this.scale);
    return true;
  }

  /** Lets go of the page's listeners. */
  destroy(): void {
    this.stopListening();
  }

  /** The sound card, opened on first need, with every wanted file asked for. */
  private open(): EffectsBackend | null {
    if (!this.made) {
      this.made = true;
      this.backend = this.createBackend();
      if (this.backend) for (const url of this.wanted) this.load(url);
    }
    return this.backend;
  }

  private load(url: string): void {
    const backend = this.backend;
    if (!backend || this.sounds.has(url) || this.loading.has(url)) return;
    this.loading.add(url);
    backend.load(url).then(
      (sound) => {
        this.loading.delete(url);
        this.sounds.set(url, sound);
      },
      // Asked for again on the effect's next play.
      () => this.loading.delete(url),
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
