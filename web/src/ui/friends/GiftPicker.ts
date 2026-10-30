import { friendRefusal, friendsApi, type FriendsApi, type Gift, type GiftResource } from "@/api/friends";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { Popup } from "@/ui/Popup";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount, resourceIcon } from "@/ui/resourceIcon";
import { make, StatusLine } from "./rows";
import "./friends.css";

/**
 * The gift picker (`docs/design/friends.md` §3.4, issue #375): "Send gift"
 * on the friends bar's card, a friend's row or a waiting gift's "Send one
 * back" opens it. The player picks Twigs, Pebbles, Putty or Goo; the server
 * works out the amount (3% of the lower of the two storage caps) and takes
 * nothing from the sender. One gift per friend per day: once sent, the store
 * marks the friend so every "Send gift" button turns off.
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
} as const;

/** Who the gift is for. */
export interface GiftTarget {
  readonly userid: number;
  readonly username: string;
}

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
    const grid = make("div", "gift-picker__choices");
    for (const key of RESOURCE_KEYS) {
      const choice = make("button", "btn btn--outline gift-picker__choice");
      choice.type = "button";
      choice.dataset["resource"] = key;
      choice.append(resourceIcon(key, { decorative: true }), make("span", "gift-picker__name", RESOURCE_NAMES[key]));
      choice.addEventListener("click", () => void this.send(key));
      this.choices.set(key, choice);
      grid.append(choice);
    }
    this.cancel = make("button", "btn btn--ghost", GIFT_TEXT.cancel);
    this.cancel.type = "button";
    this.cancel.addEventListener("click", () => this.popup.close());
    const actions = make("div", "takeover-dialog__actions");
    actions.append(this.cancel);
    this.popup.setContent(lead, grid, this.status.element, actions);
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
