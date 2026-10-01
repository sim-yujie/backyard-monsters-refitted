import { tutTarget, TutTarget } from "@/game/guide/targets";
import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import { repairActions, RepairKey, type RepairActions } from "@/api/yardRepair";
import type { YardRefusal } from "@/api/yard";
import {
  COMING_LATER,
  SHOP_SECTION_TITLES,
  ShopSection,
  shopModel,
  type RepairAllOffer,
  type ShopOffer,
} from "@/game/yard/shop";
import { actionKey, YardChangeReason, type YardChange, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { resourceAmount } from "@/ui/resourceIcon";
import { ShinyButton } from "./ShinyButton";
import "@/ui/styles/shop.css";

/**
 * The Shop screen (`docs/design/yard-buildings.md` §8.2, decision D15): the
 * General Store as a Shiny shop, opened from the General Store's panel and
 * from the HUD's Shiny counter.
 *
 * One list under headings, each item a card: its name, what it does, how many
 * steps are bought ("2 of 4") or how long a running one has left, and a
 * {@link ShinyButton} with the next price (tap, then tap again). An item that
 * cannot be bought now says why under the button. While something is damaged
 * a Repairs card offers Repair everything now (`FIX`, the `repair/instant`
 * route). Docked like the Monsters screen and, like it, not a modal and open
 * after every purchase.
 *
 * What the rows say comes from `game/yard/shop.ts`; the server prices and
 * refuses every purchase itself.
 */

export interface ShopScreenOptions {
  /** The own yard. The screen exists only there. */
  readonly binding: YardUiBinding;
  /** After the player closes it. */
  readonly onClose?: () => void;
  /** The repair routes; the store's own unless a test swaps them. */
  readonly repair?: RepairActions;
}

type Tone = "good" | "bad";

/** One card's long-lived parts: its button survives every redraw, armed or not. */
interface Card {
  readonly element: HTMLElement;
  readonly meta: HTMLElement;
  readonly gate: HTMLElement;
  readonly button: ShinyButton;
}

const FIX_KEY = "FIX";

/** "7 days", "12 hours", "1 hour". */
export const durationText = (seconds: number): string => {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? "24 hours" : `${days} days`;
  }
  const hours = Math.round(seconds / 3_600);
  return hours === 1 ? "1 hour" : `${hours} hours`;
};

/** The line under a card's blurb: steps bought, time left, or how long it lasts. */
export const offerMeta = (offer: ShopOffer, now: number): string => {
  const { item, owned, state } = offer;
  if (state.kind === "running") return `Running: ${formatCountdown(state.endsAt - now)} left`;
  if (state.kind === "soldOut") return `All ${item.prices.length} bought`;
  if (owned !== null) return `${owned} of ${item.prices.length} bought`;
  if (item.stacks) return `Adds ${durationText(item.seconds)}`;
  return `Lasts ${durationText(item.seconds)}`;
};

/** The line under the Protection heading: how long the yard is still protected. */
export const protectionText = (until: number | null, now: number): string =>
  until === null
    ? "Your yard is not protected. Protection you buy starts now."
    : `Your yard is protected for ${formatCountdown(until - now)}. Protection you buy is added on top.`;

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";

export class ShopScreen {
  readonly element: HTMLElement;

  private readonly binding: YardUiBinding;
  private readonly onClose: (() => void) | undefined;
  private readonly repair: RepairActions;
  private readonly panel: Panel;
  private readonly balance: HTMLElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly cards = new Map<string, Card>();
  /** The "Coming later" section never changes, so it is drawn once. */
  private comingLater: HTMLElement | null = null;
  private readonly unsubscribe: () => void;

  private opened = false;
  private destroyed = false;

  constructor(options: ShopScreenOptions) {
    this.binding = options.binding;
    this.onClose = options.onClose;
    this.repair = options.repair ?? repairActions(options.binding.store);

    // Not Panel's own close, which removes the element for good: the screen
    // opens and closes many times over one yard.
    this.panel = new Panel({ title: "Shop", className: "shop-screen", closable: false });
    this.element = this.panel.element;
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        this.close();
      }
    });

    this.balance = document.createElement("span");
    this.balance.className = "shop-screen__balance";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon shop-screen__close";
    close.setAttribute("aria-label", "Close Shop");
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    this.panel.titlebar.append(this.balance, close);

    this.status = document.createElement("p");
    this.status.className = "shop-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.list = document.createElement("div");
    this.list.className = "shop-list";

    this.panel.setContent(this.status, this.list);
    this.unsubscribe = this.binding.store.subscribe((change) => this.onChange(change));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  open(): void {
    if (this.destroyed) return;
    const wasOpen = this.opened;
    this.opened = true;
    this.element.hidden = false;
    this.render();
    if (!wasOpen) this.element.querySelector<HTMLElement>(".shop-screen__close")?.focus();
    if (!wasOpen) guideBus.emit("screen", { id: GuideScreen.SHOP, root: this.element, header: this.panel.titlebar });
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.element.hidden = true;
    this.setStatus(null);
    for (const card of this.cards.values()) card.button.setBusy(false);
    this.onClose?.();
  }

  /** Whether the building panel is open in the right dock: the screen then stands to its left. */
  besidePanel(beside: boolean): void {
    this.element.classList.toggle("shop-screen--beside-panel", beside);
  }

  /** Once a second, from the scene: the running items count down. */
  tick(): void {
    if (this.opened) this.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    for (const card of this.cards.values()) card.button.destroy();
    this.cards.clear();
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private onChange(change: YardChange): void {
    if (!this.opened) return;
    if (change.reason === YardChangeReason.PENDING) {
      this.syncPending();
      return;
    }
    this.render();
  }

  private render(): void {
    const store = this.binding.store;
    const model = shopModel(store);
    const now = store.now();

    this.balance.replaceChildren(resourceAmount("shiny", formatAmount(store.credits)));
    this.balance.title = `Shiny: ${formatAmount(store.credits)}`;

    const sections: HTMLElement[] = [];
    for (const section of Object.values(ShopSection)) {
      const offers = model.offers.filter((offer) => offer.item.section === section);
      if (offers.length === 0) continue;
      sections.push(
        this.section(
          section,
          SHOP_SECTION_TITLES[section],
          offers.map((offer) => this.offerCard(offer, now)),
          section === ShopSection.PROTECTION ? protectionText(model.protectedUntil, now) : null,
        ),
      );
    }
    if (model.repair) sections.push(this.section("repairs", "Repairs", [this.repairCard(model.repair)]));
    this.comingLater ??= this.section(
      "later",
      "Coming later",
      COMING_LATER.map((one) => this.laterCard(one.items[0] ?? one.name, one.name, one.blurb)),
      "Not sold yet: this game does not do what they did.",
    );
    sections.push(this.comingLater);
    this.list.replaceChildren(...sections);
    this.syncPending();
  }

  private section(
    id: string,
    title: string,
    cards: readonly HTMLElement[],
    note: string | null = null,
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "shop-section";
    section.dataset["section"] = id;
    // `shop-protection`, … for Bob's tips (issue #227).
    tutTarget(section, `shop-${id}`);
    const heading = document.createElement("h3");
    heading.className = "shop-section__title";
    heading.id = `shop-section-${id}`;
    heading.textContent = title;
    section.setAttribute("aria-labelledby", heading.id);
    section.append(heading);
    if (note) {
      const line = document.createElement("p");
      line.className = "shop-section__note";
      line.textContent = note;
      section.append(line);
    }
    const grid = document.createElement("ul");
    grid.className = "shop-grid";
    for (const card of cards) {
      const item = document.createElement("li");
      item.append(card);
      grid.append(item);
    }
    section.append(grid);
    return section;
  }

  /** A held-back item: its name and what it will do, no price, no button. */
  private laterCard(key: string, name: string, blurb: string): HTMLElement {
    const element = document.createElement("article");
    element.className = "shop-card shop-card--later";
    element.dataset["item"] = key;
    element.dataset["state"] = "later";
    const title = document.createElement("h4");
    title.className = "shop-card__name";
    title.textContent = name;
    const text = document.createElement("p");
    text.className = "shop-card__blurb";
    text.textContent = blurb;
    const meta = document.createElement("p");
    meta.className = "shop-card__meta";
    meta.textContent = "Coming later";
    element.append(title, text, meta);
    return element;
  }

  private offerCard(offer: ShopOffer, now: number): HTMLElement {
    const { item, state } = offer;
    const card = this.card(item.item, item.name, item.blurb, "Buy", () => void this.buy(item.item, item.name), true);
    card.meta.textContent = offerMeta(offer, now);
    card.element.dataset["state"] = state.kind;
    if (item.item === "BEW") tutTarget(card.element, TutTarget.SHOP_WORKERS);

    if (state.kind === "buy") {
      card.button.element.hidden = false;
      card.button.setPrice(state.price);
      card.button.setBlocked(state.blocked);
      card.gate.textContent = state.blocked ?? "";
      card.gate.hidden = state.blocked === null;
    } else {
      card.button.element.hidden = true;
      card.button.setBlocked(state.kind === "running" ? "Already running." : "Sold out.");
      card.gate.hidden = true;
    }
    return card.element;
  }

  /**
   * After a spend: the button was disabled while its request ran, which drops
   * focus to the page. It goes back to the button, or to the close button
   * when the item has none now (running, sold out, nothing left to repair),
   * so Escape and the keyboard still reach the Shop.
   */
  private restoreFocus(key: string): void {
    if (!this.opened) return;
    // The player has already moved on.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const button = this.cards.get(key)?.button.element;
    const target =
      button && button.isConnected && !button.hidden && !button.disabled
        ? button
        : this.element.querySelector<HTMLElement>(".shop-screen__close");
    target?.focus();
  }

  private repairCard(offer: RepairAllOffer): HTMLElement {
    const count = `${offer.count} damaged ${offer.count === 1 ? "building" : "buildings"}`;
    const card = this.card(
      FIX_KEY,
      "Repair everything now",
      "Every damaged building back to full health at once.",
      "Repair now",
      () => void this.repairNow(),
    );
    card.meta.textContent = count;
    card.element.dataset["state"] = "buy";
    card.button.element.hidden = false;
    card.button.setPrice(offer.price);
    card.button.setBlocked(offer.blocked);
    card.gate.textContent = offer.blocked ?? "";
    card.gate.hidden = offer.blocked === null;
    return card.element;
  }

  /**
   * The card for `key`, made once and reused so its button keeps its armed
   * state and focus. `named` puts the card's name in the button's accessible
   * name, for a label ("Buy") every card shares.
   */
  private card(
    key: string,
    name: string,
    blurb: string,
    label: string,
    onSpend: () => void,
    named = false,
  ): Card {
    const existing = this.cards.get(key);
    if (existing) return existing;

    const element = document.createElement("article");
    element.className = "shop-card";
    element.dataset["item"] = key;
    const title = document.createElement("h4");
    title.className = "shop-card__name";
    title.textContent = name;
    const text = document.createElement("p");
    text.className = "shop-card__blurb";
    text.textContent = blurb;
    const meta = document.createElement("p");
    meta.className = "shop-card__meta";
    const gate = document.createElement("p");
    gate.className = "shop-card__gate";
    gate.hidden = true;
    const button = new ShinyButton({
      label,
      ...(named ? { what: name } : {}),
      spell: formatAmount,
      onSpend,
      className: "shop-card__buy",
    });
    element.append(title, text, meta, button.element, gate);

    const card: Card = { element, meta, gate, button };
    this.cards.set(key, card);
    return card;
  }

  private syncPending(): void {
    const store = this.binding.store;
    for (const [key, card] of this.cards) {
      card.button.setBusy(store.isRunning(key === FIX_KEY ? RepairKey.NOW : actionKey("buy", key)));
    }
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  private async buy(item: string, name: string): Promise<void> {
    const result = await this.binding.store.buy(item);
    if (this.destroyed) return;
    if (result.ok) {
      this.setStatus("good", [`${name} bought: `, resourceAmount("shiny", result.report.credits), " spent."]);
    } else {
      this.setStatus("bad", [refusalText(result.refusal)]);
    }
    if (this.opened) this.render();
    this.restoreFocus(item);
  }

  private async repairNow(): Promise<void> {
    const result = await this.repair.now();
    if (this.destroyed) return;
    if (result.ok) {
      const count = result.report.repaired.length;
      this.setStatus("good", [
        `${count} ${count === 1 ? "building" : "buildings"} repaired: `,
        resourceAmount("shiny", result.report.credits),
        " spent.",
      ]);
    } else {
      this.setStatus("bad", [refusalText(result.refusal)]);
    }
    if (this.opened) this.render();
    this.restoreFocus(FIX_KEY);
  }

  private setStatus(tone: Tone | null, content: readonly (Node | string)[] = []): void {
    this.status.hidden = tone === null;
    this.status.className = tone ? `shop-status shop-status--${tone}` : "shop-status";
    this.status.replaceChildren(...content);
  }
}
