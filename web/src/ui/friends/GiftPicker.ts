import { friendRefusal, friendsApi, type FriendsApi, type Gift, type GiftResource } from "@/api/friends";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { Popup } from "@/ui/Popup";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount, resourceIcon } from "@/ui/resourceIcon";
import { make, StatusLine } from "./rows";
import { wishMark } from "./wishMark";
import "./friends.css";

/**
 * The gift picker (`docs/design/friends.md` §3.4, issue #375): "Send gift"
 * on the friends bar's card, a friend's row or a waiting gift's "Send one
 * back" opens it. The player picks Twigs, Pebbles, Putty or Goo; the server
 * works out the amount (3% of the lower of the two storage caps) and takes
 * nothing from the sender. One gift per friend per day: once sent, the store
 * marks the friend so every "Send gift" button turns off.
 *
 * Gift wishes (#391; reworked for the owner, 7 Nov): the friend's wishes are
 * ranked. Their first wish is the big main plate, the others under it, each
 * with the painted wish marker and its rank; a line over them says "Bob wants
 * Goo only" (one wish) or gives the order. The resources they did not wish
 * for shrink to a row of small tiles under "Or send". Any resource can still
 * be sent; a wished one earns nothing extra. With no wishes, the plain four.
 */

export const GIFT_TEXT = {
  title: "Send a gift",
  lead: (name: string): string => `Pick what to send ${name}. Gifts are free: one a day for each friend.`,
  sending: "Sending…",
  /**
   * "Sent to Bob · [putty] −300": the name in words, the gift as its icon and
   * amount, red with a minus as it left the yard (owner, 28 Oct).
   */
  sent: (gift: Gift, name: string): HTMLElement => {
    const line = document.createElement("span");
    line.append(`Sent to ${name} · `, resourceAmount(gift.resource, gift.amount, { change: "loss" }));
    return line;
  },
  cancel: "Cancel",
  done: "Done",
  /** The line over the choices when the friend wished for one resource only. */
  wishedOnly: (name: string, resource: GiftResource): string => `${name} wants ${RESOURCE_NAMES[resource]} only`,
  /**
   * The line over the choices when the friend wished for two or three, with a
   * small "best first" after it (tester, 7 Nov: the longer line wrapped on a
   * phone, leaving "first" alone; the hint now drops out when it has no room).
   */
  wishedOrder: (name: string): string => `${name}'s wishes`,
  bestFirst: "best first",
  /** Over the small tiles of the resources not wished for. */
  others: "Or send",
} as const;

/** Who the gift is for. */
export interface GiftTarget {
  readonly userid: number;
  readonly username: string;
  /** Their gift wishes; looked up in the friends list when left out. */
  readonly wishes?: readonly GiftResource[];
}

/** The four choices: the friend's wishes first in their order, then the rest in the usual order. */
export const choiceOrder = (wishes: readonly GiftResource[]): GiftResource[] => [
  ...wishes.filter((key, index) => RESOURCE_KEYS.includes(key) && wishes.indexOf(key) === index),
  ...RESOURCE_KEYS.filter((key) => !wishes.includes(key)),
];

export interface GiftPickerOptions {
  readonly api?: FriendsApi;
  readonly store?: FriendsStore;
  /** After a gift went. */
  readonly onSent?: (gift: Gift) => void;
}

export class GiftPicker {
  readonly popup: Popup;
  /** The gift sent, or null when the picker closed without one. */
  readonly closed: Promise<Gift | null>;

  private readonly target: GiftTarget;
  private readonly api: FriendsApi;
  private readonly store: FriendsStore;
  private readonly options: GiftPickerOptions;
  private readonly status = new StatusLine();
  private readonly choices = new Map<GiftResource, HTMLButtonElement>();
  private readonly cancel: HTMLButtonElement;
  private sent: Gift | null = null;
  private busy = false;

  constructor(target: GiftTarget, options: GiftPickerOptions = {}) {
    this.target = target;
    this.options = options;
    this.api = options.api ?? friendsApi;
    this.store = options.store ?? sharedStore;
    let settle: (gift: Gift | null) => void = () => {};
    this.closed = new Promise((resolve) => {
      settle = resolve;
    });
    this.popup = new Popup({
      title: GIFT_TEXT.title,
      className: "takeover-dialog gift-picker",
      onClose: () => settle(this.sent),
    });

    const lead = make("p", "takeover-dialog__lead", GIFT_TEXT.lead(target.username));
    const wishes = target.wishes ?? this.store.friends.find((friend) => friend.userid === target.userid)?.wishes ?? [];
    const order = choiceOrder(wishes);
    const wished = order.filter((key) => wishes.includes(key));
    const parts: HTMLElement[] = [lead];
    if (wished.length === 0) {
      // No wishes: the plain four, two by two.
      const grid = make("div", "gift-picker__choices");
      for (const key of order) grid.append(this.choice(key, "btn btn--outline gift-picker__choice"));
      parts.push(grid);
    } else {
      // "[marker] Bob wants Goo only" or "[marker] Bob's wishes  best first",
      // always one line: a long name ends in "…" and the hint drops out first.
      const words =
        wished.length === 1 ? GIFT_TEXT.wishedOnly(target.username, wished[0]!) : GIFT_TEXT.wishedOrder(target.username);
      const main = make("span", "gift-picker__legend-main");
      main.append(
        wishMark(null, "gift-picker__legend-mark"),
        make("span", "gift-picker__legend-name", target.username),
        make("span", "gift-picker__legend-rest", words.slice(target.username.length)),
      );
      const line = make("p", "gift-picker__legend");
      line.append(main);
      if (wished.length > 1) line.append(make("span", "gift-picker__legend-hint", GIFT_TEXT.bestFirst));
      // The first wish is the main plate (a clearly different colour), the rest under it.
      const list = make("div", "gift-picker__choices gift-picker__choices--wished");
      wished.forEach((key, index) => {
        const top = index === 0;
        const choice = this.choice(
          key,
          `btn ${top ? "btn--primary gift-picker__choice--top" : "btn--outline"} gift-picker__choice gift-picker__choice--wished`,
        );
        choice.dataset["rank"] = String(index + 1);
        choice.setAttribute("aria-label", `${RESOURCE_NAMES[key]} (wish ${index + 1})`);
        choice.append(wishMark(index + 1, "gift-picker__mark"));
        list.append(choice);
      });
      parts.push(line, list);
      const rest = order.filter((key) => !wishes.includes(key));
      if (rest.length > 0) {
        // The others: small square tiles, still one press to send.
        const row = make("div", "gift-picker__others");
        row.append(make("span", "gift-picker__others-label", GIFT_TEXT.others));
        for (const key of rest) {
          const tile = this.choice(key, "gift-wish gift-picker__other", false);
          tile.setAttribute("aria-label", RESOURCE_NAMES[key]);
          tile.title = RESOURCE_NAMES[key];
          row.append(tile);
        }
        parts.push(row);
      }
    }
    this.cancel = make("button", "btn btn--ghost", GIFT_TEXT.cancel);
    this.cancel.type = "button";
    this.cancel.addEventListener("click", () => this.popup.close());
    const actions = make("div", "takeover-dialog__actions");
    actions.append(this.cancel);
    this.popup.setContent(...parts, this.status.element, actions);
  }

  /** One choice button for `key`: its pile, its name unless `named` is false, one press sends. */
  private choice(key: GiftResource, className: string, named = true): HTMLButtonElement {
    const choice = make("button", className);
    choice.type = "button";
    choice.dataset["resource"] = key;
    choice.append(resourceIcon(key, { decorative: true }));
    if (named) choice.append(make("span", "gift-picker__name", RESOURCE_NAMES[key]));
    choice.addEventListener("click", () => void this.send(key));
    this.choices.set(key, choice);
    return choice;
  }

  get statusText(): string {
    return this.status.text;
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    this.choices.values().next().value?.focus();
    return this;
  }

  /** Sends the gift in `resource`; a refusal is said and the picker stays open. */
  async send(resource: GiftResource): Promise<void> {
    if (this.busy || this.sent) return;
    this.busy = true;
    this.setChoicesDisabled(true);
    this.status.set(GIFT_TEXT.sending);
    try {
      const gift = (await this.api.sendGift(this.target.userid, resource)) ?? {
        id: 0,
        userid: this.target.userid,
        username: this.target.username,
        pic: null,
        level: 0,
        resource,
        amount: 0,
        createdAt: null,
        expiresAt: null,
        canSendBack: false,
      };
      this.sent = gift;
      this.store.markGifted(this.target.userid);
      this.status.set(GIFT_TEXT.sent(gift, this.target.username));
      this.cancel.textContent = GIFT_TEXT.done;
      this.cancel.focus();
      this.options.onSent?.(gift);
    } catch (caught) {
      const refusal = friendRefusal(caught);
      this.status.set(refusal.message, "error");
      if (refusal.reason === "giftSentToday") {
        // Sent from somewhere else today: every button for them turns off.
        this.store.markGifted(this.target.userid);
      } else {
        this.setChoicesDisabled(false);
      }
    } finally {
      this.busy = false;
    }
  }

  private setChoicesDisabled(disabled: boolean): void {
    for (const choice of this.choices.values()) choice.disabled = disabled;
  }
}

/** Opens the picker for a friend in `container` (the page when none). */
export const openGiftPicker = (
  target: GiftTarget,
  container: HTMLElement | null = null,
  options: GiftPickerOptions = {},
): GiftPicker => new GiftPicker(target, options).mount(container ?? document.body);
