import type { YardRefusal } from "@/api/yard";
import type { JuiceActions } from "@/api/yardJuice";
import { expansionEndsAt, HOUSING_EXPANSION } from "@/game/monsters/housing";
import { actionKey, YardChangeReason, type YardChange } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/housing.css";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { HousingJuice } from "./HousingJuice";
import { HousingView } from "./HousingView";
import { MonstersTabId, type MonstersFocus, type MonstersTab, type MonstersTabContext } from "./monstersTab";

/**
 * The Housing tab (`docs/design/yard-buildings.md` §4.5).
 *
 * Top to bottom: what lives in Housing as the Housing panel draws it
 * (`HousingView`, #170): the space over one block per Housing, the monsters
 * waiting for room, and the army as pictures with counts; then the Monster
 * Juicer (`HousingJuice.ts`, §7.3): pick how many of each to juice and juice
 * them, confirmed first; and Housing Expansion (`EXH`), a
 * {@link ShinyButton} while none runs, its time left while one does.
 *
 * Every figure comes from `game/monsters/housing.ts`, the header's own
 * arithmetic, so the tab and the header always agree. The purchase goes
 * through the store's `buy("EXH")`. No Ascend (D19).
 */

/** The store's queue key for the expansion purchase. */
const BUY_KEY = actionKey("buy", HOUSING_EXPANSION.item);

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

export class HousingTab implements MonstersTab {
  readonly element: HTMLElement;

  private readonly context: MonstersTabContext;
  private readonly status: HTMLElement;
  private readonly view: HousingView;
  private readonly expansion: HTMLElement;
  private readonly juiceSection: HTMLElement;
  private readonly juice: HousingJuice;

  /** The running expansion's end as last drawn, so its expiry redraws the tab. */
  private drawnExpansion: number | null = null;
  private expansionClock: HTMLElement | null = null;
  /** Long-lived, so an armed button survives the redraws. */
  private buyButton: ShinyButton | null = null;

  constructor(context: MonstersTabContext, juiceActions?: JuiceActions) {
    this.context = context;

    this.element = document.createElement("div");
    this.element.className = "housing";

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    const scroll = document.createElement("div");
    scroll.className = "housing__scroll";
    this.view = new HousingView({
      binding: context.binding,
      onHatch: () => context.showTab(MonstersTabId.HATCH),
      // The Juicer is right here, a section further down.
      onJuice: () => {
        this.juiceSection.scrollIntoView?.({ block: "start", behavior: "smooth" });
        this.juiceSection.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
      },
    });
    this.juiceSection = section("housing-juicer", "Monster Juicer");
    this.juice = new HousingJuice({
      store: context.binding.store,
      onStatus: (status) => this.setStatus(status),
      ...(juiceActions ? { actions: juiceActions } : {}),
    });
    this.juiceSection.append(this.juice.element);
    this.expansion = section("housing-expansion", "Housing Expansion");
    scroll.append(this.view.element, this.juiceSection, this.expansion);

    this.element.append(this.status, scroll);
  }

  private get store() {
    return this.context.binding.store;
  }

  show(focus: MonstersFocus): void {
    this.view.setFocus(focus.buildingId ?? null);
    this.render();
  }

  update(change: YardChange): void {
    if (change.reason === YardChangeReason.PENDING) {
      this.syncPending();
      return;
    }
    this.render();
  }

  tick(): void {
    const now = this.store.now();
    const ends = expansionEndsAt(this.store.save, now);
    if (ends !== this.drawnExpansion) {
      // Running out changes every building's figure.
      this.render();
      return;
    }
    if (ends !== null && this.expansionClock) this.expansionClock.textContent = formatCountdown(ends - now);
    this.view.tick();
    this.syncPending();
  }

  destroy(): void {
    this.view.destroy();
    this.juice.destroy();
    this.buyButton?.destroy();
    this.buyButton = null;
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private render(): void {
    const save = this.store.save;
    const now = this.store.now();
    this.view.render();
    this.juice.render();
    this.renderExpansion(expansionEndsAt(save, now), now);
    this.syncPending();
  }

  private renderExpansion(ends: number | null, now: number): void {
    this.drawnExpansion = ends;
    this.expansionClock = null;
    const text = document.createElement("p");
    text.className = "housing-expansion__text";

    if (ends !== null) {
      this.buyButton?.destroy();
      this.buyButton = null;
      const clock = document.createElement("strong");
      clock.className = "housing-expansion__clock";
      clock.textContent = formatCountdown(ends - now);
      this.expansionClock = clock;
      text.classList.add("housing-expansion__text--on");
      text.append("On: every building houses 25% more for ", clock, ".");
      fillSection(this.expansion, [text]);
      return;
    }

    text.textContent = "Every building houses 25% more for 24 hours.";
    if (!this.buyButton) {
      this.buyButton = new ShinyButton({
        label: "Expand housing",
        spell: formatAmount,
        onSpend: () => void this.runBuy(),
        className: "housing-expansion__buy",
      });
    }
    this.buyButton.setPrice(HOUSING_EXPANSION.price);
    this.buyButton.setBlocked(this.store.credits < HOUSING_EXPANSION.price ? "Not enough Shiny." : null);
    fillSection(this.expansion, [text, this.buyButton.element]);
  }

  private syncPending(): void {
    this.view.syncPending();
    this.juice.syncPending();
    this.buyButton?.setBusy(this.store.isRunning(BUY_KEY));
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  private async runBuy(): Promise<void> {
    const result = await this.store.buy(HOUSING_EXPANSION.item);
    if (result.ok) {
      this.setStatus({
        tone: "good",
        content: [
          "Housing Expansion on for 24 hours: ",
          resourceAmount("shiny", result.report.credits),
          " spent.",
        ],
      });
    } else {
      this.setStatus({ tone: "bad", content: [refusalText(result.refusal)] });
    }
    this.render();
  }

  private setStatus(status: Status | null): void {
    this.status.hidden = status === null;
    this.status.className = status ? `monsters-status monsters-status--${status.tone}` : "monsters-status";
    this.status.replaceChildren(...(status?.content ?? []));
  }
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

const section = (className: string, title: string): HTMLElement => {
  const element = document.createElement("section");
  element.className = `housing-section ${className}`;
  const heading = document.createElement("h3");
  heading.className = "housing-section__title";
  heading.id = `${className}-title`;
  heading.textContent = title;
  element.setAttribute("aria-labelledby", heading.id);
  element.append(heading);
  return element;
};

/** Replaces everything in a section under its title. */
const fillSection = (element: HTMLElement, body: readonly HTMLElement[]): void => {
  const title = element.querySelector(".housing-section__title");
  element.replaceChildren(...(title ? [title] : []), ...body);
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
