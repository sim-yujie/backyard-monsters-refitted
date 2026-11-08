import { friendRefusal, friendsApi, type FriendsApi, type Relation } from "@/api/friends";
import { friendRelations, type FriendRelations } from "@/game/friends/friendRelations";
import { friendMarkOf } from "@/game/friends/friendMarks";
import { gameIcon } from "@/ui/gameIcon";
import { icon } from "@/ui/icons";
import { friendBadge } from "./friendBadge";
import "./add-friend.css";

/**
 * "Add friend" where players meet (`docs/design/friends.md` §3.1, issue
 * #378): the Map Room 2 yard popup, the Map Room 1 neighbour card and an
 * attack notice in the mailbox. It shows how the player stands to the other:
 * **Add friend**, **Accept** when they asked first (asking back accepts
 * theirs), or a plain "Friends" or "Request sent". A refusal says the Friends
 * screen's words under it.
 *
 * The caller leaves it off the player's own yards and the game's own notices.
 */

export const ADD_FRIEND_TEXT = {
  add: "Add friend",
  accept: "Accept",
  addTitle: (name?: string): string => (name ? `Send ${name} a friend request` : "Send a friend request"),
  acceptTitle: (name?: string): string => `${name ?? "They"} asked to be your friend. Accept?`,
  friend: "Friends",
  requested: "Request sent",
  sent: (name?: string): string => (name ? `Request sent to ${name}` : "Request sent"),
  accepted: (name?: string): string => (name ? `Now friends with ${name}` : "Now friends"),
  /** The icon-first button's tiny words (world chat's player strip). */
  shortFriend: "Friend",
  shortRequested: "Sent",
} as const;

/**
 * Icon-first, for world chat's player strip (owner, 8 Nov 2026: "consider using icon rather
 * than words"): a painted picture with a tiny word under it, every state a button of the same
 * size so the strip does not jump. Add friend and Accept are the two monster heads; a friend is
 * the friend marker and a request waiting the painted clock, both disabled. What happened is
 * told through `onNote` rather than a note under the button.
 */
export interface AddFriendCompact {
  /** The tiny word's class, to match the strip's other buttons. */
  readonly labelClassName?: string;
  readonly onNote?: (text: string, tone: "info" | "error") => void;
}

export interface AddFriendOptions {
  readonly userid: number;
  /** Their name, for the words; an attack notice has none to hand. */
  readonly username?: string;
  /** Already known to be a friend (a map cell's `fr`). */
  readonly friend?: boolean;
  /** The button's classes, to sit with its neighbours; `btn btn--outline` by default. */
  readonly className?: string;
  /** Icon-first, as in world chat's player strip. */
  readonly compact?: AddFriendCompact;
  /** Swappable for tests. */
  readonly api?: FriendsApi;
  readonly relations?: FriendRelations;
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const addFriendButton = (options: AddFriendOptions): HTMLElement => {
  const api = options.api ?? friendsApi;
  const relations = options.relations ?? friendRelations;
  const { userid, username } = options;
  const root = make("span", "add-friend");
  const note = make("span", "add-friend__note");
  note.setAttribute("role", "status");
  note.hidden = true;
  let relation: Relation = relations.relationOf(userid, options.friend === true);
  let busy = false;

  const say = (text: string | null, tone: "info" | "error" = "info"): void => {
    if (options.compact?.onNote) {
      if (text !== null) options.compact.onNote(text, tone);
      return;
    }
    note.textContent = text ?? "";
    note.hidden = text === null;
    note.classList.toggle("add-friend__note--error", tone === "error");
  };

  const ask = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    render();
    const asked = relation === "asked";
    try {
      const result = await api.request({ userid });
      const nowFriends = asked || result.friend !== null;
      if (nowFriends) relations.noteFriend(userid, result.friend);
      else relations.noteRequested(userid);
      relation = nowFriends ? "friend" : "requested";
      say(nowFriends ? ADD_FRIEND_TEXT.accepted(username) : ADD_FRIEND_TEXT.sent(username));
    } catch (caught) {
      const refusal = friendRefusal(caught);
      say(refusal.message, "error");
      if (refusal.reason === "alreadyFriends") {
        relation = "friend";
        relations.noteFriend(userid, null);
      }
      if (refusal.reason === "alreadyRequested") {
        relation = "requested";
        relations.noteRequested(userid);
      }
    } finally {
      busy = false;
      render();
    }
  };

  const renderCompact = (compact: AddFriendCompact): void => {
    const button = make("button", `${options.className ?? "btn"} add-friend__button add-friend__button--icon`);
    button.type = "button";
    button.dataset["relation"] = relation;
    let picture: HTMLElement | null;
    let word: string;
    let title: string;
    if (relation === "friend" || relation === "self") {
      picture = friendBadge(friendMarkOf(userid, { friend: true }) ?? "friend", 24);
      picture?.removeAttribute("role");
      picture?.removeAttribute("aria-label");
      picture?.removeAttribute("title");
      word = ADD_FRIEND_TEXT.shortFriend;
      title = ADD_FRIEND_TEXT.friend;
      button.disabled = true;
    } else if (relation === "requested") {
      picture = gameIcon("time", { size: 24, decorative: true });
      word = ADD_FRIEND_TEXT.shortRequested;
      title = ADD_FRIEND_TEXT.requested;
      button.disabled = true;
    } else {
      const accept = relation === "asked";
      picture = gameIcon("addfriend", { size: 24, decorative: true });
      word = accept ? ADD_FRIEND_TEXT.accept : ADD_FRIEND_TEXT.add;
      title = accept ? ADD_FRIEND_TEXT.acceptTitle(username) : ADD_FRIEND_TEXT.addTitle(username);
      button.disabled = busy;
      button.addEventListener("click", () => void ask());
    }
    button.title = title;
    button.setAttribute("aria-label", title);
    if (picture) button.append(picture);
    button.append(make("span", compact.labelClassName ?? "add-friend__label", word));
    root.replaceChildren(button);
  };

  const render = (): void => {
    if (options.compact) {
      renderCompact(options.compact);
      return;
    }
    let shown: HTMLElement;
    if (relation === "friend") {
      // The painted friend marker (beta 7), gold-framed for a pinned friend.
      shown = make("span", "chip add-friend__relation add-friend__relation--friend");
      const badge = friendBadge(friendMarkOf(userid, { friend: true }) ?? "friend");
      if (badge) shown.append(badge);
      shown.append(make("span", "", ADD_FRIEND_TEXT.friend));
    } else if (relation === "requested" || relation === "self") {
      shown = make("span", "chip add-friend__relation", relation === "requested" ? ADD_FRIEND_TEXT.requested : ADD_FRIEND_TEXT.friend);
    } else {
      const accept = relation === "asked";
      const button = make("button", `${options.className ?? "btn btn--outline"} add-friend__button`);
      button.type = "button";
      button.append(icon("plus", 18, "add-friend__icon"), make("span", "", accept ? ADD_FRIEND_TEXT.accept : ADD_FRIEND_TEXT.add));
      button.title = accept ? ADD_FRIEND_TEXT.acceptTitle(username) : ADD_FRIEND_TEXT.addTitle(username);
      button.disabled = busy;
      button.addEventListener("click", () => void ask());
      shown = button;
    }
    root.replaceChildren(shown, note);
  };

  render();
  // The requests waiting either way decide Request sent and Accept; asked once in a while.
  if (relation === "none") {
    void relations.load().then(() => {
      if (busy || relation !== "none") return;
      const known = relations.relationOf(userid);
      if (known !== relation) {
        relation = known;
        render();
      }
    });
  }
  return root;
};
