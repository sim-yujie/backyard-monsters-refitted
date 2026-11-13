import { friendRefusal, friendsApi, type FriendsApi, type GiftAllResult, type GiftResource } from "@/api/friends";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { playerPool } from "@/game/friends/friendsView";
import { formatAmount } from "@/ui/format";
import { gameIcon } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { RESOURCE_KEYS, resourceAmount, resourceIcon, resourceName } from "@/ui/resourceIcon";
import { ignoreHeldEnter, make, StatusLine } from "./rows";
import { wishMark } from "./wishMark";
import "./friends.css";

/**
 * Gift all (owner, 13 Nov 2026: "Can you make it easier to send gifts to
 * multiple people?"): one gift to every friend who can take one from the
 * player today, from the Friends window or the Friends tab.
 *
 * - Each friend gets their first wish; a friend with no wish gets the
 *   resource picked beside "3 with no wish get:", which starts on the one
 *   the player holds most of. The row shows only when a friend has no wish.
 * - It opens on the plan (`giftAllPlan`): how many friends, each friend and
 *   what they get, the total per resource, and who is left out because the
 *   store runs short (they fall back to their next wish first). Nothing goes
 *   until **Send to 9** is pressed.
 * - The send (`giftAll`) goes to the friends the player saw and no one else;
 *   the server plans it again under the yard's lock, so the answer is what
 *   really went. Each sent friend's "Send gift" turns to "Sent".
 * - The pick, the count and the cost stay at the top and Cancel and Send at
 *   the bottom; only the friends between them scroll, however many there are.
 * - Nothing is focused on Send when it opens, and a held Enter presses
 *   nothing, so a stray Enter cannot send gifts unseen.
 */

export const GIFT_ALL_TEXT = {
  title: "Gift all",
  button: "Gift all",
  buttonTitle: "Send a gift to every friend who can take one today",
  buttonDoneTitle: "Every friend has a gift from you today",
  /** Over the pick: how many friends it is for. */
  fallback: (count: number): string => (count === 1 ? "1 with no wish gets:" : `${formatAmount(count)} with no wish get:`),
  fallbackGroup: "For friends with no wish",
  fallbackTitle: (resource: GiftResource): string => `Friends with no wish get ${resourceName(resource, "surface")}`,
  loading: "Working it out…",
  friends: (count: number): string => (count === 1 ? "1 friend" : `${formatAmount(count)} friends`),
  none: "No friends can take a gift from you today.",
  notSent: "Not sent",
  notEnough: "not enough",
  alreadySent: "already sent today",
  cannotSend: "can't take a gift now",
  noneSent: "No gifts sent",
  send: (count: number): string => `Send to ${formatAmount(count)}`,
  sending: "Sending…",
  sent: (count: number): string => (count === 1 ? "Sent to 1 friend" : `Sent to ${formatAmount(count)} friends`),
  cancel: "Cancel",
  done: "Done",
} as const;

export interface GiftAllOptions {
  readonly api?: FriendsApi;
  readonly store?: FriendsStore;
  /** After the gifts went. */
  readonly onSent?: (result: GiftAllResult) => void;
}

export class GiftAll {
  readonly popup: Popup;
  /** What was sent, or null when it closed without sending. */
  readonly closed: Promise<GiftAllResult | null>;

  private readonly api: FriendsApi;
  private readonly store: FriendsStore;
  private readonly options: GiftAllOptions;
  private readonly picks = new Map<GiftResource, HTMLButtonElement>();
  private readonly fallbackRow = make("div", "gift-all__fallback");
  private readonly fallbackLabel = make("span", "gift-all__fallback-label");
  private readonly summary = make("div", "gift-all__summary");
  private readonly list = make("ul", "gift-all__list");
  private readonly skipped = make("div", "gift-all__skipped");
  /** The friends and who is left out: the one part that scrolls. */
  private readonly scroll = make("div", "gift-all__scroll");
  private readonly status = new StatusLine();
  private readonly cancel: HTMLButtonElement;
  private readonly sendButton: HTMLButtonElement;
  private plan: GiftAllResult | null = null;
  private sent: GiftAllResult | null = null;
  private busy = false;
  /** Bumped by each plan asked for, so an older answer arriving late is dropped. */
  private asked = 0;

  constructor(options: GiftAllOptions = {}) {
    this.options = options;
    this.api = options.api ?? friendsApi;
    this.store = options.store ?? sharedStore;
    let settle: (result: GiftAllResult | null) => void = () => {};
    this.closed = new Promise((resolve) => {
      settle = resolve;
    });
    this.popup = new Popup({
      title: GIFT_ALL_TEXT.title,
      className: "takeover-dialog gift-all",
      onClose: () => settle(this.sent),
    });

    // A held Enter (the press that opened this) presses nothing here.
    ignoreHeldEnter(this.popup.backdrop);

    // "3 with no wish get: [twigs] [pebbles] [putty] [goo]": the resource for friends with no wish.
    const tiles = make("div", "gift-all__fallback-tiles");
    tiles.setAttribute("role", "group");
    tiles.setAttribute("aria-label", GIFT_ALL_TEXT.fallbackGroup);
    for (const key of RESOURCE_KEYS) {
      const tile = make("button", "gift-wish gift-all__pick");
      tile.type = "button";
      tile.dataset["resource"] = key;
      tile.title = GIFT_ALL_TEXT.fallbackTitle(key);
      tile.setAttribute("aria-label", GIFT_ALL_TEXT.fallbackTitle(key));
      tile.setAttribute("aria-pressed", "false");
      tile.append(resourceIcon(key, { decorative: true, realm: "surface" }));
      tile.addEventListener("click", () => void this.choose(key));
      this.picks.set(key, tile);
      tiles.append(tile);
    }
    this.fallbackRow.append(this.fallbackLabel, tiles);
    this.fallbackRow.hidden = true;
    this.scroll.append(this.list, this.skipped);
    this.scroll.hidden = true;
    // Reachable by keyboard when it scrolls.
    this.scroll.tabIndex = 0;

    this.cancel = make("button", "btn btn--ghost", GIFT_ALL_TEXT.cancel);
    this.cancel.type = "button";
    this.cancel.addEventListener("click", () => this.popup.close());
    this.sendButton = make("button", "btn btn--primary gift-all__send", GIFT_ALL_TEXT.send(0));
    this.sendButton.type = "button";
    this.sendButton.disabled = true;
    this.sendButton.addEventListener("click", () => void this.send());
    const actions = make("div", "takeover-dialog__actions");
    actions.append(this.cancel, this.sendButton);
    this.popup.setContent(this.fallbackRow, this.summary, this.scroll, this.status.element, actions);
  }

  get statusText(): string {
    return this.status.text;
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    void this.load();
    return this;
  }

  /** Asks for the plan, with friends with no wish getting `fallback` (the most held when left out). */
  async load(fallback?: GiftResource): Promise<void> {
    const ask = ++this.asked;
    this.sendButton.disabled = true;
    this.status.set(GIFT_ALL_TEXT.loading);
    try {
      const plan = await this.api.giftAllPlan(fallback);
      if (ask !== this.asked || this.sent) return;
      this.plan = plan;
      this.status.set(null);
      this.show(plan, false);
    } catch (caught) {
      if (ask !== this.asked) return;
      this.status.set(friendRefusal(caught).message, "error");
      // The plan on screen is still the last one that arrived: its pick stays lit and it can still be sent.
      if (this.plan) {
        this.markPick(this.plan.fallback);
        this.sendButton.disabled = this.plan.gifts.length === 0;
      }
    }
  }

  private async choose(key: GiftResource): Promise<void> {
    if (this.busy || this.sent || this.plan?.fallback === key) return;
    this.markPick(key);
    await this.load(key);
  }

  private markPick(key: GiftResource): void {
    for (const [resource, tile] of this.picks) tile.setAttribute("aria-pressed", String(resource === key));
  }

  /** Draws a plan (or, `sent`, what went): the count and cost, each friend's gift, who is left out. */
  private show(result: GiftAllResult, sent: boolean): void {
    this.markPick(result.fallback);
    const count = result.gifts.length;
    const head = make("p", "gift-all__count");
    if (count === 0 && !sent) {
      head.append(make("span", "gift-all__none", GIFT_ALL_TEXT.none));
    } else {
      head.append(
        gameIcon("gift", { size: 24, decorative: true }),
        make(
          "span",
          "gift-all__count-words",
          !sent ? GIFT_ALL_TEXT.friends(count) : count === 0 ? GIFT_ALL_TEXT.noneSent : GIFT_ALL_TEXT.sent(count),
        ),
      );
    }
    const cost = make("p", "gift-all__cost");
    for (const key of RESOURCE_KEYS) {
      if (result.cost[key] > 0) cost.append(resourceAmount(key, result.cost[key], { change: "loss", realm: "surface" }));
    }
    this.summary.replaceChildren(head, ...(cost.childElementCount > 0 ? [cost] : []));

    this.list.replaceChildren(
      ...result.gifts.map((gift) => {
        const row = make("li", "gift-all__row");
        row.dataset["userid"] = String(gift.userid);
        const name = make("span", "gift-all__name", gift.username);
        name.title = gift.username;
        row.append(name);
        if (gift.wish > 0) row.append(wishMark(gift.wish, "gift-all__mark"));
        row.append(resourceAmount(gift.resource, gift.amount, { realm: "surface", className: "gift-all__amount" }));
        return row;
      }),
    );
    this.list.hidden = result.gifts.length === 0;

    // "Not sent: Max · not enough [goo]".
    this.skipped.replaceChildren();
    if (result.skipped.length > 0) {
      this.skipped.append(make("p", "gift-all__skipped-head", `${GIFT_ALL_TEXT.notSent}:`));
      const lines = make("ul", "gift-all__skipped-list");
      for (const skip of result.skipped) {
        const line = make("li", "gift-all__skip");
        line.dataset["userid"] = String(skip.userid);
        line.append(make("span", "gift-all__name", skip.username), " · ");
        if (skip.reason === "giftSentToday") {
          line.append(GIFT_ALL_TEXT.alreadySent);
        } else if (skip.reason === "cannotSend") {
          line.append(GIFT_ALL_TEXT.cannotSend);
        } else {
          line.append(`${GIFT_ALL_TEXT.notEnough} `);
          for (const key of skip.lacking) {
            const icon = resourceIcon(key, { realm: "surface" });
            icon.classList.add("gift-all__lack");
            line.append(icon);
          }
        }
        lines.append(line);
      }
      this.skipped.append(lines);
    }

    this.sendButton.textContent = GIFT_ALL_TEXT.send(count);
    this.sendButton.disabled = sent || count === 0;
    this.sendButton.hidden = sent;
    this.skipped.hidden = result.skipped.length === 0;
    this.scroll.hidden = result.gifts.length === 0 && result.skipped.length === 0;
    this.scroll.scrollTop = 0;
    // The pick matters only when a friend has no wish.
    this.fallbackLabel.textContent = GIFT_ALL_TEXT.fallback(result.noWish);
    this.fallbackRow.hidden = sent || result.noWish === 0;
  }

  /** Sends the plan the player saw, to those friends only. */
  async send(): Promise<void> {
    const plan = this.plan;
    if (this.busy || this.sent || !plan || plan.gifts.length === 0) return;
    this.busy = true;
    this.sendButton.disabled = true;
    this.status.set(GIFT_ALL_TEXT.sending);
    try {
      const result = await this.api.giftAll(
        plan.fallback,
        plan.gifts.map((gift) => gift.userid),
      );
      this.sent = result;
      this.status.set(null);
      // Gifted today: their "Send gift" buttons turn to "Sent" everywhere.
      for (const gift of result.gifts) this.store.markGifted(gift.userid);
      for (const skip of result.skipped) if (skip.reason === "giftSentToday") this.store.markGifted(skip.userid);
      // A friend who dropped out since comes back without a name when no longer a friend: the plan had it.
      const names = new Map(plan.gifts.map((gift) => [gift.userid, gift.username]));
      const dropped = result.skipped.map((skip) => ({ ...skip, username: names.get(skip.userid) ?? skip.username }));
      // The plan's own skips stay listed with the send's.
      const skipped = [...dropped, ...plan.skipped.filter((skip) => !dropped.some((s) => s.userid === skip.userid))];
      this.show({ ...result, skipped }, true);
      this.cancel.textContent = GIFT_ALL_TEXT.done;
      this.cancel.focus();
      playerPool()?.refresh();
      this.options.onSent?.(result);
    } catch (caught) {
      this.status.set(friendRefusal(caught).message, "error");
      this.sendButton.disabled = false;
    } finally {
      this.busy = false;
    }
  }
}

/** Opens Gift all in `container` (the page when none). */
export const openGiftAll = (container: HTMLElement | null = null, options: GiftAllOptions = {}): GiftAll =>
  new GiftAll(options).mount(container ?? document.body);

/**
 * The "[gift] Gift all" button the Friends window and the Friends tab carry;
 * off when every friend already has a gift from the player today.
 */
export const giftAllButton = (onPress: () => void, className = ""): HTMLButtonElement => {
  const button = make("button", `btn btn--outline gift-all-button ${className}`.trim());
  button.type = "button";
  button.title = GIFT_ALL_TEXT.buttonTitle;
  button.setAttribute("aria-label", GIFT_ALL_TEXT.buttonTitle);
  button.append(gameIcon("gift", { size: 24, decorative: true }), make("span", "gift-all-button__word", GIFT_ALL_TEXT.button));
  button.addEventListener("click", onPress);
  return button;
};

/** Switches a Gift all button off once every friend has a gift from the player today, and says so. */
export const setGiftAllDone = (button: HTMLButtonElement, friends: readonly { readonly giftSentToday: boolean }[]): void => {
  const done = !friends.some((friend) => !friend.giftSentToday);
  const title = done && friends.length > 0 ? GIFT_ALL_TEXT.buttonDoneTitle : GIFT_ALL_TEXT.buttonTitle;
  button.disabled = done;
  button.title = title;
  button.setAttribute("aria-label", title);
};
