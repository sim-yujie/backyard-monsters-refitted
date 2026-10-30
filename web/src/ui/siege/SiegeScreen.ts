import type { YardRefusal } from "@/api/yard";
import { SIEGE_KEYS, siegeActions, type SiegeActions } from "@/api/yardSiege";
import { SIEGE_MAX_LEVEL, siegeData, type SiegeId } from "@/game/combat/rules/siege";
import {
  CAPACITY_TEXT,
  PURSE_KEYS,
  SITE_NAME,
  WEAPON_DESCRIPTION,
  finishPrice,
  noticeText,
  purseOf,
  shortfallOf,
  shortfallText,
  siegeOffer,
  siegeRows,
  siteNotice,
  statLines,
  stockOf,
  warningText,
  weaponArt,
  type PurseAmounts,
  type SiegeJob,
  type SiegeOffer,
  type SiegeRow,
  type SiegeSite,
} from "@/game/siege/siege";
import { progressFraction } from "@/game/yard/jobs";
import { YardChangeReason, type YardActionResult, type YardChange, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/monsters.css";
import "@/ui/styles/siege.css";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { INFERNO_RESOURCE_NAMES, infernoAmount } from "./infernoResources";

/**
 * The Siege screen (Inferno WP 6.4): Flash's Chaos Lab and Chaos Factory
 * popup (`client/scripts/com/monsters/siege/SiegeBuildingPopup.as`), one
 * screen with its two tabs, opened by a Siege Lab's or Factory's Open button.
 *
 * As in Flash: the weapons down the left, each with its icon, name and ten
 * stars, "Locked" or "Unlocking", a time bar while it runs, "Ready!" or
 * "Fully Upgraded"; the chosen weapon on the right, with its video, its
 * description and up to three stat bars, then what can be done with it: the
 * running job's Finish Now, time bar and Cancel, a warning, or the instant
 * box beside the cost box with its Start button. A building not built,
 * upgrading or damaged shows Flash's notice instead.
 *
 * The frame is the Monsters screen's: docked right under the HUD on a wide
 * screen, a bottom sheet on a phone (list over the card), never a modal, and
 * open after every action. Shiny spends are {@link ShinyButton}s (tap, then
 * tap again); Cancel and the shortfall top-up are one inline confirmation
 * each, with Flash's words. Rules and prices come from `game/siege/siege.ts`,
 * the requests go through the store's queue (`api/yardSiege.ts`).
 */

export interface SiegeScreenOptions {
  /** The own main yard. The screen exists only there. */
  readonly binding: YardUiBinding;
  /** The Factory's Open Map, for a weapon made and waiting. */
  readonly openMap?: () => void;
  /** After the player closes it. */
  readonly onClose?: () => void;
  /** Stand-ins for the routes, under test. */
  readonly actions?: Readonly<Record<SiegeSite, SiegeActions>>;
}

const SITES: readonly SiegeSite[] = ["lab", "factory"];

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

/** The inline question under the right side, when one is asked. */
type Confirm =
  | { readonly kind: "cancel" }
  | { readonly kind: "shortfall"; readonly weapon: SiegeId; readonly missing: number; readonly topUp: number }
  | { readonly kind: "capacity" };

/** A running job's live parts, refreshed every second without a redraw. */
interface JobClock {
  readonly job: SiegeJob;
  readonly time: HTMLElement;
  readonly fill: HTMLElement;
  readonly bar: HTMLElement;
  readonly shinyText: HTMLElement | null;
}

export class SiegeScreen {
  readonly element: HTMLElement;

  private readonly binding: YardUiBinding;
  private readonly openMap: (() => void) | undefined;
  private readonly onClose: (() => void) | undefined;
  private readonly actions: Readonly<Record<SiegeSite, SiegeActions>>;
  private readonly panel: Panel;
  private readonly tabButtons = new Map<SiegeSite, HTMLButtonElement>();
  private readonly purse: HTMLElement;
  private readonly status: HTMLElement;
  private readonly body: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly split: HTMLElement;
  private readonly unsubscribe: () => void;

  private site: SiegeSite = "lab";
  private opened = false;
  private destroyed = false;
  /** The weapon shown on the right, per tab. */
  private readonly selected = new Map<SiegeSite, SiegeId>();
  private confirm: Confirm | null = null;
  private clocks: JobClock[] = [];
  /** Long-lived Shiny buttons, so an armed one survives the redraws. */
  private readonly shiny = new Map<string, ShinyButton>();
  /** Plain buttons disabled while any siege request runs. */
  private plainButtons: HTMLButtonElement[] = [];

  constructor(options: SiegeScreenOptions) {
    this.binding = options.binding;
    this.openMap = options.openMap;
    this.onClose = options.onClose;
    const store = options.binding.store;
    this.actions = options.actions ?? { lab: siegeActions(store, "lab"), factory: siegeActions(store, "factory") };

    this.panel = new Panel({ title: "Chaos Weapons", className: "monsters-screen siege-screen", closable: false });
    this.element = this.panel.element;
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        if (this.confirm) {
          this.confirm = null;
          this.render();
        } else this.close();
      }
    });

    const strip = document.createElement("div");
    strip.className = "tabs monsters-tabs siege-tabs";
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", "Chaos buildings");
    for (const site of SITES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tabs__tab monsters-tabs__tab";
      button.id = `siege-tab-${site}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "siege-body");
      button.textContent = SITE_NAME[site];
      button.addEventListener("click", () => this.open(site));
      strip.append(button);
      this.tabButtons.set(site, button);
    }
    strip.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = this.site === "lab" ? "factory" : "lab";
      this.open(next);
      this.tabButtons.get(next)?.focus();
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon monsters-screen__close";
    close.setAttribute("aria-label", "Close Chaos Weapons");
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    this.panel.titlebar.append(strip, close);

    this.purse = document.createElement("div");
    this.purse.className = "monsters-header siege-purse";
    this.purse.setAttribute("aria-label", "Inferno resources");

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.split = document.createElement("div");
    this.split.className = "locker__split siege__split";
    this.list = document.createElement("ul");
    this.list.className = "locker__list siege__list";
    this.list.setAttribute("aria-label", "Chaos weapons");
    this.detail = document.createElement("section");
    this.detail.className = "locker__detail siege__detail";
    this.detail.setAttribute("aria-live", "polite");
    this.split.append(this.list, this.detail);

    this.body = document.createElement("div");
    this.body.className = "monsters-body siege-body";
    this.body.id = "siege-body";
    this.body.setAttribute("role", "tabpanel");

    this.panel.setContent(this.purse, this.status, this.body);
    this.unsubscribe = this.binding.store.subscribe((change) => this.onChange(change));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get activeSite(): SiegeSite {
    return this.site;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** Opens the screen on a tab, or brings that tab forward. */
  open(site: SiegeSite = this.site): void {
    if (this.destroyed) return;
    const wasOpen = this.opened;
    const changed = site !== this.site;
    if (changed || !wasOpen) {
      this.confirm = null;
      this.setStatus(null);
    }
    this.opened = true;
    this.element.hidden = false;
    this.site = site;
    this.element.dataset["tab"] = site;
    for (const [id, button] of this.tabButtons) {
      const current = id === site;
      button.setAttribute("aria-selected", String(current));
      button.tabIndex = current ? 0 : -1;
    }
    this.body.setAttribute("aria-labelledby", `siege-tab-${site}`);
    this.render();
    // A phone's sheet scrolls the list and card together: a new tab starts at its list.
    if (changed) this.split.scrollTop = 0;
    if (!wasOpen) this.tabButtons.get(site)?.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.element.hidden = true;
    this.confirm = null;
    // Not playing where nobody looks.
    for (const video of this.detail.querySelectorAll("video")) video.pause();
    this.onClose?.();
  }

  /** Whether the building panel is open in the right dock: the screen then stands to its left. */
  besidePanel(beside: boolean): void {
    this.element.classList.toggle("monsters-screen--beside-panel", beside);
  }

  /** Once a second, from the scene. */
  tick(): void {
    if (!this.opened) return;
    const now = this.store.now();
    for (const clock of this.clocks) this.drawClock(clock, now);
    this.syncPending();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    for (const button of this.shiny.values()) button.destroy();
    this.shiny.clear();
    this.element.remove();
  }

  private get store() {
    return this.binding.store;
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
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.["focusKey"];
    this.renderPurse();
    this.clocks = [];
    this.plainButtons = [];
    const used = new Set<string>();

    const site = this.site;
    const notice = siteNotice(this.store, site);
    if (notice) {
      const note = document.createElement("div");
      note.className = "monsters-empty siege-notice";
      const text = document.createElement("p");
      text.className = "monsters-empty__title";
      text.textContent = noticeText(site, notice);
      note.append(text);
      this.body.replaceChildren(note);
    } else {
      const rows = siegeRows(this.store, site);
      const chosen = this.selected.get(site);
      const weapon =
        rows.find((row) => row.weapon.id === chosen) ?? rows.find((row) => row.job) ?? rows[0] ?? null;
      if (weapon) this.selected.set(site, weapon.weapon.id);
      this.renderList(rows, weapon?.weapon.id ?? null);
      this.renderDetail(weapon, used);
      if (this.body.firstChild !== this.split) this.body.replaceChildren(this.split);
    }

    for (const [key, button] of this.shiny) {
      if (!used.has(key)) {
        button.destroy();
        this.shiny.delete(key);
      }
    }
    this.syncPending();
    if (focusKey) this.element.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  /** The Inferno purse, each as held / cap. */
  private renderPurse(): void {
    const { held, caps } = purseOf(this.store.save.iresources);
    this.purse.replaceChildren(
      ...PURSE_KEYS.map((key) => {
        const text = caps[key] > 0 ? `${formatAmount(held[key])} / ${formatAmount(caps[key])}` : formatAmount(held[key]);
        const node = infernoAmount(key, text, "monsters-header__resource");
        node.title = `${INFERNO_RESOURCE_NAMES[key]}: ${text}`;
        return node;
      }),
    );
  }

  private renderList(rows: readonly SiegeRow[], selected: SiegeId | null): void {
    const site = this.site;
    const items = rows.map((row) => {
      const { weapon, level, quantity, job } = row;
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `locker-row siege-row${site === "lab" && level <= 0 && !job ? " locker-row--locked" : ""}`;
      button.dataset["weapon"] = weapon.id;
      button.dataset["focusKey"] = `row-${weapon.id}`;
      button.setAttribute("aria-pressed", String(weapon.id === selected));
      button.addEventListener("click", () => this.select(weapon.id));

      const icon = document.createElement("img");
      icon.className = "locker-row__picture siege-row__icon";
      icon.src = weaponArt(weapon.id).icon;
      icon.alt = "";
      icon.width = 50;
      icon.height = 50;

      const name = document.createElement("span");
      name.className = "locker-row__name siege-row__name";
      name.textContent = weapon.name;

      const line = document.createElement("span");
      line.className = "locker-row__state siege-row__state";
      // Flash's description slot: "Unlocking" or "Locked" in place of the stars.
      const words = site === "lab" && level <= 0 ? (job ? "Unlocking" : "Locked") : null;
      if (words) line.textContent = words;
      else line.append(stars(level));
      if (job) line.append(" ", this.jobBar(job, "siege-row__time"));

      button.append(icon, name, line);
      const ready =
        site === "factory" && quantity > 0 ? "Ready!" : site === "lab" && level >= SIEGE_MAX_LEVEL ? "Fully Upgraded" : null;
      if (ready) {
        const tag = document.createElement("span");
        tag.className = "siege-row__ready";
        tag.textContent = ready;
        button.append(tag);
      }
      item.append(button);
      return item;
    });
    this.list.replaceChildren(...items);
  }

  private renderDetail(row: SiegeRow | null, used: Set<string>): void {
    if (!row) {
      this.detail.replaceChildren();
      return;
    }
    const site = this.site;
    const { weapon, level, quantity } = row;

    const head = document.createElement("div");
    head.className = "siege-detail__head";
    const title = document.createElement("h3");
    title.className = "locker-detail__name siege-detail__title";
    title.textContent = weapon.name;
    head.append(title);
    if (site === "factory" && quantity > 0) {
      const ready = document.createElement("span");
      ready.className = "siege-detail__ready";
      ready.textContent = "Ready!";
      head.append(ready);
    }

    const art = weaponArt(weapon.id);
    let video = this.detail.querySelector<HTMLVideoElement>("video.siege-detail__video");
    if (!video || video.dataset["weapon"] !== weapon.id) {
      video = document.createElement("video");
      video.className = "siege-detail__video";
      video.dataset["weapon"] = weapon.id;
      video.width = 400;
      video.height = 175;
      video.poster = art.poster;
      video.src = art.video;
      // Flash looped it (`seek(0)` on stop); a browser plays it only muted.
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("aria-label", `${weapon.name} in action`);
    }

    const description = document.createElement("p");
    description.className = "locker-detail__blurb siege-detail__description";
    description.textContent = WEAPON_DESCRIPTION[weapon.id];

    const stats = document.createElement("dl");
    stats.className = "siege-stats";
    for (const stat of statLines(weapon, level, site)) {
      const label = document.createElement("dt");
      label.className = "siege-stats__label";
      label.textContent = stat.label;
      const value = document.createElement("dd");
      value.className = "siege-stats__value";
      const bar = document.createElement("span");
      bar.className = "siege-stats__bar";
      bar.setAttribute("aria-hidden", "true");
      const next = document.createElement("span");
      next.className = "siege-stats__next";
      next.style.width = `${+(stat.next * 100).toFixed(2)}%`;
      const now = document.createElement("span");
      now.className = "siege-stats__now";
      now.style.width = `${+(stat.now * 100).toFixed(2)}%`;
      bar.append(next, now);
      const figure = document.createElement("span");
      figure.className = "siege-stats__figure";
      figure.textContent =
        stat.diff === null
          ? formatAmount(stat.value)
          : `${formatAmount(stat.value)} (${stat.diff > 0 ? "+" : "-"}${formatAmount(Math.abs(stat.diff))})`;
      value.append(bar, figure);
      stats.append(label, value);
    }

    const offer = siegeOffer(this.store, site, weapon.id);
    if (offer.kind !== "running" && this.confirm?.kind === "cancel") this.confirm = null;
    const action = this.offerPart(offer, weapon.id, used);
    this.detail.replaceChildren(head, video, description, stats, action);
    if (video.paused) {
      try {
        void video.play()?.catch(() => {});
      } catch {
        // No media in this browser (or under test): the poster stays.
      }
    }
  }

  /** What can be done with the chosen weapon: the part of the popup under its stats. */
  private offerPart(offer: SiegeOffer, weapon: SiegeId, used: Set<string>): HTMLElement {
    const part = document.createElement("div");
    part.className = "siege-offer";
    switch (offer.kind) {
      case "running": {
        const { job } = offer;
        const box = document.createElement("div");
        box.className = "siege-box siege-box--instant";
        used.add("finish");
        const price = finishPrice(job, this.store.now());
        const finish = this.shinyButton("finish", "Finish Now", () => void this.runFinish());
        finish.setPrice(price);
        finish.setBlocked(this.store.credits < price ? "Not enough Shiny." : null);
        const words = document.createElement("p");
        words.className = "siege-box__text";
        box.append(finish.element, words);
        const bar = this.jobBar(job, "siege-offer__time", words);
        part.append(box, bar);
        if (this.confirm?.kind === "cancel") part.append(this.cancelConfirm(weapon));
        else {
          const cancel = plainButton("Cancel", () => {
            this.confirm = { kind: "cancel" };
            this.render();
            this.element.querySelector<HTMLButtonElement>(".siege-confirm__yes")?.focus();
          });
          cancel.classList.add("btn--ghost", "siege-offer__cancel");
          cancel.dataset["focusKey"] = "cancel";
          this.plainButtons.push(cancel);
          part.append(cancel);
        }
        return part;
      }
      case "max":
        return part;
      case "holding": {
        if (this.openMap) {
          const run = this.openMap;
          const map = plainButton("Open Map", () => {
            this.close();
            run();
          }, "btn--primary");
          map.dataset["focusKey"] = "map";
          part.append(map);
        }
        return part;
      }
      case "warning": {
        const warning = document.createElement("p");
        warning.className = "monsters-gate siege-offer__warning";
        warning.textContent = warningText(offer.warning);
        part.append(warning);
        return part;
      }
      case "start": {
        const boxes = document.createElement("div");
        boxes.className = "siege-offer__boxes";

        const instantBox = document.createElement("div");
        instantBox.className = "siege-box siege-box--instant";
        used.add("instant");
        const instant = this.shinyButton("instant", "Use", () => void this.runInstant(weapon));
        instant.setPrice(offer.instant);
        instant.setBlocked(this.store.credits < offer.instant ? "Not enough Shiny." : null);
        const instantText = document.createElement("p");
        instantText.className = "siege-box__text";
        instantText.textContent =
          offer.verb === "unlock"
            ? "Keep your resources and unlock instantly"
            : offer.verb === "upgrade"
              ? "Keep your resources and upgrade instantly"
              : "Keep your resources and build instantly.";
        instantBox.append(instant.element, instantText);

        const costBox = document.createElement("div");
        costBox.className = "siege-box siege-box--cost";
        const costs = document.createElement("dl");
        costs.className = "siege-costs";
        const { held } = purseOf(this.store.save.iresources);
        for (const key of PURSE_KEYS) {
          if (!(offer.cost[key] > 0)) continue;
          costs.append(...costLine(INFERNO_RESOURCE_NAMES[key], formatAmount(offer.cost[key]), held[key] < offer.cost[key], key));
        }
        costs.append(...costLine("Time", formatCountdown(offer.cost.time), false, "time"));
        const label =
          offer.verb === "unlock" ? "Start Unlocking" : offer.verb === "upgrade" ? "Start Upgrading" : "Start Building";
        const start = plainButton(label, () => this.pressStart(weapon), "btn--primary");
        start.dataset["focusKey"] = "start";
        this.plainButtons.push(start);
        costBox.append(costs, start);

        boxes.append(instantBox, costBox);
        part.append(boxes);
        if (this.confirm?.kind === "shortfall" && this.confirm.weapon === weapon) {
          part.append(this.shortfallConfirm(this.confirm, used));
        } else if (this.confirm?.kind === "capacity") {
          const line = document.createElement("p");
          line.className = "monsters-gate siege-offer__warning";
          line.setAttribute("role", "alert");
          line.textContent = CAPACITY_TEXT;
          part.append(line);
        }
        return part;
      }
    }
    return part;
  }

  /** A job's time bar and the time left, kept by {@link tick}; `shinyText` gets "Use N Shiny to Finish Now!". */
  private jobBar(job: SiegeJob, className: string, shinyText: HTMLElement | null = null): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = `siege-time ${className}`;
    const bar = document.createElement("span");
    bar.className = "monsters-bar siege-time__bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${job.weapon.name} progress`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("span");
    fill.className = "monsters-bar__fill";
    bar.append(fill);
    const time = document.createElement("span");
    time.className = "siege-time__left";
    wrap.append(bar, time);
    const clock = { job, time, fill, bar, shinyText };
    this.clocks.push(clock);
    this.drawClock(clock, this.store.now());
    return wrap;
  }

  private drawClock(clock: JobClock, now: number): void {
    const remaining = Math.max(0, clock.job.endsAt - now);
    clock.time.textContent = formatCountdown(remaining);
    const done = progressFraction(remaining, Math.max(remaining, clock.job.duration, 1));
    const percent = Math.round(done * 100);
    clock.fill.style.width = `${done * 100}%`;
    clock.bar.setAttribute("aria-valuenow", String(percent));
    clock.bar.setAttribute("aria-valuetext", `${percent}%, ${formatCountdown(remaining)} left`);
    if (clock.shinyText) {
      const price = finishPrice(clock.job, now);
      clock.shinyText.textContent = `Use ${formatAmount(price)} Shiny to Finish Now!`;
      const finish = this.shiny.get("finish");
      finish?.setPrice(price);
      finish?.setBlocked(this.store.credits < price ? "Not enough Shiny." : null);
    }
  }

  /** Flash's cancel confirm: `msg_upgrade_confirmcancel` with Stop Upgrading, `msg_build_confirmcancel` with Stop Building. */
  private cancelConfirm(weapon: SiegeId): HTMLElement {
    const name = siegeData(weapon)?.name ?? weapon;
    const lab = this.site === "lab";
    const wrap = document.createElement("div");
    wrap.className = "siege-confirm";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Confirm cancel");
    const question = document.createElement("p");
    question.className = "siege-confirm__question";
    question.textContent = `Are you sure you want to stop ${lab ? "upgrading" : "building"} ${name}?`;
    const row = document.createElement("div");
    row.className = "map-row";
    const yes = plainButton(lab ? "Stop Upgrading" : "Stop Building", () => {
      this.confirm = null;
      void this.runCancel();
    }, "btn--danger");
    yes.classList.add("siege-confirm__yes");
    const keep = plainButton(lab ? "Keep upgrading" : "Keep building", () => {
      this.confirm = null;
      this.render();
    });
    this.plainButtons.push(yes);
    row.append(yes, keep);
    wrap.append(question, row);
    return wrap;
  }

  /** Flash's `buildoptions_err_moreresources` with Get Resources: buys the shortfall and starts. */
  private shortfallConfirm(confirm: Extract<Confirm, { kind: "shortfall" }>, used: Set<string>): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "siege-confirm";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Get the resources");
    const [need, ask] = shortfallText({ missing: confirm.missing, topUp: confirm.topUp });
    const first = document.createElement("p");
    first.className = "siege-confirm__question";
    first.textContent = need;
    const second = document.createElement("p");
    second.className = "siege-confirm__text";
    second.textContent = ask;
    const row = document.createElement("div");
    row.className = "map-row";
    used.add("topUp");
    const buy = this.shinyButton("topUp", "Get Resources", () => {
      const { weapon, topUp } = confirm;
      this.confirm = null;
      void this.runStart(weapon, topUp);
    });
    buy.setPrice(confirm.topUp);
    buy.setBlocked(this.store.credits < confirm.topUp ? "Not enough Shiny." : null);
    buy.element.classList.add("siege-confirm__yes");
    const back = plainButton("Cancel", () => {
      this.confirm = null;
      this.render();
    });
    row.append(buy.element, back);
    wrap.append(first, second, row);
    return wrap;
  }

  private select(id: SiegeId): void {
    if (this.selected.get(this.site) === id) return;
    this.selected.set(this.site, id);
    this.confirm = null;
    // Another weapon's Instant is another price: never carry an armed one across.
    for (const key of ["instant", "topUp"]) {
      this.shiny.get(key)?.destroy();
      this.shiny.delete(key);
    }
    this.render();
  }

  private shinyButton(key: string, label: string, onSpend: () => void): ShinyButton {
    let button = this.shiny.get(key);
    if (!button) {
      button = new ShinyButton({ label, spell: formatAmount, onSpend });
      button.element.dataset["focusKey"] = key;
      this.shiny.set(key, button);
    }
    return button;
  }

  /** Every button waits while any siege request is in flight or queued. */
  private syncPending(): void {
    const store = this.store;
    const busy = SIEGE_KEYS.some((key) => store.isRunning(key));
    for (const button of this.shiny.values()) button.setBusy(busy);
    for (const button of this.plainButtons) {
      if (busy) {
        if (!button.disabled) button.setAttribute("aria-busy", "true");
        button.disabled = true;
      } else if (button.getAttribute("aria-busy") === "true") {
        button.removeAttribute("aria-busy");
        button.disabled = false;
      }
    }
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  /**
   * Start (`SiegeBuildingPopup.DoResources`, `:620-660`): with everything
   * held it starts; over a cap it says so (`msg_morepodsunlock`); short, it
   * asks to buy the shortfall first.
   */
  private pressStart(weapon: SiegeId): void {
    const offer = siegeOffer(this.store, this.site, weapon);
    if (offer.kind !== "start") return;
    const short = shortfallOf(offer.cost, purseOf(this.store.save.iresources));
    if (!short) {
      this.confirm = null;
      void this.runStart(weapon);
      return;
    }
    this.confirm = short.overCap
      ? { kind: "capacity" }
      : { kind: "shortfall", weapon, missing: short.missing, topUp: short.topUp };
    this.setStatus(null);
    this.render();
    this.element.querySelector<HTMLButtonElement>(".siege-confirm__yes")?.focus();
  }

  private async runStart(weapon: SiegeId, topUp?: number): Promise<void> {
    const site = this.site;
    const level = stockOf(this.store.save.siege, weapon).level;
    const result = await this.actions[site].start(weapon, topUp);
    // A purse the client had wrong: the server's shortfall and price, asked again.
    if (!result.ok && result.refusal.reason === "shortfall" && !result.refusal.local) {
      const detail = result.refusal.detail as { shortfall?: Partial<PurseAmounts>; topUp?: unknown };
      const missing = PURSE_KEYS.reduce((sum, key) => sum + (Number(detail.shortfall?.[key]) || 0), 0);
      if (typeof detail.topUp === "number" && missing > 0) {
        this.confirm = { kind: "shortfall", weapon, missing, topUp: detail.topUp };
        this.render();
        return;
      }
    }
    if (!result.ok && result.refusal.reason === "capacity") {
      this.confirm = { kind: "capacity" };
      this.render();
      return;
    }
    this.report(result, (report) => {
      const name = siegeData(report.weapon)?.name ?? report.weapon;
      const spent = PURSE_KEYS.filter((key) => report.cost[key] > 0).flatMap((key, index) => [
        ...(index > 0 ? [", "] : []),
        infernoAmount(key, report.cost[key]),
      ]);
      const what =
        site === "factory" ? `Building ${name}` : level === 0 ? `Unlocking ${name}` : `Upgrading ${name} to level ${level + 1}`;
      return [
        `${what}: `,
        ...spent,
        ...(report.credits > 0 ? [" and ", resourceAmount("shiny", report.credits)] : []),
        " spent.",
      ];
    });
  }

  private async runInstant(weapon: SiegeId): Promise<void> {
    const site = this.site;
    const result = await this.actions[site].instant(weapon);
    this.report(result, (report) => [...doneText(site, report), " For ", resourceAmount("shiny", report.credits), "."]);
  }

  private async runFinish(): Promise<void> {
    const site = this.site;
    const result = await this.actions[site].finish();
    this.report(result, (report) => [
      ...doneText(site, report),
      ...(report.credits > 0 ? [" For ", resourceAmount("shiny", report.credits), "."] : []),
    ]);
  }

  private async runCancel(): Promise<void> {
    const site = this.site;
    const result = await this.actions[site].cancel();
    this.report(result, (report) => {
      const back = PURSE_KEYS.filter((key) => report.refund[key] > 0).flatMap((key, index) => [
        ...(index > 0 ? [", "] : []),
        infernoAmount(key, report.refund[key]),
      ]);
      const stopped = site === "lab" ? "Upgrade stopped." : "Building stopped.";
      return back.length > 0 ? [`${stopped} Got back `, ...back, "."] : [stopped];
    });
  }

  private report<Report>(result: YardActionResult<Report>, success: (report: Report) => (Node | string)[]): void {
    if (result.ok) this.setStatus({ tone: "good", content: success(result.report) });
    else this.setStatus({ tone: "bad", content: [refusalText(result.refusal)] });
    if (this.opened) this.render();
  }

  private setStatus(status: Status | null): void {
    this.status.hidden = status === null;
    this.status.className = status ? `monsters-status monsters-status--${status.tone}` : "monsters-status";
    this.status.replaceChildren(...(status?.content ?? []));
  }
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

/** Ten stars, on up to the level (`SiegeBuildingPopup_ListItem_CLIP.star1..10`). */
const stars = (level: number): HTMLElement => {
  const node = document.createElement("span");
  node.className = "siege-stars";
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", `Level ${level} of ${SIEGE_MAX_LEVEL}`);
  for (let index = 0; index < SIEGE_MAX_LEVEL; index++) {
    const star = document.createElement("span");
    star.className = index < level ? "siege-stars__star siege-stars__star--on" : "siege-stars__star";
    star.textContent = "★";
    node.append(star);
  }
  return node;
};

/** One line of the cost box: the name and the figure, red when the purse is short of it. */
const costLine = (name: string, figure: string, short: boolean, key: string): HTMLElement[] => {
  const term = document.createElement("dt");
  term.className = "siege-costs__name";
  term.textContent = name;
  const value = document.createElement("dd");
  value.className = short ? "siege-costs__value siege-costs__value--short" : "siege-costs__value";
  value.dataset["resource"] = key;
  value.textContent = figure;
  return [term, value];
};

/** Flash's `msg_weaponupgraded` and `msg_weaponbuilt`. */
const doneText = (site: SiegeSite, report: { weapon: SiegeId; siege: Record<SiegeId, { level: number }> }): string[] => {
  const name = siegeData(report.weapon)?.name ?? report.weapon;
  return site === "lab"
    ? [`Your ${name} has completed upgrading to Level ${report.siege[report.weapon]?.level ?? 0}.`]
    : [`Your ${name} has finished building and is now ready to use against an enemy yard.`];
};

const plainButton = (label: string, onClick: () => void, variant?: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = variant ? `btn ${variant}` : "btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network" ? "Could not reach the server. Try again." : refusal.message || "That did not work.";
