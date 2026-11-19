import { loadTextures } from "pixi.js";

/**
 * Patch 7.12: the game's decoded pictures go back the moment the page is left
 * for good, so a reload does not hold two yards at once.
 *
 * Every picture the game loads goes through Pixi's `loadTextures`, which
 * decodes it into an `ImageBitmap` (`createImageBitmap`, on the page since
 * `preferWorkers: false`). Pixi never closes those: destroying a texture only
 * drops its reference, so the bitmaps (about 160 pictures, 1.7 GB on Medium)
 * live until the page's script engine is cleaned up. A reload starts filling
 * the new page before that, and an iPhone then held about 5.9 GB instead of
 * 3.5 GB (measured on 7.11, 19 Nov 2026). Closing them as the page goes frees
 * that memory at once.
 *
 * The pictures are noted where Pixi loads them (`notePictureLoads`), held
 * weakly so one the game dropped is not kept alive, and closed by
 * `releaseOnLeave`.
 */

/** What is closed: an `ImageBitmap`, or a stand-in in a test. */
export interface Closable {
  readonly width: number;
  close(): void;
}

/** How often (in pictures noted) the list forgets pictures already collected. */
const SWEEP_EVERY = 64;

/** The pictures decoded on this page, held weakly. */
export class PictureList {
  private readonly held = new Set<WeakRef<Closable>>();
  private noted = 0;

  /** Notes one picture; anything that is not a decoded picture is ignored. */
  note(picture: unknown, isPicture: (value: unknown) => value is Closable = isImageBitmap): void {
    if (!isPicture(picture) || typeof WeakRef === "undefined") return;
    this.held.add(new WeakRef(picture));
    this.noted += 1;
    if (this.noted % SWEEP_EVERY === 0) {
      for (const ref of this.held) if (!ref.deref()) this.held.delete(ref);
    }
  }

  /** Pictures still held (collected ones included until the next sweep). */
  get size(): number {
    return this.held.size;
  }

  /** Closes every picture still open; returns how many. Safe to call again. */
  closeAll(): number {
    let closed = 0;
    for (const ref of this.held) {
      const picture = ref.deref();
      // A closed bitmap has width 0.
      if (!picture || picture.width === 0) continue;
      try {
        picture.close();
        closed += 1;
      } catch {
        // Nothing to give back.
      }
    }
    this.held.clear();
    return closed;
  }
}

const isImageBitmap = (value: unknown): value is Closable =>
  typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap;

/** The game's pictures. */
export const gamePictures = new PictureList();

/** Marks Pixi's `load` once wrapped, so a hot reload does not wrap it twice. */
const WRAPPED = Symbol.for("bymr.notePictureLoads");

type TextureLoad = NonNullable<typeof loadTextures.load>;

/**
 * Notes every picture Pixi's texture loader decodes, whichever way it decodes
 * it (on the page or in a worker). Call before the first `Assets.load`.
 */
export const notePictureLoads = (pictures: PictureList = gamePictures): void => {
  const load = loadTextures.load as (TextureLoad & { [WRAPPED]?: true }) | undefined;
  if (!load || load[WRAPPED]) return;
  const wrapped = async function (this: typeof loadTextures, ...args: Parameters<TextureLoad>) {
    const texture: unknown = await load.apply(this, args);
    pictures.note((texture as { source?: { resource?: unknown } } | null)?.source?.resource);
    return texture;
  } as TextureLoad & { [WRAPPED]?: true };
  wrapped[WRAPPED] = true;
  loadTextures.load = wrapped;
};

/** The page events `releaseOnLeave` listens to; the real page by default. */
export interface LeavePage {
  readonly window: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  readonly reload: () => void;
}

export interface ReleaseOptions {
  readonly pictures?: PictureList;
  /** Stops drawing first, so no frame can use a closed picture. */
  readonly stopDrawing?: () => void;
  readonly page?: LeavePage;
}

/**
 * Closes the game's pictures when the page is left for good (`pagehide` that
 * is not persisted). A page kept for Back/Forward (`persisted`) keeps them: it
 * may be shown again as it is.
 *
 * The closing waits for the next leave event after `pagehide`: the document
 * turning hidden (`visibilitychange`, fired after `pagehide` by Chrome and
 * Safari) or `unload` (Safari, Firefox; Chrome no longer fires it). Both come
 * after every `pagehide` listener, so the attack's keepalive save
 * (`attack/plugins/end.ts`) and every other save on leaving have run, and
 * after the `visibilitychange` listeners added before the page went.
 *
 * Returns a function that removes the listeners.
 */
export const releaseOnLeave = (options: ReleaseOptions = {}): (() => void) => {
  const pictures = options.pictures ?? gamePictures;
  const page = options.page ?? { window, document, reload: () => location.reload() };
  let armed = false;
  let released = false;

  const release = (): void => {
    if (released) return;
    released = true;
    disarm();
    try {
      options.stopDrawing?.();
    } catch {
      // Closing still helps.
    }
    pictures.closeAll();
  };
  const onHidden = (): void => {
    if (page.document.visibilityState === "hidden") release();
  };
  const arm = (): void => {
    if (armed || released) return;
    armed = true;
    page.document.addEventListener("visibilitychange", onHidden);
    page.window.addEventListener("unload", release);
  };
  const disarm = (): void => {
    if (!armed) return;
    armed = false;
    page.document.removeEventListener("visibilitychange", onHidden);
    page.window.removeEventListener("unload", release);
  };

  const onPageHide = (event: Event): void => {
    if ((event as PageTransitionEvent).persisted) return;
    arm();
  };
  // The page was not left after all. Not expected after a pagehide that is not
  // persisted; if it happens, a page whose pictures were closed starts again.
  const onPageShow = (): void => {
    disarm();
    if (released) page.reload();
  };

  page.window.addEventListener("pagehide", onPageHide);
  page.window.addEventListener("pageshow", onPageShow);
  return () => {
    disarm();
    page.window.removeEventListener("pagehide", onPageHide);
    page.window.removeEventListener("pageshow", onPageShow);
  };
};
