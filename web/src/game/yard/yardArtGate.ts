/**
 * Buildings first (beta 9, owner 21 Nov 2026, card b9-speed-picks): on an
 * emulated cheap phone on Slow 4G the yard stayed blank for about 47 s,
 * because its building pictures, the monsters' sheets and the music all
 * downloaded at once and shared the line. Now the yard's own pictures go
 * first: the monster sheets wait for them per yard (`YardRenderer`'s
 * `sheetsAllowed`), and the music, once a page, waits for this gate.
 *
 * The gate opens the first time any yard has all its pictures in, or gives up
 * waiting for them (`YardRenderer.openSheets`). Once open it stays open.
 */

/** A promise that settles once, when {@link Gate.open} is first called. */
export interface Gate {
  readonly promise: Promise<void>;
  readonly isOpen: boolean;
  open(): void;
}

/** A closed gate. */
export const makeGate = (): Gate => {
  let release!: () => void;
  let open = false;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    get isOpen() {
      return open;
    },
    open() {
      if (open) return;
      open = true;
      release();
    },
  };
};

/** The page's gate: open once the first yard has its pictures in. */
export const yardArtGate: Gate = makeGate();

/**
 * The longest the music waits for {@link yardArtGate}, from the moment it is
 * first wanted: a page that never shows a yard (or one whose yard never
 * settles) still gets its music.
 */
export const MUSIC_WAIT_MAX_MS = 60_000;

/** {@link yardArtGate}, or {@link MUSIC_WAIT_MAX_MS} after the call, whichever comes first. */
export const musicGate = (
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  gate: Gate = yardArtGate,
): Promise<void> => (gate.isOpen ? Promise.resolve() : Promise.race([gate.promise, wait(MUSIC_WAIT_MAX_MS)]));
