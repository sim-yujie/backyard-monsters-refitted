import { setQuality } from "@/game/quality";
import { suggestLowOnce } from "@/game/slowInternet";
import { openSlowInternet } from "@/ui/quality/SlowInternetDialog";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";
import { screenBusy } from "./announcements";

/**
 * Own-yard plugin for the one-time "Slow internet? Use Low" suggestion
 * (`game/slowInternet.ts`): a few seconds after the yard opens, when the
 * connection looks slow, the player never picked a Quality and nothing else
 * has the screen.
 */
export const slowInternetPlugin: YardPlugin = (mounts) =>
  suggestLowOnce({
    busy: () => screenBusy(mounts),
    show: () => openSlowInternet({ container: mounts.overlay.modal, onLow: () => setQuality("low") }),
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });

YARD_PLUGINS.push(slowInternetPlugin);
