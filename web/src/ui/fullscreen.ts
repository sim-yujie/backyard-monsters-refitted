/**
 * The browser's Fullscreen API behind two small calls, for the account menu's
 * Fullscreen item (the original's top-bar button, `buttonFullscreen.as`).
 */

/** Whether this browser lets a page go fullscreen at all. */
export const fullscreenAvailable = (doc: Document = document): boolean =>
  doc.fullscreenEnabled === true && typeof doc.documentElement.requestFullscreen === "function";

export const isFullscreen = (doc: Document = document): boolean => doc.fullscreenElement !== null;

/** Enters fullscreen, or leaves it when already in. Resolves with the new state. */
export const toggleFullscreen = async (doc: Document = document): Promise<boolean> => {
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen();
    else await doc.documentElement.requestFullscreen();
  } catch {
    // Refused (no user gesture, or an embedded frame): the state stays as it was.
  }
  return isFullscreen(doc);
};
