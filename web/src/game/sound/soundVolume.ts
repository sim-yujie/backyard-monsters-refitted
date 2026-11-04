/**
 * The volume sliders' sound (owner, 4 Nov 2026), and the one Web Audio
 * context the game's sound shares.
 *
 * **The curve.** A slider's place is squared into the gain the sound is
 * played at: 100 is the file at Flash's own volume, 70 is 0.49 (-6 dB), 50
 * is 0.25 (-12 dB), 0 is silence. Ears hear loudness roughly by the
 * logarithm, so a straight line would leave the top half of the slider
 * sounding all the same and the bottom tenth doing everything.
 *
 * **The defaults** (`api/sound.ts`, the server's `soundSettings.ts`): music
 * 70, effects 100. Measured offline from the files (`ffmpeg` decode, then
 * peak, loudest 100 ms and whole-file RMS, each with the volume the game
 * plays it at), in dBFS:
 *
 * | Sound at its game volume        | loudest 100 ms | RMS   |
 * | ------------------------------- | -------------- | ----- |
 * | Attack music, 0.7               | -9.8           | -17.3 |
 * | Inferno attack music, 0.7       | -13.3          | -23.6 |
 * | Yard music (Modern), 0.6        | -12.9          | -20.2 |
 * | A building hit (damage1-2), 0.8 | -19.4 / -13.7  |       |
 * | A building falling (destroy1-2) | -20.7 / -10.5  |       |
 * | Sniper shot, 0.8                | -20.6          |       |
 * | Monster dies (splat1), 0.8      | -21.0          |       |
 * | Monster bites (hit1-4), 0.15    | -35 to -42     |       |
 * | Loot plop (bankland), 0.8       | -18.2          |       |
 *
 * So at Flash's balance the attack music's average sat level with the
 * loudest moment of most battle sounds, and 25 dB over the bites. With the
 * music at 70 (-6.2 dB: loudest -16.0, RMS -23.5), hits, shots, falls and the
 * loot plop come out 2-13 dB over the music's average, which is what the
 * players asked for, while the music stays clearly there.
 */

/** A slider's place (0-100) as the gain to play at, 0-1. */
export const volumeGain = (slider: number): number => {
  const share = Math.min(100, Math.max(0, Number.isFinite(slider) ? slider : 0)) / 100;
  return share * share;
};

type WebkitWindow = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let context: AudioContext | null | undefined;

/**
 * The page's one Web Audio context, made on first need; null where the
 * browser has none. Effects play through it, and on iPhones and iPads the
 * music too, so one press lets both out.
 */
export const sharedAudioContext = (): AudioContext | null => {
  if (context !== undefined) return context;
  const Context = globalThis.AudioContext ?? (globalThis as WebkitWindow).webkitAudioContext;
  context = Context ? new Context() : null;
  return context;
};

let ignored: boolean | null = null;

/**
 * True where the browser ignores a page's `audio.volume`: Safari on iPhone
 * and iPad, where the property reads back 1 whatever is set. There the
 * music goes through a Web Audio gain instead (`MusicPlayer.ts`).
 */
export const pageVolumeIgnored = (): boolean => {
  if (ignored !== null) return ignored;
  if (typeof Audio === "undefined") return (ignored = false);
  try {
    const probe = new Audio();
    probe.volume = 0.5;
    ignored = probe.volume !== 0.5;
  } catch {
    ignored = false;
  }
  return ignored;
};
