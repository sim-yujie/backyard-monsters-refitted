import type { GameScenes } from "./gameScenes";
import { reloadForMissingChunk } from "./chunkReload";

/**
 * The game past the sign-in screen (`gameScenes.ts`), fetched once.
 *
 * `preloadGameScenes()` starts it while the first screen is up; the yard, map
 * or attack screen awaits the same fetch (`lazyScene.ts`). A failed fetch is
 * forgotten so the next ask tries again, and a failed ask (not the preload)
 * reloads the page once: a tab older than the live release has lost its piece
 * (`chunkReload.ts`).
 */

export type GameScenesImport = () => Promise<{ gameScenes: GameScenes }>;

export interface GameLoader {
  /** The game's screens once fetched, else null. */
  ready(): GameScenes | null;
  /** The game's screens; rejects when they cannot be fetched (after asking for a reload). */
  load(): Promise<GameScenes>;
  /** Starts the fetch without waiting for it; a failure here is quiet. */
  preload(): void;
}

export const makeGameLoader = (
  fetchModule: GameScenesImport,
  onFailedLoad: () => void = () => void reloadForMissingChunk(),
): GameLoader => {
  let pending: Promise<GameScenes> | null = null;
  let loaded: GameScenes | null = null;
  const fetchOnce = (): Promise<GameScenes> => {
    pending ??= fetchModule().then(
      (module) => (loaded = module.gameScenes),
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  return {
    ready: () => loaded,
    load: () =>
      fetchOnce().catch((error: unknown) => {
        onFailedLoad();
        throw error;
      }),
    preload: () => {
      fetchOnce().catch(() => undefined);
    },
  };
};

const gameLoader = makeGameLoader(() => import("./gameScenes"));

/** The game's screens, for `lazyScene()`. */
export const gameScenesSource = gameLoader;
export const preloadGameScenes = (): void => gameLoader.preload();
