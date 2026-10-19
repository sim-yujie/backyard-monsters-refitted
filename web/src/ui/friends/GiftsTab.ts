import { friendRefusal, type FriendsApi, type Gift, type GiftResource, type ResourceAmounts } from "@/api/friends";
import type { FriendsStore } from "@/game/friends/friendsStore";
import { playerPool, type PlayerPool } from "@/game/friends/friendsView";
import { formatAmount } from "@/ui/format";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount } from "@/ui/resourceIcon";
import { openGiftPicker, type GiftTarget } from "./GiftPicker";
import { button, make, playerRow, section, StatusLine, type FriendsTabView } from "./rows";

/**
 * The Friends screen's **Gifts** tab (`docs/design/friends.md` §3.4, issue
 * #375): the gifts waiting, oldest first (the first to lapse), each with
 * **Collect** and **Send one back**, and **Collect all** above them.
 * Collecting adds the resource to the main yard up to its storage cap; when
 * there is not room for all of it, the first press warns and a second one
 * collects anyway. At most 5 a day; the rest wait, and a gift lapses after 7
 * days. Fetched fresh each time the tab comes forward.
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
  left: (count: number): string =>
    count > 0 ? `You can collect ${count} more ${count === 1 ? "gift" : "gifts"} today.` : "You have collected all you can today. The rest will wait.",
  collected: (amounts: ResourceAmounts): string => `Collected ${amountsText(amounts)}.`,
  collectedNothing: "Your storage is full, so nothing was added.",
  short: (lost: ResourceAmounts): string =>
    `Your storage is too full: ${amountsText(lost)} would be lost. Press again to collect anyway.`,
  underAttack: "Your yard is under attack right now. Collect when the attack is over.",
} as const;

export class GiftsTab implements FriendsTabView {
  readonly element: HTMLElement;

  private readonly options: GiftsTabOptions;
  private readonly now: () => number;
  private readonly summary: HTMLElement;
  private readonly status = new StatusLine();
  private readonly body: HTMLElement;
  private gifts: Gift[] = [];
  private collectsLeft = 0;
  private loaded = false;
  private busy = false;
  /** The gift id (or "all") whose short-storage warning is showing: the next press collects. */
  private warned: number | "all" | null = null;
  /** Bumped by every fetch, so a late answer is dropped. */
  private generation = 0;
  private destroyed = false;

  constructor(options: GiftsTabOptions) {
    this.options = options;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.element = make("div", "friends-tab friends-tab--gifts");
    this.summary = make("div", "friends-summary gifts-summary");
    this.body = make("div", "friends-tab__body");
    this.element.append(this.summary, this.status.element, this.body);
  }

  get statusText(): string {
    return this.status.text;
  }

  async show(): Promise<void> {
    const generation = ++this.generation;
    this.warned = null;
    if (!this.loaded) this.status.set(GIFTS_TEXT.loading);
    try {
      const { gifts, collectsLeft } = await this.options.api.gifts();
      if (this.destroyed || generation !== this.generation) return;
      this.gifts = [...gifts];
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
    const all = button(
      this.warned === "all" ? GIFTS_TEXT.collectAllAnyway : GIFTS_TEXT.collectAll,
      () => void this.collect("all"),
      "primary",
    );
    all.classList.add("gifts-summary__all");
    all.disabled = this.busy || this.gifts.length === 0 || this.collectsLeft === 0;
    const line = make("p", "gifts-summary__left", GIFTS_TEXT.left(this.collectsLeft));
    this.summary.replaceChildren(line, all);

    const rows = this.gifts.map((gift) => {
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
        actions: [collect, back],
      });
      row.dataset["giftid"] = String(gift.id);
      row.querySelector(".friends-row__text")?.append(resourceAmount(gift.resource, gift.amount, { className: "gift-amount" }));
      return row;
    });
    this.body.replaceChildren(section(GIFTS_TEXT.waiting, rows, GIFTS_TEXT.none));
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
