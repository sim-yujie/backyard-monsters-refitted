import { noteSafeModeNoticeShown, safeModeNotice } from "@/game/safeMode";
import { openSafeModeNotice } from "@/ui/quality/SafeModeDialog";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";
import { screenBusy } from "./announcements";

/** How long after the yard opens the notice first looks for a free screen. */
export const SAFE_NOTICE_FIRST_MS = 1500;
/** How often it looks again while something else has the screen. */
export const SAFE_NOTICE_RETRY_MS = 3000;

/**
 * Own-yard plugin for safe mode's notice (`game/safeMode.ts`): once, on the
 * page load where the game stepped its Quality down, as soon as nothing else
 * has the screen. Shown on a test server's quiet login too: there it only
 * comes up when a tester set it up by hand.
 */
export const safeModePlugin: YardPlugin = (mounts) => {
  if (safeModeNotice() === null) return;
  let handle: number | null = null;
  const look = (): void => {
    handle = null;
    const level = safeModeNotice();
    if (level === null) return;
    if (screenBusy(mounts)) {
      handle = window.setTimeout(look, SAFE_NOTICE_RETRY_MS);
      return;
    }
    noteSafeModeNoticeShown();
    openSafeModeNotice({ container: mounts.overlay.modal, level });
  };
  handle = window.setTimeout(look, SAFE_NOTICE_FIRST_MS);
  return () => {
    if (handle !== null) window.clearTimeout(handle);
    handle = null;
  };
};

YARD_PLUGINS.push(safeModePlugin);
