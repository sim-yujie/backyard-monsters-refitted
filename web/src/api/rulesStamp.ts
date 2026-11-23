import manifest from "@/game/combat/rules/MANIFEST.json";
import { ApiError } from "./http";

/**
 * The battle-rules stamp (owner's fix 1, Desk 8, 23 Nov 2026; the server's
 * `services/base/combat/rulesStamp.ts`). Every attack start and every attack
 * save carries this bundle's combat rules version as `rules`; the server
 * refuses a start whose rules are not its own with reason `newVersion`, before
 * anything is spent, so a page left open across a release that changed the
 * battle rules never fights a battle the server would replay differently.
 *
 * It is the rules MANIFEST's `version`, not the game version: a release that
 * leaves the battle rules alone forces no reload.
 */
export const RULES_STAMP: string = manifest.version;

/** The field the stamp travels in. */
export const RULES_FIELD = "rules";

/** The refusal's reason: the page plays older battle rules than the server. */
export const NEW_VERSION_REASON = "newVersion";

/** Whether an error is the server's "New version" refusal of an attack start. */
export const isNewVersionRefusal = (caught: unknown): boolean =>
  caught instanceof ApiError &&
  (caught.details?.data as { reason?: unknown } | undefined)?.reason === NEW_VERSION_REASON;

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Hears every "New version" refusal, wherever the attack was started from
 * (the map, the yard, the Inferno, Repeat attack). `main.ts` shows the
 * "New version" card with its Reload button. Returns the unsubscribe.
 */
export const onNewVersionRefusal = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * An attack start, stamped: tells the listeners when the server refused it
 * for a new version, then rethrows, so each caller still stops as on any
 * refusal.
 */
export const startStamped = async <T>(start: Promise<T>): Promise<T> => {
  try {
    return await start;
  } catch (caught) {
    if (isNewVersionRefusal(caught)) for (const listener of listeners) listener();
    throw caught;
  }
};
