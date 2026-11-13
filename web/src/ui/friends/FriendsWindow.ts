import type { Friend } from "@/api/friends";
import { playerPicture, showPlayerPicture } from "@/game/playerPicture";
import { canHelp } from "@/game/friends/friendText";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { friendsOpener, type FriendsOpenTab } from "@/game/friends/friendsView";
import { formatAmount } from "@/ui/format";
import { gameIcon } from "@/ui/gameIcon";
import { onlineDot } from "@/ui/onlineDot";
import { Popup } from "@/ui/Popup";
import { scrollFade } from "@/ui/scrollFade";
import { openGiftPicker } from "./GiftPicker";
import { make } from "./rows";
import "./friends-button.css";

/**
 * The Friends window (owner, 9 Nov 2026, option A of the friends-bar
 * proposal: "Prefer A, then give me a panel that pops up centre-of-screen
 * (same as others)"). The long strip of portraits along the bottom of the
 * yard is gone; the round Friends button beside Map (`FriendsButton.ts`)
 * opens this instead, on a computer and a phone alike.
 *
 * It is a {@link Popup}, so it wears the game's own window: the painted steel
 * frame in Modern, Flash's refreshed parchment in Classic (`skin.css`), the
 * title on the sign, the close disc, the scrim, Escape and a click outside.
 *
 * - **Head:** the friend count and how many are online, as pictures and
 *   numbers, and **Add**, which opens the Friends screen on Find.
 * - **List:** three groups, each in today's order (pinned first, then can
 *   help, online, level): friends who can use your help, friends online,
 *   everyone else. A row is the critter, name, level, the online dot and the
 *   painted help and gift marks; pressing it shows **Visit** (the help-mode
 *   visit), **Message** and **Send gift** ("Sent" once a gift went today)
 *   under it. Only the list scrolls.
 * - **A long list** (lead, 9 Nov: "90 can use help, 20 online"): each group
 *   shows its first {@link GROUP_PREVIEW} and a **Show all 90** button, so
 *   all three groups are a short scroll apart. Show all lists that one group
 *   whole, and the head becomes a **< 90 Can use help** button back to the
 *   three. One scrolling box at any size; the way back never scrolls away.
 * - **Foot:** **All friends ›** opens the Friends screen, and the friend
 *   requests waiting, when there are any, open its Requests tab.
 *
 * It reads the shared friends store and follows it while open.
 */

export const FRIENDS_WINDOW_TEXT = {
  title: "Friends",
  add: "Add",
  addTitle: "Find players to add",
  total: (count: number): string => (count === 1 ? "1 friend" : `${formatAmount(count)} friends`),
  online: (count: number): string => `${formatAmount(count)} online`,
  helpGroup: "Can use help",
  onlineGroup: "Online",
  restGroup: "Everyone else",
  level: (level: number): string => `Lv ${level}`,
  pinned: "Pinned to the top",
  canHelp: "Can use your help today",
  giftDue: "No gift sent today",
  visit: "Visit",
  visitTitle: "Visit their yard and help: speed-ups and repairs",
  message: "Message",
  gift: "Send gift",
  giftSent: "Sent",
  giftSentTitle: "Gift sent today",
  all: "All friends",
  showAll: (count: number): string => `Show all ${formatAmount(count)}`,
  back: "Back to all three groups",
  requests: (count: number): string =>
    count === 1 ? "1 friend request waiting" : `${formatAmount(count)} friend requests waiting`,
  empty: "No friends yet. Add players you meet in chat or on the map.",
} as const;

/**
 * Pinned first (beta 7), in the order they were pinned; then those who can
 * use help, then online, then highest level, then name. Does not change the
 * list given.
 */
export const orderFriends = (friends: readonly Friend[]): Friend[] =>
  [...friends].sort(
    (a, b) =>
      Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) ||
      (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0) ||
      Number(canHelp(b)) - Number(canHelp(a)) ||
      Number(b.online === "online") - Number(a.online === "online") ||
      b.level - a.level ||
      a.username.localeCompare(b.username),
  );

/** The window's three groups, each in {@link orderFriends}' order; a friend is in one only. */
export interface FriendGroups {
  readonly help: Friend[];
  readonly online: Friend[];
  readonly rest: Friend[];
}

export const groupFriends = (friends: readonly Friend[]): FriendGroups => {
  const groups: FriendGroups = { help: [], online: [], rest: [] };
  for (const friend of orderFriends(friends)) {
    if (canHelp(friend)) groups.help.push(friend);
    else if (friend.online === "online") groups.online.push(friend);
    else groups.rest.push(friend);
  }
  return groups;
};

/** How many friends a group shows before its Show all button. */
export const GROUP_PREVIEW = 5;

/** One group as the window shows it: the friends in sight and how many wait behind Show all. */
export interface FriendsSection {
  readonly name: keyof FriendGroups;
  readonly friends: readonly Friend[];
  readonly total: number;
  readonly hidden: number;
}

/**
 * What the list shows: with no group chosen, every group that has anyone,
 * each cut to its first {@link GROUP_PREVIEW} (one more would only trade the
 * button for a row, so a group of 6 shows whole); with `focus`, that group
 * alone and whole. A chosen group that has emptied falls back to all three.
 */
export const friendsSections = (groups: FriendGroups, focus: keyof FriendGroups | null): FriendsSection[] => {
  if (focus && groups[focus].length > 0) {
    return [{ name: focus, friends: groups[focus], total: groups[focus].length, hidden: 0 }];
  }
  return (["help", "online", "rest"] as const)
    .filter((name) => groups[name].length > 0)
    .map((name) => {
      const all = groups[name];
      const friends = all.length > GROUP_PREVIEW + 1 ? all.slice(0, GROUP_PREVIEW) : all;
      return { name, friends, total: all.length, hidden: all.length - friends.length };
    });
};

export interface FriendsWindowOptions {
  /** Takes the player to this friend's yard (help mode). Without it a row has no Visit. */
  readonly onVisit?: (friend: Friend) => void;
  /** Opens the mailbox on a new message to this friend. Without it a row has no Message. */
  readonly onMessage?: (friend: Friend) => void;
  /** Sends this friend a gift; the gift picker (#375) by default. */
  readonly onGift?: (friend: Friend) => void;
  /** Opens the Friends screen; the shared opener by default. */
  readonly openFriends?: (tab?: FriendsOpenTab) => void;
  /** The store, for a test. */
  readonly store?: FriendsStore;
  /** Told once the window has closed. */
  readonly onClose?: () => void;
}

export class FriendsWindow {
  readonly popup: Popup;

  private readonly options: FriendsWindowOptions;
  private readonly store: FriendsStore;
  private readonly summary = make("div", "friends-window__summary");
  private readonly list = make("div", "friends-window__list");
  private readonly foot = make("div", "friends-window__foot");
  private readonly requests = make("button", "btn btn--outline friends-window__requests");
  private readonly unsubscribe: () => void;
  /** The friend whose actions show, or null. */
  private opened: number | null = null;
  private container: HTMLElement | null = null;
  private stopFade: () => void = () => {};
  /** The group shown whole (Show all), or null for all three cut short. */
  private focus: keyof FriendGroups | null = null;
  /** Where the three-group list was scrolled when Show all was pressed. */
  private overviewScroll = 0;
  private readonly head = make("div", "friends-window__top");

  constructor(options: FriendsWindowOptions = {}) {
    this.options = options;
    this.store = options.store ?? sharedStore;
    this.popup = new Popup({
      title: FRIENDS_WINDOW_TEXT.title,
      className: "friends-window",
      onClose: () => {
        this.unsubscribe();
        this.stopFade();
        options.onClose?.();
      },
    });

    const add = make("button", "btn btn--primary friends-window__add");
    add.type = "button";
    add.title = FRIENDS_WINDOW_TEXT.addTitle;
    add.setAttribute("aria-label", FRIENDS_WINDOW_TEXT.addTitle);
    add.append(gameIcon("addfriend", { size: 24, decorative: true }), make("span", "friends-window__add-word", FRIENDS_WINDOW_TEXT.add));
    add.addEventListener("click", () => this.openFriends("find"));
    this.head.append(this.summary, add);
    this.popup.setHead(this.head);

    this.list.setAttribute("role", "list");
    this.popup.body.classList.add("friends-window__body");
    this.popup.body.append(this.list);

    const all = make("button", "btn btn--outline friends-window__all");
    all.type = "button";
    all.textContent = `${FRIENDS_WINDOW_TEXT.all} ›`;
    all.setAttribute("aria-label", FRIENDS_WINDOW_TEXT.all);
    all.addEventListener("click", () => this.openFriends("friends"));
    this.requests.type = "button";
    this.requests.addEventListener("click", () => this.openFriends("requests"));
    this.foot.append(all, this.requests);
    // Under the body, not in it: the way to the full screen stays in sight while the list scrolls.
    this.popup.element.append(this.foot);

    this.unsubscribe = this.store.subscribe(() => this.render());
  }

  /** Shows the window in `container` (the overlay's modal layer). */
  mount(container: HTMLElement): this {
    this.container = container;
    this.render();
    this.popup.mount(container);
    // Fades where more of the list is hidden, as the attack window does (tester, 9 Nov).
    this.stopFade = scrollFade(this.popup.body, this.list);
    return this;
  }

  close(): void {
    this.popup.close();
  }

  private openFriends(tab: FriendsOpenTab): void {
    this.close();
    (this.options.openFriends ?? friendsOpener())?.(tab);
  }

  private render(): void {
    const friends = this.store.friends;
    const online = friends.filter((friend) => friend.online === "online").length;
    const groups = groupFriends(friends);
    const sections = friendsSections(groups, this.focus);
    if (this.focus && sections[0]?.name !== this.focus) this.focus = null;
    this.head.classList.toggle("friends-window__top--focus", this.focus !== null);
    if (this.focus) {
      this.summary.replaceChildren(this.backButton(this.focus, groups[this.focus].length));
    } else {
      this.summary.replaceChildren(
        count(gameIcon("friends", { size: 24, decorative: true }), friends.length, FRIENDS_WINDOW_TEXT.total(friends.length), "total"),
        count(onlineDot("friends-window__dot", true), online, FRIENDS_WINDOW_TEXT.online(online), "online"),
      );
    }

    const waiting = this.store.snapshot.requestsIn;
    this.requests.hidden = waiting <= 0;
    // The letter: a request waiting, not the Add button's heads and plus (tester, 9 Nov).
    this.requests.replaceChildren(
      gameIcon("mail", { size: 24, decorative: true }),
      make("span", "friends-window__requests-count", formatAmount(waiting)),
    );
    this.requests.title = FRIENDS_WINDOW_TEXT.requests(waiting);
    this.requests.setAttribute("aria-label", FRIENDS_WINDOW_TEXT.requests(waiting));

    if (this.opened !== null && !friends.some((friend) => friend.userid === this.opened)) this.opened = null;
    if (friends.length === 0) {
      this.list.replaceChildren(make("p", "friends-window__empty", FRIENDS_WINDOW_TEXT.empty));
      return;
    }
    this.list.classList.toggle("friends-window__list--focus", this.focus !== null);
    this.list.replaceChildren(...sections.flatMap((section) => this.section(section)));
  }

  /**
   * A group's heading ("[wrench] 3 Can use help"), its rows and, when some
   * are left out, Show all. A group shown whole has its heading in the head.
   */
  private section(section: FriendsSection): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    if (!this.focus) {
      const heading = make("h3", `friends-window__group friends-window__group--${section.name}`);
      heading.append(groupPicture(section.name), ...groupWords(section.name, section.total));
      nodes.push(heading);
    }
    nodes.push(...section.friends.map((friend) => this.row(friend)));
    if (section.hidden > 0) {
      const more = make("button", "btn btn--outline friends-window__more", FRIENDS_WINDOW_TEXT.showAll(section.total));
      more.type = "button";
      more.dataset["group"] = section.name;
      more.addEventListener("click", () => this.showGroup(section.name));
      nodes.push(more);
    }
    return nodes;
  }

  /** "< [wrench] 90 Can use help": back to the three groups, in the head so it never scrolls away. */
  private backButton(name: keyof FriendGroups, total: number): HTMLElement {
    const back = make("button", "btn btn--outline friends-window__back");
    back.type = "button";
    back.title = FRIENDS_WINDOW_TEXT.back;
    back.setAttribute("aria-label", `${FRIENDS_WINDOW_TEXT.back} (${formatAmount(total)} ${GROUP_WORDS[name]})`);
    back.append(make("span", "friends-window__back-arrow", "\u2039"), groupPicture(name), ...groupWords(name, total));
    back.addEventListener("click", () => this.showGroup(null));
    return back;
  }

  /** Shows one group whole, or (null) all three cut short again, keeping the place and the focus sensible. */
  private showGroup(name: keyof FriendGroups | null): void {
    const was = this.focus;
    if (name) this.overviewScroll = this.popup.body.scrollTop;
    this.focus = name;
    this.opened = null;
    this.render();
    if (name) {
      this.popup.body.scrollTop = 0;
      this.summary.querySelector<HTMLElement>(".friends-window__back")?.focus();
    } else {
      this.popup.body.scrollTop = this.overviewScroll;
      this.list.querySelector<HTMLElement>(`.friends-window__more[data-group="${was}"]`)?.focus({ preventScroll: true });
    }
  }

  private row(friend: Friend): HTMLElement {
    const opened = this.opened === friend.userid;
    const item = make("div", "friends-window__item");
    item.setAttribute("role", "listitem");
    item.dataset["userid"] = String(friend.userid);
    item.classList.toggle("is-open", opened);
    item.classList.toggle("friends-window__item--pinned", friend.pinnedAt !== null);

    const row = make("button", "friends-window__row");
    row.type = "button";
    row.setAttribute("aria-expanded", String(opened));
    const face = make("span", "friends-window__face");
    const img = make("img", "friends-window__img");
    showPlayerPicture(img, playerPicture(friend.userid, friend.pic, friend.photo, "small"));
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    face.append(img);
    if (friend.online === "online") face.append(onlineDot("friends-window__face-dot"));
    // The gold frame says "pinned" with a pin on its corner and in the tooltip (tester, 9 Nov).
    if (friend.pinnedAt !== null) {
      face.title = FRIENDS_WINDOW_TEXT.pinned;
      face.append(gameIcon("pin", { size: 16, label: FRIENDS_WINDOW_TEXT.pinned, className: "friends-window__pin" }));
    }
    const name = make("span", "friends-window__name", friend.username);
    name.title = friend.username;
    const marks = make("span", "friends-window__marks");
    if (canHelp(friend)) marks.append(gameIcon("tools", { size: 24, label: FRIENDS_WINDOW_TEXT.canHelp, className: "friends-window__mark" }));
    if (!friend.giftSentToday) marks.append(gameIcon("gift", { size: 24, label: FRIENDS_WINDOW_TEXT.giftDue, className: "friends-window__mark" }));
    row.append(face, name, make("span", "chip friends-window__level", FRIENDS_WINDOW_TEXT.level(friend.level)), marks);
    row.addEventListener("click", () => {
      this.opened = opened ? null : friend.userid;
      this.render();
      this.list.querySelector<HTMLElement>(`[data-userid="${friend.userid}"] .friends-window__row`)?.focus();
    });
    item.append(row);
    if (opened) item.append(this.actions(friend));
    return item;
  }

  /** Visit, Message and Send gift, under the row pressed. */
  private actions(friend: Friend): HTMLElement {
    const actions = make("div", "friends-window__actions");
    const add = (label: string, kind: "primary" | "outline", run: () => void, title = label): HTMLButtonElement => {
      const b = make("button", `btn btn--${kind} friends-window__action`, label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", run);
      actions.append(b);
      return b;
    };
    const { onVisit, onMessage, onGift } = this.options;
    if (onVisit) {
      add(FRIENDS_WINDOW_TEXT.visit, "primary", () => {
        this.close();
        onVisit(friend);
      }, FRIENDS_WINDOW_TEXT.visitTitle);
    }
    if (onMessage) {
      add(FRIENDS_WINDOW_TEXT.message, "outline", () => {
        this.close();
        onMessage(friend);
      });
    }
    const sent = friend.giftSentToday;
    const gift = add(sent ? FRIENDS_WINDOW_TEXT.giftSent : FRIENDS_WINDOW_TEXT.gift, "outline", () => {
      const container = this.container;
      this.close();
      if (onGift) onGift(friend);
      else openGiftPicker(friend, container, { store: this.store });
    }, sent ? FRIENDS_WINDOW_TEXT.giftSentTitle : FRIENDS_WINDOW_TEXT.gift);
    gift.disabled = sent;
    actions.dataset["count"] = String(actions.childElementCount);
    return actions;
  }
}

const GROUP_WORDS: Record<keyof FriendGroups, string> = {
  help: FRIENDS_WINDOW_TEXT.helpGroup,
  online: FRIENDS_WINDOW_TEXT.onlineGroup,
  rest: FRIENDS_WINDOW_TEXT.restGroup,
};

/** A group's picture: the wrench, the green dot, the grey dot. */
const groupPicture = (name: keyof FriendGroups): HTMLElement =>
  name === "help"
    ? gameIcon("tools", { size: 24, decorative: true })
    : name === "online"
      ? onlineDot("friends-window__dot", true)
      : offlineDot();

/** A group's count and words: "90", "Can use help". */
const groupWords = (name: keyof FriendGroups, total: number): HTMLElement[] => [
  make("span", "friends-window__group-count", formatAmount(total)),
  make("span", "friends-window__group-words", GROUP_WORDS[name]),
];

/**
 * The grey dot by "Everyone else": the friends who are neither online nor in
 * need of help, so its heading lines up with the other two (tester, 9 Nov).
 */
const offlineDot = (): HTMLElement => {
  const dot = make("span", "online-dot friends-window__dot friends-window__dot--off");
  dot.setAttribute("aria-hidden", "true");
  return dot;
};

/** "[picture] 34": a count in the head, its words in the tooltip and for a screen reader. */
const count = (picture: HTMLElement, value: number, words: string, name: string): HTMLElement => {
  const element = make("span", `friends-window__count friends-window__count--${name}`);
  element.title = words;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", words);
  element.append(picture, make("span", "friends-window__count-number", formatAmount(value)));
  return element;
};

/** Opens the Friends window in `container` (the overlay's modal layer). */
export const openFriendsWindow = (container: HTMLElement, options: FriendsWindowOptions = {}): FriendsWindow =>
  new FriendsWindow(options).mount(container);
