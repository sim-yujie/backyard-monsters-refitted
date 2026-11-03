import { fetchModerationNotice, seeModerationNotice } from "@/api/moderation";
import { worldChat } from "@/game/chat/chatSession";
import { openTeamNotice } from "@/ui/moderation/TeamNoticeDialog";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";
import { screenBusy } from "./announcements";

/**
 * Own-yard plugin for a warning or chat pause from the game team (server
 * `services/admin/moderation.ts`): after the yard loads, and at once when
 * the chat connection says one was just left, the oldest one not yet closed
 * pops up, once nothing else has the screen. OK closes it for good; the next
 * one, if any, follows.
 */

const WAIT_MS = 2_000;

export const teamNoticePlugin: YardPlugin = (mounts) => {
  let stopped = false;
  let showing = false;
  let timer: number | undefined;

  const check = async (): Promise<void> => {
    if (stopped || showing) return;
    window.clearTimeout(timer);
    let notice;
    try {
      notice = await fetchModerationNotice();
    } catch {
      return;
    }
    if (!notice || stopped) return;
    const show = (): void => {
      if (stopped || showing) return;
      if (screenBusy(mounts)) {
        timer = window.setTimeout(show, WAIT_MS);
        return;
      }
      showing = true;
      openTeamNotice({
        container: mounts.overlay.modal,
        notice,
        onClose: () => {
          showing = false;
          void seeModerationNotice(notice.id)
            .catch(() => {})
            .then(() => check());
        },
      });
    };
    show();
  };

  const stopTeam = worldChat.onTeam((event) => {
    if (event.kind === "notice") void check();
  });
  void check();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    stopTeam();
  };
};

YARD_PLUGINS.push(teamNoticePlugin);
