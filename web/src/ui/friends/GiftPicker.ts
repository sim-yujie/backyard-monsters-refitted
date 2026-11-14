import { friendRefusal, friendsApi, type FriendsApi, type Gift, type GiftCost, type GiftResource } from "@/api/friends";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { playerPool } from "@/game/friends/friendsView";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { RESOURCE_KEYS, resourceAmount, resourceIcon, resourceName } from "@/ui/resourceIcon";
import { ignoreHeldEnter, make, StatusLine } from "./rows";
import { wishMark } from "./wishMark";
import "./friends.css";

/**
 * The gift picker (`docs/design/friends.md` §3.4, issue #375): "Send gift"
 * on the friends bar's card, a friend's row or a waiting gift's "Send one
 * back" opens it. The player picks Twigs, Pebbles, Putty or Goo; the server
 * works out the amount (3% of the lower of the two storage caps) and takes
 * it from the sender's yard (owner, 7 Nov 2026). One gift per friend per day: once sent, the store
 * marks the friend so every "Send gift" button turns off.
 *
 * Gift wishes (#391; reworked for the owner, 7 Nov): the friend's wishes are
 * ranked. Their first wish is the big main plate, the others under it, each
 * with the painted wish marker and its rank; a line over them says "Bob wants
 * Goo only" (one wish) or gives the order. The resources they did not wish
 * for shrink to a row of small tiles under "Or send". Any resource can still
 * be sent; a wished one earns nothing extra. With no wishes, the plain four.
 *
 * Owner, 13 Nov 2026 ("the friends window closes after sending to one
 * friend"): the picker opens over the list it came from and closes itself a
 * moment after the gift went, so the player is straight back on the list
 * with that friend's button saying "Sent". On opening it asks what one gift
 * to this friend is worth (`giftCost`) and greys out each resource the
 * player holds less of; pressing a greyed one says what it needs instead of
 * sending.
 */

export const GIFT_TEXT = {
  title: "Send a gift",
  lead: (name: string): string => `Pick what to send ${name}. It comes out of your storage: one gift a day for each friend.`,
  sending: "Sending…",
  /**
   * "Sent to Bob · [putty] −300": the name in words, the gift as its icon and
   * amount, red with a minus as it left the yard (owner, 28 Oct).
   */
  sent: (gift: Gift, name: string): HTMLElement => {
    const line = document.createElement("span");
    line.append(`Sent to ${name} · `, resourceAmount(gift.resource, gift.amount, { change: "loss", realm: "surface" }));
    return line;
  },
  cancel: "Cancel",
  done: "Done",
  /** "Gift: 691,500": one gift's size, the same in every resource. */
  size: (amount: number): string => `Gift: ${formatAmount(amount)}`,
  /** On a greyed choice: what the gift needs and what the player has. */
  short: (resource: GiftResource, need: number, have: number): string =>
    `Not enough ${resourceName(resource, "surface")}: need ${formatAmount(need)}, you have ${formatAmount(have)}`,
  /** The line over the choices when the friend wished for one resource only. */
  wishedOnly: (name: string, resource: GiftResource): string => `${name} wants ${resourceName(resource, "surface")} only`,
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
  /**
   * How long the "Sent" line shows before the picker closes itself, in ms
   * (owner, 13 Nov 2026: back to the list after each gift); null keeps it
   * open until Done.
   */
  readonly closeAfterSentMs?: number | null;
}

/** How long the "Sent" line shows before the picker closes itself. */
export const GIFT_PICKER_CLOSE_MS = 900;

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
  private readonly size = make("p", "gift-picker__size");
  private sent: Gift | null = null;
  private busy = false;
  /** One gift's size and what the player holds, once known; each choice short of it is greyed. */
  private cost: GiftCost | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

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
      onClose: () => {
        if (this.closeTimer !== null) clearTimeout(this.closeTimer);
        settle(this.sent);
      },
    });

    // The first choice has the focus: a held Enter (the press that opened this) must not send it.
    ignoreHeldEnter(this.popup.backdrop);

    const lead = make("p", "takeover-dialog__lead", GIFT_TEXT.lead(target.username));
    const wishes = target.wishes ?? this.store.friends.find((friend) => friend.userid === target.userid)?.wishes ?? [];
    const order = choiceOrder(wishes);
    const wished = order.filter((key) => wishes.includes(key));
    this.size.hidden = true;
    const parts: HTMLElement[] = [lead, this.size];
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
        choice.setAttribute("aria-label", `${resourceName(key, "surface")} (wish ${index + 1})`);
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
          tile.setAttribute("aria-label", resourceName(key, "surface"));
          tile.title = resourceName(key, "surface");
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
    choice.append(resourceIcon(key, { decorative: true, realm: "surface" }));
    if (named) choice.append(make("span", "gift-picker__name", resourceName(key, "surface")));
    choice.addEventListener("click", () => {
      const short = this.shortOf(key);
      if (short) this.status.set(GIFT_TEXT.short(key, short.need, short.have), "error");
      else void this.send(key);
    });
    this.choices.set(key, choice);
    return choice;
  }

  get statusText(): string {
    return this.status.text;
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    this.choices.values().next().value?.focus();
    void this.loadCost();
    return this;
  }

  /** Asks what one gift is worth and greys what the player cannot afford; a failure leaves every choice open. */
  async loadCost(): Promise<void> {
    try {
      this.cost = await this.api.giftCost(this.target.userid);
    } catch {
      return;
    }
    if (this.sent || this.cost.amount <= 0) return;
    this.size.textContent = GIFT_TEXT.size(this.cost.amount);
    this.size.hidden = false;
    this.markShort();
  }

  /** What the player holds of `key`: the yard on screen when there is one, else the server's figure. */
  private heldOf(key: GiftResource): number {
    const live = playerPool()?.read()?.resources[key];
    return typeof live === "number" ? live : (this.cost?.resources[key] ?? 0);
  }

  /** What a gift in `key` needs and what the player has, when the player has too little; null otherwise. */
  private shortOf(key: GiftResource): { need: number; have: number } | null {
    if (!this.cost || this.cost.amount <= 0) return null;
    const have = Math.floor(this.heldOf(key));
    return have < this.cost.amount ? { need: this.cost.amount, have } : null;
  }

  /** Greys each choice the player cannot afford: still pressable (a tap says why), but not sent. */
  private markShort(): void {
    for (const [key, choice] of this.choices) {
      const short = this.shortOf(key);
      choice.classList.toggle("is-short", short !== null);
      if (short) {
        choice.setAttribute("aria-disabled", "true");
        choice.title = GIFT_TEXT.short(key, short.need, short.have);
      } else {
        choice.removeAttribute("aria-disabled");
        if (choice.classList.contains("gift-picker__other")) choice.title = resourceName(key, "surface");
        else choice.removeAttribute("title");
      }
    }
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
      // The gift left the player's storage: the yard on screen reads it fresh.
      playerPool()?.refresh();
      this.options.onSent?.(gift);
      // Back to the list it came from (owner, 13 Nov 2026), once the "Sent" line has been seen.
      const wait = this.options.closeAfterSentMs === undefined ? GIFT_PICKER_CLOSE_MS : this.options.closeAfterSentMs;
      if (wait !== null) this.closeTimer = setTimeout(() => this.popup.close(), wait);
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
