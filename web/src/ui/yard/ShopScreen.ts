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
  type ShopEffect,
  type ShopOffer,
  type WallOffer,
} from "@/game/yard/shop";
import type { YardKind } from "@/game/yard/buildingCostData";
import { PACK_LABELS, packGroups, type PackGroup, type PackOffer } from "@/game/yard/resourcePacks";
import { actionKey, YardChangeReason, type YardChange, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount, formatCompact, formatCountdown } from "@/ui/format";
import { iconAmount } from "@/ui/gameIcon";
import { centreWindow, type CentreWindow } from "@/ui/centreWindow";
import { Panel } from "@/ui/Panel";
import { resourceAmount, resourceIcon, resourceName, type ResourceRealm } from "@/ui/resourceIcon";
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
 * route). Under Building, a Walls section sells the four wall upgrades,
 * priced from the yard's Blocks. Docked like the Monsters screen and, like it, not a modal and open
 * after every purchase. On the Inferno yard it is the Inferno's store (WP 1.17
 * items, `shop.ts` `INFERNO_SHOP_ITEMS`): its two walls, its overdrives and
 * its protection, bought for the Inferno yard with the one Shiny purse.
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

/** One resource's card under Resources; its offers' buttons live in `packButtons`. */
interface PackCard {
  readonly element: HTMLElement;
  readonly meta: HTMLElement;
  readonly gate: HTMLElement;
}

const FIX_KEY = "FIX";

/** "r1", "r1I": a pack card's key, one per resource and realm. */
const packCardKey = (group: PackGroup): string => `${group.resource}${group.inferno ? "I" : ""}`;

const realmOf = (group: PackGroup): ResourceRealm => (group.inferno ? "inferno" : "surface");

/** What a pack card says under its heading: held / storage. */
export const packMeta = (group: PackGroup): string => `${formatAmount(group.held)} / ${formatAmount(group.cap)}`;

/** The one line under a pack card when none of its offers can be bought, else null. */
export const packGate = (group: PackGroup): string | null => {
  if (group.offers.some((offer) => offer.blocked === null)) return null;
  return group.offers.find((offer) => offer.amount > 0)?.blocked ?? group.offers[0]?.blocked ?? null;
};

/** "7 days", "12 hours", "1 hour". */
export const durationText = (seconds: number): string => {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? "24 hours" : `${days} days`;
  }
  const hours = Math.round(seconds / 3_600);
  return hours === 1 ? "1 hour" : `${hours} hours`;
};

/** "24h", "7d", "1h": how long a boost lasts, beside the clock. */
export const durationShort = (seconds: number): string =>
  seconds % 86_400 === 0 && seconds > 86_400 ? `${seconds / 86_400}d` : `${Math.round(seconds / 3_600)}h`;

/**
 * The line under a card's blurb: steps bought, time left, or how long it
 * lasts. Empty for a boost that is not running: its clock chip says how long.
 */
export const offerMeta = (offer: ShopOffer, now: number): string => {
  const { item, owned, state } = offer;
  if (state.kind === "running") return `Running: ${formatCountdown(state.endsAt - now)} left`;
  if (state.kind === "soldOut") return `All ${item.prices.length} bought`;
  // A battle boost that runs: buying it again starts its full time afresh.
  if (state.endsAt !== undefined) {
    return `Running: ${formatCountdown(state.endsAt - now)} left. Buying again restarts it`;
  }
  if (owned !== null) return `${owned} of ${item.prices.length} bought`;
  if (item.stacks) return `Adds ${durationText(item.seconds)}`;
  if (item.effects) return "";
  return `Lasts ${durationText(item.seconds)}`;
};

/** The line under the Battle boosts heading: where they work, and that they do not add up. */
export const boostsNote = (kind: YardKind): string =>
  kind === "outpost"
    ? "Tower Overdrive: when this outpost is attacked. Buying again restarts it; time left is not added."
    : kind === "inferno"
      ? "Tower Overdrive: when your Inferno yard is attacked. Buying again restarts it; time left is not added."
      : "Monster boosts: in your attacks and at home. Buying again restarts it; time left is not added.";

/** The line under the Walls heading: how the price adds up. */
export const WALLS_NOTE =
  "Each Block costs 3 Shiny to reach stone, then 6 more for metal, 10 more for gold and 15 more for black diamond. Blocks still being built or upgraded are finished.";

/** {@link WALLS_NOTE} on the Inferno yard, which sells two. */
export const INFERNO_WALLS_NOTE =
  "Each Block costs 3 Shiny to reach granite, then 6 more for forged steel. Blocks still being built or upgraded are finished.";

/** The line under a wall upgrade's blurb. */
export const wallMeta = (offer: WallOffer): string => {
  const { tier, blocks, state } = offer;
  if (state.kind === "none") return "No Blocks in this yard yet.";
  if (state.kind === "reached") return `Already reached: every Block is ${tier.material} or better.`;
  return `${formatAmount(blocks)} ${blocks === 1 ? "Block" : "Blocks"} to raise`;
};

/** The line under the Protection heading: how long the yard (the Inferno's, on `kind` "inferno") is still protected. */
export const protectionText = (
  until: number | null,
  now: number,
  kind: YardKind = "main",
): string => {
  const yard = kind === "inferno" ? "Your Inferno yard" : "Your yard";
  return until === null
    ? `${yard} is not protected. Protection you buy starts now.`
    : `${yard} is protected for ${formatCountdown(until - now)}. Protection you buy is added on top.`;
};

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
  /** Resources: one card per resource, and one button per offer keyed by its item (`BR21`). */
  private readonly packCards = new Map<string, PackCard>();
  private readonly packButtons = new Map<string, ShinyButton>();
  /** The "Coming later" section never changes, so it is drawn once. */
  private comingLater: HTMLElement | null = null;
  private readonly unsubscribe: () => void;

  private opened = false;
  private destroyed = false;

  /** Its place in the middle of the screen, one window at a time (`ui/centreWindow.ts`). */
  private readonly centre: CentreWindow;

  constructor(options: ShopScreenOptions) {
    this.binding = options.binding;
    this.onClose = options.onClose;
    this.repair = options.repair ?? repairActions(options.binding.store);

    // Not Panel's own close, which removes the element for good: the screen
    // opens and closes many times over one yard.
    this.panel = new Panel({ title: "Shop", className: "shop-screen", closable: false });
    this.element = this.panel.element;
    this.centre = centreWindow(this.element, () => this.close());
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
    this.centre.opened();
    this.render();
    if (!wasOpen) this.element.querySelector<HTMLElement>(".shop-screen__close")?.focus();
    if (!wasOpen) guideBus.emit("screen", { id: GuideScreen.SHOP, root: this.element, header: this.panel.titlebar });
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.element.hidden = true;
    this.centre.closed();
    this.setStatus(null);
    for (const card of this.cards.values()) card.button.setBusy(false);
    for (const button of this.packButtons.values()) button.setBusy(false);
    this.onClose?.();
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
    for (const button of this.packButtons.values()) button.destroy();
    this.packButtons.clear();
    this.packCards.clear();
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
          section === ShopSection.PROTECTION
            ? protectionText(model.protectedUntil, now, store.kind)
            : section === ShopSection.BOOSTS
              ? boostsNote(store.kind)
              : null,
        ),
      );
      if (section === ShopSection.BUILDING) {
        const note = store.kind === "inferno" ? INFERNO_WALLS_NOTE : WALLS_NOTE;
        sections.push(this.section("walls", "Walls", model.walls.map((offer) => this.wallCard(offer)), note));
        sections.push(...this.resourcesSection());
      }
    }
    // An outpost's list may have no Building section; Resources still shows.
    if (!sections.some((one) => one.dataset["section"] === "resources")) {
      sections.splice(Math.min(1, sections.length), 0, ...this.resourcesSection());
    }
    if (model.repair) sections.push(this.section("repairs", "Repairs", [this.repairCard(model.repair)]));
    // Flash's Inferno store never listed the Shiny decorations.
    if (store.kind !== "inferno" && COMING_LATER.length > 0) {
      this.comingLater ??= this.section(
        "later",
        "Coming later",
        COMING_LATER.map((one) => this.laterCard(one.items[0] ?? one.name, one.name, one.blurb)),
        "Not sold yet: this game does not do what they did.",
      );
      sections.push(this.comingLater);
    }
    this.list.replaceChildren(...sections);
    this.syncPending();
  }

  /** Flash's Resources tab (`STORE.as:198-330`, issue #393): three offers per resource, or nothing. */
  private resourcesSection(): HTMLElement[] {
    const groups = packGroups(this.binding.store);
    return groups.length > 0 ? [this.section("resources", "Resources", groups.map((group) => this.packCard(group)))] : [];
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
    if (item.effects && !card.element.dataset["effects"]) this.drawEffects(card, item.blurb, item.effects, item.seconds);
    card.meta.textContent = offerMeta(offer, now);
    card.meta.hidden = card.meta.textContent === "";
    card.element.dataset["state"] = state.kind;
    // A running battle boost glows (`shop-card--boosted`) while it stays on sale.
    card.element.classList.toggle("shop-card--boosted", state.kind === "buy" && state.endsAt !== undefined);
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

  private wallCard(offer: WallOffer): HTMLElement {
    const { tier, state } = offer;
    const card = this.card(
      tier.item,
      tier.name,
      `Every lower Block becomes ${tier.material}, healed to full.`,
      "Buy",
      () => void this.buy(tier.item, tier.name),
      true,
    );
    card.meta.textContent = wallMeta(offer);
    card.element.dataset["state"] = state.kind;
    if (state.kind === "buy") {
      card.button.element.hidden = false;
      card.button.setPrice(state.price);
      card.button.setBlocked(state.blocked);
      card.gate.textContent = state.blocked ?? "";
      card.gate.hidden = state.blocked === null;
    } else {
      card.button.element.hidden = true;
      card.button.setBlocked(state.kind === "reached" ? "Already reached." : "No Blocks yet.");
      card.gate.hidden = true;
    }
    return card.element;
  }

  /**
   * A boost's effect in place of its sentence (the text cut, 28 Oct): each
   * effect's painted icon and number, then the clock and how long it lasts,
   * "[claw] +25%  [clock] 24h". The sentence stays as the hover and for a
   * screen reader, which hears it once instead of the chips.
   */
  private drawEffects(card: Card, blurb: string, effects: readonly ShopEffect[], seconds: number): void {
    const text = card.element.querySelector<HTMLElement>(".shop-card__blurb");
    if (!text) return;
    card.element.dataset["effects"] = "";
    const spoken = document.createElement("span");
    spoken.className = "u-visually-hidden";
    spoken.textContent = blurb;
    const chips = document.createElement("span");
    chips.className = "shop-card__effects";
    chips.setAttribute("aria-hidden", "true");
    chips.append(
      ...effects.map((effect) => iconAmount(effect.icon, effect.amount, { label: effect.label, chip: true, size: 24 })),
      iconAmount("time", durationShort(seconds), { label: `Lasts ${durationText(seconds)}`, chip: true, size: 24 }),
    );
    text.title = blurb;
    text.replaceChildren(spoken, chips);
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
    const button = (this.cards.get(key)?.button ?? this.packButtons.get(key))?.element;
    const target =
      button && button.isConnected && !button.hidden && !button.disabled
        ? button
        : this.element.querySelector<HTMLElement>(".shop-screen__close");
    target?.focus();
  }

  /**
   * One resource's card: its icon and name, held / storage, and the three
   * offers (+10%, +50%, Fill) as Shiny buttons, each with the amount it
   * brings under its label. Made once per resource and reused.
   */
  private packCard(group: PackGroup): HTMLElement {
    const key = packCardKey(group);
    const realm = realmOf(group);
    let card = this.packCards.get(key);
    if (!card) {
      const element = document.createElement("article");
      element.className = "shop-card shop-card--pack";
      element.dataset["pack"] = key;
      const title = document.createElement("h4");
      title.className = "shop-card__name shop-card__name--pack";
      title.append(resourceIcon(group.resource, { decorative: true, realm }), resourceName(group.resource, realm));
      const meta = document.createElement("p");
      meta.className = "shop-card__meta";
      const packs = document.createElement("div");
      packs.className = "shop-card__packs";
      for (const offer of group.offers) packs.append(this.packButton(group, offer).element);
      const gate = document.createElement("p");
      gate.className = "shop-card__gate";
      gate.hidden = true;
      element.append(title, meta, packs, gate);
      card = { element, meta, gate };
      this.packCards.set(key, card);
    }
    card.meta.textContent = packMeta(group);
    card.meta.title = `${resourceName(group.resource, realm)}: ${formatAmount(group.held)} of ${formatAmount(group.cap)}`;
    for (const offer of group.offers) {
      const button = this.packButton(group, offer);
      button.setPrice(offer.price);
      button.setNote(offer.amount > 0 ? [`+${formatCompact(offer.amount)}`] : null);
      button.setBlocked(offer.blocked);
    }
    const reason = packGate(group);
    card.gate.textContent = reason ?? "";
    card.gate.hidden = reason === null;
    card.element.dataset["state"] = reason === null ? "buy" : "blocked";
    return card.element;
  }

  private packButton(group: PackGroup, offer: PackOffer): ShinyButton {
    const existing = this.packButtons.get(offer.item);
    if (existing) return existing;
    const name = resourceName(group.resource, realmOf(group));
    const button = new ShinyButton({
      label: PACK_LABELS[offer.size],
      what: name,
      spell: formatAmount,
      onSpend: () => void this.buyPack(offer.item),
      className: "shop-card__pack",
    });
    button.element.dataset["item"] = offer.item;
    this.packButtons.set(offer.item, button);
    return button;
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
    for (const [item, button] of this.packButtons) button.setBusy(store.isRunning(actionKey("buy", item)));
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  private async buy(item: string, name: string): Promise<void> {
    const result = await this.binding.store.buy(item);
    if (this.destroyed) return;
    if (result.ok) {
      const blocks = result.report.blocks;
      const what =
        blocks === undefined ? `${name} bought: ` : `${name}: ${formatAmount(blocks)} ${blocks === 1 ? "Block" : "Blocks"} raised, `;
      this.setStatus("good", [what, resourceAmount("shiny", result.report.credits), " spent."]);
    } else {
      this.setStatus("bad", [refusalText(result.refusal)]);
    }
    if (this.opened) this.render();
    this.restoreFocus(item);
  }

  /**
   * Buys one offer at the price the player saw: the server refuses
   * (`priceChanged`) rather than charge more, and funds the amount it works
   * out itself.
   */
  private async buyPack(item: string): Promise<void> {
    const store = this.binding.store;
    const offer = packGroups(store)
      .flatMap((group) => group.offers)
      .find((one) => one.item === item);
    if (!offer) return;
    const result = await store.buy(item, offer.price);
    if (this.destroyed) return;
    if (result.ok) {
      const { resource, amount, inferno, credits } = result.report;
      const realm: ResourceRealm = inferno || store.kind === "inferno" ? "inferno" : "surface";
      this.setStatus("good", [
        resource && amount !== undefined ? resourceAmount(resource, amount, { realm, change: "gain" }) : "Bought",
        " for ",
        resourceAmount("shiny", credits),
      ]);
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
