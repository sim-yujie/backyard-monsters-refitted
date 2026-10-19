import { chatApi, type ChatApi } from "@/api/chat";
import { friendRefusal, friendsApi, type Friend, type FriendsApi, type HelpYardResponse } from "@/api/friends";
import { ApiError, NetworkError } from "@/api/http";
import { setViewTarget, type ViewTarget } from "@/game/attack/attackTarget";

/**
 * Visiting a friend (`docs/design/friends.md` §3.3, issue #372): the friend's
 * main yard, read-only, opened from the friends bar or the Friends list with
 * the same one-shot handoff as the map's View yard (`attackTarget.ts`).
 *
 * The friends list names a friend by user id, not by yard, so the target
 * carries the user id and the yard scene looks the main yard up when it
 * loads (the chat's "View yard" route). Every failure, that one included,
 * then goes down the yard's one load-failure path.
 */

/** The visitor's own pool, as the screen they left knows it, for the HUD. */
export type OwnPool = ViewTarget["own"];

/** The target a friend's visit opens. */
export const friendTarget = (friend: Pick<Friend, "userid" | "username">, own?: OwnPool): ViewTarget => ({
  baseid: "",
  kind: "friend",
  friend: friend.userid,
  name: friend.username,
  attack: null,
  refusal: null,
  ...(own && { own }),
});

/** Sets the friend's yard as the next yard to open; the caller then goes to the yard scene. */
export const visitFriend = (friend: Pick<Friend, "userid" | "username">, own?: OwnPool): void => {
  setViewTarget(friendTarget(friend, own));
};

/** What a friend visit's load uses: the yard lookup and the help-mode load. */
export interface FriendYardLoaders {
  readonly yardOf: ChatApi["yardOf"];
  readonly loadHelpYard: FriendsApi["loadHelpYard"];
}

const defaultLoaders: FriendYardLoaders = {
  yardOf: (userid) => chatApi.yardOf(userid),
  loadHelpYard: (baseid) => friendsApi.loadHelpYard(baseid),
};

/** Thrown when the friend has no main yard to show. */
export class NoFriendYard extends Error {
  constructor() {
    super("Their yard could not be found.");
    this.name = "NoFriendYard";
  }
}

/** Loads a friend's main yard to help in (`type: "help"`). */
export const loadFriendYard = async (
  userid: number,
  loaders: FriendYardLoaders = defaultLoaders,
): Promise<HelpYardResponse> => {
  const yard = await loaders.yardOf(userid);
  if (!yard) throw new NoFriendYard();
  return loaders.loadHelpYard(yard.baseid);
};

/**
 * Why a friend's yard did not open, in plain words: the friends refusal
 * ("You are not friends with this player any more."), the server's own
 * sentence for anything else it refused, or a general line.
 */
export const visitFailureText = (name: string, caught: unknown): string => {
  if (caught instanceof NoFriendYard) return `${name}'s yard could not be found.`;
  if (caught instanceof NetworkError) return `Could not reach the server to visit ${name}.`;
  const refusal = friendRefusal(caught);
  if (refusal.reason !== "unknown") return `Could not visit ${name}. ${refusal.message}`;
  if (caught instanceof ApiError && caught.message) return `Could not visit ${name}. ${caught.message}`;
  return `Could not visit ${name}. Try again in a moment.`;
};
