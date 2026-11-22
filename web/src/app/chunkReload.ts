/**
 * A tab left open across a release asks for a script piece the new release no
 * longer has (every piece is named after its contents, and only the live
 * release's pieces are served). Rather than a game stuck half-loaded, the page
 * reloads once and comes back on the new release.
 *
 * Once only: a second failure within a minute of the last reload (offline, or
 * a piece really missing) is left to the caller's error, never another reload,
 * so a page can never loop. Without session storage there is no way to count,
 * so there is no reload either.
 */

const RELOAD_KEY = "bymr.chunkReload";
/** No second reload within this long of the last one. */
export const CHUNK_RELOAD_GAP_MS = 60_000;

export interface ChunkReloadDeps {
  readonly storage: () => Pick<Storage, "getItem" | "setItem">;
  readonly now: () => number;
  readonly reload: () => void;
}

const defaultDeps: ChunkReloadDeps = {
  storage: () => window.sessionStorage,
  now: Date.now,
  reload: () => window.location.reload(),
};

/** Reloads the page for a script piece that would not load; false when that is not allowed now. */
export const reloadForMissingChunk = (deps: ChunkReloadDeps = defaultDeps): boolean => {
  try {
    const storage = deps.storage();
    const last = Number(storage.getItem(RELOAD_KEY)) || 0;
    const now = deps.now();
    if (now - last < CHUNK_RELOAD_GAP_MS && now >= last) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  deps.reload();
  return true;
};

export interface PreloadErrorDeps {
  /** The script this tab runs (`runningBundleName()`), null in a dev build. */
  readonly running: string | null;
  /** The script the live page names, or null when that cannot be told. */
  readonly liveBundle: () => Promise<string | null>;
  /** The reload and its once-a-minute guard (`reloadForMissingChunk`). */
  readonly reload?: ChunkReloadDeps;
}

/**
 * Vite's own signal (`vite:preloadError`) for any piece loaded on demand that
 * failed: Pixi's renderer pieces, the map's painted look, the chat. The page
 * reloads only when the live page names another release, so a phone's
 * dropped connection mid-game is not turned into a reload; the error goes on
 * to the code that asked, as before.
 */
export const installChunkErrorReload = (deps: PreloadErrorDeps, target: Window = window): (() => void) => {
  const onError = (): void => {
    if (!deps.running) return;
    void deps
      .liveBundle()
      .then((live) => {
        if (live && live !== deps.running) reloadForMissingChunk(deps.reload);
      })
      .catch(() => undefined);
  };
  target.addEventListener("vite:preloadError", onError);
  return () => target.removeEventListener("vite:preloadError", onError);
};
