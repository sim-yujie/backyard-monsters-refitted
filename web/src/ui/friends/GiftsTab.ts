import { friendRefusal, GIFT_WISH_MAX, type FriendsApi, type Gift, type GiftResource, type ResourceAmounts } from "@/api/friends";
import type { FriendsStore } from "@/game/friends/friendsStore";
import { playerPool, type PlayerPool } from "@/game/friends/friendsView";
import { formatAmount } from "@/ui/format";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount, resourceIcon } from "@/ui/resourceIcon";
import { openGiftPicker, type GiftTarget } from "./GiftPicker";
import { button, make, playerRow, section, StatusLine, type FriendsTabView } from "./rows";
import { wishesSummary, wishMark } from "./wishMark";

/**
 * The Friends screen's **Gifts** tab (`docs/design/friends.md` §3.4, issue
 * #375): the gifts waiting, oldest first (the first to lapse), each with
 * **Collect** and **Send one back**, and **Collect all** above them.
 * Collecting adds the resource to the main yard up to its storage cap; when
 * there is not room for all of it, the first press warns and a second one
 * collects anyway. At most 10 a day (owner, 9 Nov 2026: was 5); the rest
 * wait, and a gift lapses after 7 days. Fetched fresh each time the tab comes
 * forward.
 *
 * Deleting (owner, 9 Nov 2026): each gift has the look's painted close disc;
 * pressing it turns the row into "Delete?" with **Delete** and **Cancel**.
 * With 2 or more waiting, **Delete all** sits beside Collect all and asks the
 * same way. A deleted gift gives nothing and uses none of the day's collects.
 *
 * Above the gifts, **My wishes** (#391; ranked since the owner's 7 Nov
 * note): four resource tiles; tapping one adds it as the next wish (1, 2, 3,
 * shown by the painted wish marker on its corner), tapping it again takes it
 * out and the ones after move up. One wish alone means "that one only", and
 * the line beside the title says so ("Goo only"); two or three read "Goo >
 * Twigs". Friends see them in that order when they send a gift. Saved at
 * once; a failed save puts the last saved wishes back.
 */

export interface GiftsTabOptions {
  readonly api: FriendsApi;
  readonly store: FriendsStore;
  /** Opens the gift picker for "Send one back"; the picker in the page by default. */
  readonly onSendBack?: (target: GiftTarget, sent: () => void) => void;
  /** Unix seconds now, for "3 days left". */
  readonly now?: () => number;
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** "6 days left", "1 day left", "5 h left", "Less than an hour left". */
export const lapseText = (expiresAt: number, now: number): string => {
  const left = expiresAt - now;
  if (left >= 2 * DAY) return `${Math.floor(left / DAY)} days left`;
  if (left >= DAY) return "1 day left";
  if (left >= HOUR) return `${Math.floor(left / HOUR)} h left`;
  return "Less than an hour left";
};

/** "300 Twigs and 1,200 Goo". */
const amountsText = (amounts: ResourceAmounts): string => {
  const parts = RESOURCE_KEYS.filter((key) => (amounts[key] ?? 0) > 0).map(
    (key) => `${formatAmount(amounts[key] ?? 0)} ${RESOURCE_NAMES[key]}`,
  );
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

/** What would not fit under the cap if `amounts` were credited now; empty when all fits or the pool is unknown. */
export const overflowOf = (amounts: ResourceAmounts, pool: PlayerPool | null): ResourceAmounts => {
  const out: ResourceAmounts = {};
  if (!pool?.caps) return out;
  for (const key of RESOURCE_KEYS) {
    const adding = amounts[key] ?? 0;
    if (adding <= 0) continue;
    const room = Math.max(0, pool.caps[key] - (pool.resources[key] ?? 0));
    if (adding > room) out[key] = adding - room;
  }
  return out;
};

const isEmpty = (amounts: ResourceAmounts): boolean => RESOURCE_KEYS.every((key) => (amounts[key] ?? 0) <= 0);

const totalOf = (gifts: readonly Gift[]): ResourceAmounts => {
  const out: Partial<Record<GiftResource, number>> = {};
  for (const gift of gifts) out[gift.resource] = (out[gift.resource] ?? 0) + gift.amount;
  return out;
};

export const GIFTS_TEXT = {
  waiting: "Gifts waiting",
  none: "No gifts waiting. Friends can send you one gift a day each.",
  loading: "Loading gifts…",
  loadFailed: "Your gifts could not load. Try again.",
  collect: "Collect",
  collectAnyway: "Collect anyway",
  collectAll: "Collect all",
  collectAllAnyway: "Collect all anyway",
  sendBack: "Send one back",
  sentBack: "Gift sent today",
  /** The daily counter: short, the number first (owner: numbers over words). */
  left: (count: number): string => (count > 0 ? `${count} left today` : "None left today. The rest wait."),
  delete: "Delete",
  /** The painted disc's name, for a screen reader and a mouse hover. */
  deleteTitle: "Delete gift",
  deleteAsk: "Delete? You get nothing.",
  deleteAll: "Delete all",
  deleteAllAsk: (count: number): string => `Delete all ${count}?`,
  cancel: "Cancel",
  deleted: (count: number): string => (count === 1 ? "Gift deleted." : `${count} gifts deleted.`),
  /** "Collected · [twig] +1,000 [goo] +500", green with a plus as gains (owner, 28 Oct). */
  collected: (amounts: ResourceAmounts): HTMLElement => {
    const line = document.createElement("span");
    const gained = RESOURCE_KEYS.filter((key) => (amounts[key] ?? 0) >= 1).map((key) =>
      resourceAmount(key, amounts[key] ?? 0, { change: "gain" }),
    );
    if (gained.length === 0) {
      line.append("Collected · nothing");
      return line;
    }
    const list = document.createElement("span");
    list.className = "res-list";
    list.append(...gained);
    line.append("Collected · ", list);
    return line;
  },
  collectedNothing: "Your storage is full, so nothing was added.",
  short: (lost: ResourceAmounts): string =>
    `Your storage is too full: ${amountsText(lost)} would be lost. Press again to collect anyway.`,
  underAttack: "Your yard is under attack right now. Collect when the attack is over.",
  wishes: "My wishes",
  /** The line beside the title with no wishes yet. */
  wishesHint: `Tap up to ${GIFT_WISH_MAX}, best first`,
  wishesFailed: "Your wishes could not be saved. Try again.",
} as const;

export class GiftsTab implements FriendsTabView {
  readonly element: HTMLElement;

  private readonly options: GiftsTabOptions;
  private readonly now: () => number;
  private readonly summary: HTMLElement;
  private readonly status = new StatusLine();
  private readonly body: HTMLElement;
  private readonly wishBar: HTMLElement;
  private gifts: Gift[] = [];
  /** The wishes shown (saved or being saved), and the last the server confirmed. */
  private wishes: GiftResource[] = [];
  private savedWishes: GiftResource[] = [];
  /** Bumped by every wish save, so only the latest answer counts. */
  private wishSave = 0;
  private collectsLeft = 0;
  private loaded = false;
  private busy = false;
  /** The gift id (or "all") whose short-storage warning is showing: the next press collects. */
  private warned: number | "all" | null = null;
  /** The gift id (or "all") whose "Delete?" question is showing. */
  private asking: number | "all" | null = null;
  /** Bumped by every fetch, so a late answer is dropped. */
  private generation = 0;
  private destroyed = false;

  constructor(options: GiftsTabOptions) {
    this.options = options;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.element = make("div", "friends-tab friends-tab--gifts");
    this.summary = make("div", "friends-summary gifts-summary");
    this.body = make("div", "friends-tab__body");
    this.wishBar = make("div", "gift-wishes");
    this.element.append(this.summary, this.wishBar, this.status.element, this.body);
  }

  get statusText(): string {
    return this.status.text;
  }

  async show(): Promise<void> {
    const generation = ++this.generation;
    this.warned = null;
    this.asking = null;
    if (!this.loaded) this.status.set(GIFTS_TEXT.loading);
    try {
      const { gifts, collectsLeft, wishes } = await this.options.api.gifts();
      if (this.destroyed || generation !== this.generation) return;
      this.gifts = [...gifts];
      // Not while a wish change is still being saved.
      if (this.sameWishes(this.wishes, this.savedWishes)) {
        this.wishes = [...wishes];
        this.savedWishes = [...wishes];
      }
      this.collectsLeft = collectsLeft;
      this.loaded = true;
      if (this.status.text === GIFTS_TEXT.loading) this.status.set(null);
      this.options.store.setGiftsWaiting(this.gifts.length);
      this.render();
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      this.status.set(GIFTS_TEXT.loadFailed, "error");
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.generation++;
    this.element.remove();
  }

  private render(): void {
    if (!this.loaded) return;
    const now = this.now();
    if (this.asking === "all" && this.gifts.length < 2) this.asking = null;
    if (typeof this.asking === "number" && !this.gifts.some((gift) => gift.id === this.asking)) this.asking = null;
    this.renderSummary();
    this.renderWishes();

    const rows = this.gifts.map((gift) => {
      if (this.asking === gift.id) return this.askRow(gift);
      const collect = button(
        this.warned === gift.id ? GIFTS_TEXT.collectAnyway : GIFTS_TEXT.collect,
        () => void this.collect(gift),
        "primary",
      );
      collect.disabled = this.busy || this.collectsLeft === 0;
      const back = button(gift.canSendBack ? GIFTS_TEXT.sendBack : GIFTS_TEXT.sentBack, () => this.sendBack(gift));
      back.disabled = this.busy || !gift.canSendBack;
      const row = playerRow(gift, {
        ...(gift.expiresAt !== null && { note: lapseText(gift.expiresAt, now) }),
        actions: [collect, back, this.deleteButton(gift)],
      });
      row.dataset["giftid"] = String(gift.id);
      row.querySelector(".friends-row__text")?.append(resourceAmount(gift.resource, gift.amount, { change: "gain", className: "gift-amount" }));
      return row;
    });
    this.body.replaceChildren(section(GIFTS_TEXT.waiting, rows, GIFTS_TEXT.none));
  }

  /** The line above the list: "10 left today", Delete all (2 or more waiting), Collect all; or the Delete all question. */
  private renderSummary(): void {
    const buttons = make("div", "gifts-summary__buttons");
    this.summary.classList.toggle("gifts-summary--confirm", this.asking === "all");
    if (this.asking === "all") {
      const yes = button(GIFTS_TEXT.deleteAll, () => void this.remove("all"), "danger");
      yes.disabled = this.busy;
      buttons.append(yes, button(GIFTS_TEXT.cancel, () => this.ask(null)));
      this.summary.replaceChildren(make("p", "gifts-summary__left gifts-summary__ask", GIFTS_TEXT.deleteAllAsk(this.gifts.length)), buttons);
      return;
    }
    if (this.gifts.length >= 2) {
      // Red in both looks: it throws gifts away, unlike the friendly plates beside it.
      const dropAll = button(GIFTS_TEXT.deleteAll, () => this.ask("all"), "danger");
      dropAll.classList.add("gifts-summary__delete-all");
      dropAll.disabled = this.busy;
      buttons.append(dropAll);
    }
    const all = button(
      this.warned === "all" ? GIFTS_TEXT.collectAllAnyway : GIFTS_TEXT.collectAll,
      () => void this.collect("all"),
      "primary",
    );
    all.classList.add("gifts-summary__all");
    all.disabled = this.busy || this.gifts.length === 0 || this.collectsLeft === 0;
    buttons.append(all);
    this.summary.replaceChildren(make("p", "gifts-summary__left", GIFTS_TEXT.left(this.collectsLeft)), buttons);
  }

  /** The look's painted close disc; its words only for a screen reader and a hover. */
  private deleteButton(gift: Gift): HTMLButtonElement {
    const node = make("button", "btn btn--ghost btn--icon friends-row__action gift-delete");
    node.type = "button";
    node.title = GIFTS_TEXT.deleteTitle;
    node.setAttribute("aria-label", `${GIFTS_TEXT.deleteTitle}: ${gift.username}`);
    node.disabled = this.busy;
    node.append(make("span", "gift-delete__disc"));
    node.addEventListener("click", () => this.ask(gift.id));
    return node;
  }

  /** A gift's row asking "Delete?": the amount stays in view, so the player sees what goes. */
  private askRow(gift: Gift): HTMLLIElement {
    const yes = button(GIFTS_TEXT.delete, () => void this.remove(gift), "danger");
    yes.disabled = this.busy;
    const no = button(GIFTS_TEXT.cancel, () => this.ask(null));
    const row = playerRow(gift, { note: GIFTS_TEXT.deleteAsk, actions: [yes, no] });
    row.classList.add("friends-row--confirm");
    row.dataset["giftid"] = String(gift.id);
    row.querySelector(".friends-row__text")?.append(resourceAmount(gift.resource, gift.amount, { className: "gift-amount" }));
    return row;
  }

  /** Shows (or with null, closes) the "Delete?" question for one gift or for all. */
  private ask(which: number | "all" | null): void {
    if (this.busy) return;
    this.asking = which;
    this.warned = null;
    this.render();
  }

  /** Deletes one gift or every one waiting; nothing is given and no collect is used. */
  private async remove(which: Gift | "all"): Promise<void> {
    if (this.busy) return;
    this.asking = null;
    this.busy = true;
    this.render();
    try {
      const answer = await this.options.api.deleteGifts(which === "all" ? "all" : which.id);
      this.gifts = which === "all" ? [] : this.gifts.filter((gift) => gift.id !== which.id);
      this.collectsLeft = answer.collectsLeft;
      this.options.store.setGiftsWaiting(answer.giftsWaiting);
      this.status.set(GIFTS_TEXT.deleted(Math.max(1, answer.deleted)));
      // The list as the server has it (a gift may have come in meanwhile).
      if (answer.giftsWaiting !== this.gifts.length) void this.show();
    } catch (caught) {
      const refusal = friendRefusal(caught);
      this.status.set(refusal.message, "error");
      if (refusal.reason === "noSuchGift" && which !== "all") {
        this.gifts = this.gifts.filter((gift) => gift.id !== which.id);
        this.options.store.setGiftsWaiting(this.gifts.length);
      }
    } finally {
      this.busy = false;
      if (!this.destroyed) this.render();
    }
  }

  /** The "My wishes" strip: one toggle per resource, ranked by the marker, the others off once 3 are on. */
  private renderWishes(): void {
    const full = this.wishes.length >= GIFT_WISH_MAX;
    const toggles = make("div", "gift-wishes__toggles");
    for (const key of RESOURCE_KEYS) {
      const rank = this.wishes.indexOf(key) + 1;
      const on = rank > 0;
      const toggle = make("button", on ? "gift-wish gift-wish--on" : "gift-wish");
      toggle.type = "button";
      toggle.dataset["resource"] = key;
      toggle.setAttribute("aria-pressed", String(on));
      toggle.setAttribute("aria-label", on ? `${RESOURCE_NAMES[key]} (wish ${rank})` : RESOURCE_NAMES[key]);
      toggle.title = RESOURCE_NAMES[key];
      toggle.disabled = !on && full;
      toggle.append(resourceIcon(key, { decorative: true }));
      if (on) {
        toggle.dataset["rank"] = String(rank);
        toggle.append(wishMark(rank, "gift-wish__mark"));
      }
      toggle.addEventListener("click", () => void this.toggleWish(key));
      toggles.append(toggle);
    }
    toggles.setAttribute("role", "group");
    toggles.setAttribute("aria-label", "My gift wishes");
    const head = make("div", "gift-wishes__head");
    // The painted marker, then "My wishes"; under it "Goo only", "Goo > Twigs" or how to start.
    const title = make("span", "gift-wishes__title");
    title.append(wishMark(null, "gift-wishes__mark"), GIFTS_TEXT.wishes);
    const hint = make("span", "gift-wishes__hint", wishesSummary(this.wishes) || GIFTS_TEXT.wishesHint);
    if (this.wishes.length === 1) hint.classList.add("gift-wishes__hint--only");
    head.append(title, hint);
    this.wishBar.replaceChildren(head, toggles);
  }

  /** The same wishes in the same order (the order is the rank). */
  private sameWishes(a: readonly GiftResource[], b: readonly GiftResource[]): boolean {
    return a.length === b.length && a.every((key, index) => b[index] === key);
  }

  /**
   * Adds `key` as the last wish or takes it out (the later ones move up), and
   * saves at once; a refusal puts the last saved wishes back.
   */
  private async toggleWish(key: GiftResource): Promise<void> {
    const on = this.wishes.includes(key);
    if (!on && this.wishes.length >= GIFT_WISH_MAX) return;
    const next = on ? this.wishes.filter((one) => one !== key) : [...this.wishes, key];
    this.wishes = next;
    this.renderWishes();
    const save = ++this.wishSave;
    try {
      const stored = await this.options.api.setWishes(next);
      if (this.destroyed || save !== this.wishSave) return;
      this.wishes = [...stored];
      this.savedWishes = [...stored];
      if (this.status.text === GIFTS_TEXT.wishesFailed) this.status.set(null);
    } catch {
      if (this.destroyed || save !== this.wishSave) return;
      this.wishes = [...this.savedWishes];
      this.status.set(GIFTS_TEXT.wishesFailed, "error");
    }
    this.renderWishes();
  }

  /** Collects one gift or all it can; warns first, once, when storage is short. */
  private async collect(which: Gift | "all"): Promise<void> {
    if (this.busy) return;
    const key = which === "all" ? "all" : which.id;
    const taking = which === "all" ? this.gifts.slice(0, this.collectsLeft) : [which];
    const pool = playerPool();
    const lost = overflowOf(totalOf(taking), pool?.read() ?? null);
    if (this.warned !== key && !isEmpty(lost)) {
      this.warned = key;
      this.status.set(GIFTS_TEXT.short(lost), "error");
      this.render();
      return;
    }
    this.warned = null;
    this.asking = null;
    this.busy = true;
    this.render();
    try {
      const answer = await this.options.api.collect(which === "all" ? "all" : which.id);
      const gone = new Set(taking.slice(0, answer.collected).map((gift) => gift.id));
      this.gifts = this.gifts.filter((gift) => !gone.has(gift.id));
      this.collectsLeft = answer.collectsLeft;
      this.options.store.setGiftsWaiting(answer.giftsWaiting);
      this.status.set(isEmpty(answer.resources) ? GIFTS_TEXT.collectedNothing : GIFTS_TEXT.collected(answer.resources));
      pool?.refresh();
      // The list as the server has it (another device may have collected some).
      if (which === "all" || answer.giftsWaiting !== this.gifts.length) void this.show();
    } catch (caught) {
      const refusal = friendRefusal(caught);
      this.status.set(refusal.reason === "underAttack" ? GIFTS_TEXT.underAttack : refusal.message, "error");
      if (refusal.reason === "collectLimit") this.collectsLeft = 0;
      if (refusal.reason === "noSuchGift" && which !== "all") {
        this.gifts = this.gifts.filter((gift) => gift.id !== which.id);
        this.options.store.setGiftsWaiting(this.gifts.length);
      }
    } finally {
      this.busy = false;
      if (!this.destroyed) this.render();
    }
  }

  private sendBack(gift: Gift): void {
    const sent = (): void => {
      this.gifts = this.gifts.map((one) => (one.userid === gift.userid ? { ...one, canSendBack: false } : one));
      this.render();
    };
    const target = { userid: gift.userid, username: gift.username };
    if (this.options.onSendBack) {
      this.options.onSendBack(target, sent);
      return;
    }
    openGiftPicker(target, this.element.closest(".friends-screen")?.parentElement as HTMLElement | null, {
      api: this.options.api,
      store: this.options.store,
      onSent: sent,
    });
  }
}
