import type { ReceivedInvite } from "@/api/baiterTests";
import { BAITER_REFUSAL_TEXT, baiterRefusalOf, baiterTestsApi, type BaiterTestsApi } from "@/api/baiterTests";
import { isNewVersionRefusal } from "@/api/rulesStamp";
import type { BaseLoadResponse } from "@/api/types";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import { testerRunOf } from "@/game/baiter/friendTest";
import { Popup } from "@/ui/Popup";
import { BaiterFriends } from "./BaiterFriends";
import { BaiterPanel } from "./BaiterPanel";

/**
 * The two windows a friend's test needs outside the player's own Baiter
 * window (beta 9 #4): an invite needs only the INVITER's Baiter, so a player
 * with none still gets to it, from the invite notice.
 *
 * - {@link openInvitesWindow}: "Test a friend's yard", the Invited me list alone.
 * - {@link openFriendTestWindow}: the Baiter's army window for a friend's yard,
 *   capped by their Baiter; Start asks the server for their yard and starts.
 */

export interface FriendTestWindowOptions {
  /** The player's own yard: the army window's My army and My levels read it. */
  readonly save: () => BaseLoadResponse;
  /** The test is ready: go to the Baiter scene with it. */
  readonly onRun: (run: BaiterRun) => void;
  readonly onClose?: () => void;
  readonly api?: BaiterTestsApi;
}

/** Opens the army window for `invite`'s yard over `container`. */
export const openFriendTestWindow = (
  container: HTMLElement,
  invite: Pick<ReceivedInvite, "userid" | "username" | "cap" | "expiresAt">,
  options: FriendTestWindowOptions,
): BaiterPanel => {
  const api = options.api ?? baiterTestsApi;
  const panel: BaiterPanel = new BaiterPanel({
    level: 1,
    save: options.save,
    blocked: null,
    onRun: () => undefined,
    ...(options.onClose ? { onClose: options.onClose } : {}),
    host: {
      inviter: invite.userid,
      name: invite.username,
      cap: invite.cap,
      expiresAt: invite.expiresAt,
      start: async (army) => {
        try {
          const start = await api.start(invite.userid);
          panel.destroy();
          options.onRun(testerRunOf(start, army));
          return null;
        } catch (error) {
          // "New version": the card with its Reload button says it (`api/rulesStamp.ts`).
          if (isNewVersionRefusal(error)) return null;
          return BAITER_REFUSAL_TEXT[baiterRefusalOf(error)];
        }
      },
    },
  });
  return panel.mount(container);
};

export interface InvitesWindowOptions extends FriendTestWindowOptions {
  readonly container: HTMLElement;
}

/** Opens "Test a friend's yard": who invited the player, each with Test. */
export const openInvitesWindow = (options: InvitesWindowOptions): Popup => {
  const popup = new Popup({
    title: "Test a friend's yard",
    className: "baiter-invites",
    ...(options.onClose ? { onClose: options.onClose } : {}),
  });
  const friends = new BaiterFriends({
    ...(options.api ? { api: options.api } : {}),
    onTest: (invite) => {
      popup.close();
      openFriendTestWindow(options.container, invite, options);
    },
  });
  const body = document.createElement("section");
  body.className = "baiter baiter-invites__body";
  body.append(friends.invitedMe);
  popup.setContent(body);
  popup.mount(options.container);
  void friends.load();
  return popup;
};
