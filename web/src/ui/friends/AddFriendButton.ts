import { friendRefusal, friendsApi, type FriendsApi, type Relation } from "@/api/friends";
import { friendRelations, type FriendRelations } from "@/game/friends/friendRelations";
import { icon } from "@/ui/icons";
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
} as const;

export interface AddFriendOptions {
  readonly userid: number;
  /** Their name, for the words; an attack notice has none to hand. */
  readonly username?: string;
  /** Already known to be a friend (a map cell's `fr`). */
  readonly friend?: boolean;
  /** The button's classes, to sit with its neighbours; `btn btn--outline` by default. */
  readonly className?: string;
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

  const render = (): void => {
    let shown: HTMLElement;
    if (relation === "friend" || relation === "requested" || relation === "self") {
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
