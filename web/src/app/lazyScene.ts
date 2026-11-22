import { reportCaughtError } from "@/game/bugReport/errorReporter";
import { Panel } from "@/ui/Panel";
import type { Scene, SceneContext } from "./SceneManager";

/** Where a lazy scene's code comes from: in hand already, or on its way. */
export interface LazySource<T> {
  /** The loaded code, or null while it is still being fetched. */
  ready(): T | null;
  load(): Promise<T>;
}

export const GAME_LOADING_TEXT = "Loading…";
export const GAME_LOAD_FAILED_TEXT = "The game could not load. Check your connection, then reload the page.";

/**
 * A scene whose code is fetched on demand (`gameLoader.ts`): it waits for the
 * code, makes the real scene and hands every hook on to it, so the scene
 * manager and the wrappers around it (presence, idle, music) see one scene as
 * before.
 *
 * The code is usually in hand by the time the player leaves the sign-in screen.
 * When it is not (a very quick sign-in on a slow line), the loading window the
 * boot screen shows stands in until it is; if it cannot be fetched at all the
 * window says so (the page has already been asked to reload once).
 */
export const lazyScene = <T>(source: LazySource<T>, make: (loaded: T) => Scene): Scene => {
  let inner: Scene | null = null;
  let left = false;

  const waitingWindow = (context: SceneContext): { status: HTMLElement; remove(): void } => {
    const status = document.createElement("div");
    status.className = "boot-status";
    status.textContent = GAME_LOADING_TEXT;
    const wrapper = document.createElement("div");
    wrapper.className = "scene-centre";
    const panel = new Panel({ title: "Backyard Monsters", closable: false, className: "boot-panel" });
    panel.setContent(status);
    wrapper.append(panel.element);
    context.overlay.content.append(wrapper);
    return {
      status,
      remove: () => {
        panel.close();
        wrapper.remove();
      },
    };
  };

  return {
    async enter(context) {
      let loaded = source.ready();
      if (loaded === null) {
        const waiting = waitingWindow(context);
        try {
          loaded = await source.load();
        } catch (error) {
          reportCaughtError(error);
          if (!left) waiting.status.textContent = GAME_LOAD_FAILED_TEXT;
          return;
        }
        waiting.remove();
      }
      if (left) return;
      inner = make(loaded);
      return inner.enter?.(context);
    },
    exit() {
      left = true;
      inner?.exit?.();
    },
    update(deltaSeconds) {
      inner?.update?.(deltaSeconds);
    },
    resize(width, height) {
      inner?.resize?.(width, height);
    },
  };
};
