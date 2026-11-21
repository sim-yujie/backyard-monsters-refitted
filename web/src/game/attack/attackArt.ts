/**
 * An attack's pictures off the graphics card as soon as the player is home
 * (beta 9, owner 21 Nov 2026, card b9-speed-picks).
 *
 * Measured on an emulated phone (3 attacks in a row, Medium): texture memory
 * at home does not grow from attack to attack; Pixi's collector takes every
 * picture nobody has drawn for a minute off the card, checking every 30 s.
 * But for the 60-95 s until it does, the home yard held the attack's
 * pictures as well, 35-55 MB on top of its own, right when the yard's
 * monsters load and a phone is shortest of memory.
 *
 * So when an attack ends ({@link noteAttackEnd}) and the yard has its own
 * pictures in, the yard asks the collector to run at once with a short
 * window ({@link freeAttackArt}): whatever has not been drawn for
 * {@link UNUSED_MS} comes off the card. Nothing is destroyed: the picture
 * stays in Pixi's cache and goes back on the card the moment anything draws
 * it, which is what the collector does a minute later anyway.
 */

/** The part of Pixi's `GCSystem` used here. */
export interface TextureCollector {
  maxUnusedTime: number;
  /** When the last frame was drawn (`performance.now()` at its prerender): "unused" counts from it. */
  readonly now: number;
  run(): void;
}

/**
 * How recent the last drawn frame must be for the collector to run: in a
 * hidden tab, or behind a long task, the yard's own pictures would look
 * unused too.
 */
export const FRESH_FRAME_MS = 250;

/** How long a texture must have gone undrawn to be taken off after an attack, in ms. */
export const UNUSED_MS = 2000;

let attackEnded = false;

/** An attack scene ended: the next yard frees what it no longer draws. */
export const noteAttackEnd = (): void => {
  attackEnded = true;
};

/**
 * After an attack, runs the collector with a {@link UNUSED_MS} window, once:
 * "ran"; "nothing" when no attack ended (or there is no collector); "wait"
 * when no frame was drawn in the last {@link FRESH_FRAME_MS}, to be asked
 * again later. For the yard to call once its own pictures are in and drawn,
 * so that what it draws counts as in use.
 */
export const freeAttackArt = (
  collector: TextureCollector | null | undefined,
  now: number = performance.now(),
): "ran" | "nothing" | "wait" => {
  if (!attackEnded || !collector) return "nothing";
  if (now - collector.now > FRESH_FRAME_MS) return "wait";
  attackEnded = false;
  const usual = collector.maxUnusedTime;
  collector.maxUnusedTime = UNUSED_MS;
  try {
    collector.run();
  } finally {
    collector.maxUnusedTime = usual;
  }
  return "ran";
};

/** Forgets an ended attack (tests). */
export const resetAttackArt = (): void => {
  attackEnded = false;
};
