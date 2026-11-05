import { questsActions, type QuestPeriod, type QuestsActions, type QuestsReport, type QuestsView } from "@/api/quests";
import type { YardActionResult } from "@/game/yard/YardStore";
import { grantedRewards, utcDayOf } from "@/game/quests/questsModel";
import { showPortrait } from "@/game/portraits";
import { claimedLine } from "@/ui/events/EventsPanel";
import { LOGIN_KEY } from "@/ui/quests/loginCard";
import { LoginPopup } from "@/ui/quests/LoginPopup";
import { bonusKey, questKey, QuestsPanel, swapKey, type QuestsPanelView, type QuestsTab } from "@/ui/quests/QuestsPanel";
import { dockButton } from "@/ui/yard/YardDock";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";
import { screenBusy } from "./announcements";

/**
 * Own-yard plugin for the daily login card, daily quests and weekly quests
 * (beta 6, owner decisions 8-9; server `controllers/yard/questsActions.ts`):
 * the Quests button with its red number, the Quests window, and the login
 * card's pop-up.
 *
 * - **Button.** Put in the dock beside Monsters; the bubble menu gathers it
 *   into More's fan, nearest More (`BUBBLE_ITEMS`), or it stays in the dock
 *   with the menu off.
 *   The red number is `questsClaimable`, which every yard answer carries.
 * - **Window.** Read with `quests/state` on mount and whenever it opens;
 *   claims and the swap answer with the new view, so the window follows at
 *   once. The countdowns run on the store's server clock; when the day (or
 *   the week) turns, the state is read again.
 * - **Pop-up.** On the first yard load of the UTC day with today's login day
 *   unclaimed, the card pops up once nothing else has the screen (the guided
 *   start, an announcement, "What's new", Bob, the planner). Once a UTC day
 *   per main yard per browser, claimed or not; the red number reminds after that.
 *
 * Main yard only: the routes refuse on an outpost and on the Inferno.
 */

const QUESTS_NOTICE = "quests";

/** How often the countdowns and the day's turn are checked. */
const TICK_MS = 1_000;

/** The pop-up waits this long after the yard loads, so other pop-ups go first. */
export const POPUP_FIRST_DELAY_MS = 4_000;
/** Then checks this often whether the screen is free. */
export const POPUP_RETRY_MS = 1_000;

/** Where the pop-up remembers the day it last showed, per player. */
const popupStorageKey = (baseid: string): string => `bymr.quests.loginPopup.${baseid}`;

const readShownDay = (baseid: string): string | null => {
  try {
    return window.localStorage.getItem(popupStorageKey(baseid));
  } catch {
    return null;
  }
};

const writeShownDay = (baseid: string, day: string): void => {
  try {
    window.localStorage.setItem(popupStorageKey(baseid), day);
  } catch {
    // Private mode: the pop-up may show again on the next load today.
  }
};

/** Puts the Quests button in the dock, where the bubble menu (if on) gathers it. */
export const placeQuestsButton = (mounts: YardMounts, button: HTMLElement): void => mounts.dock.placeBesideMonsters(button);

/** The button's painted picture: Flash's "quest complete" monster. */
const buttonArt = (): HTMLImageElement => {
  const image = document.createElement("img");
  image.className = "yard-dock__picture quests-dock-art";
  image.alt = "";
  image.decoding = "async";
  showPortrait(image, { src: "/assets/popups/completequest.png", fallback: null });
  return image;
};

export class QuestsDoor {
  readonly button: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly mounts: YardMounts;
  private readonly actions: QuestsActions;
  private panel: QuestsPanel | null = null;
  private popup: LoginPopup | null = null;
  private view: QuestsView | null = null;
  private loadFailed: string | null = null;
  private busy: string | null = null;
  private refusal: { key: string; message: string } | null = null;
  private loading: Promise<void> | null = null;
  private timer: number | null = null;
  private popupTimer: number | null = null;
  private popupFreeTicks = 0;
  private popupChecked = false;
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(mounts: YardMounts, actions: QuestsActions = questsActions(mounts.store)) {
    this.mounts = mounts;
    this.actions = actions;
    const { element, disc } = dockButton("quests", "Quests", buttonArt(), () => this.toggle());
    this.button = element;
    this.button.classList.add("quests-door");
    this.button.setAttribute("aria-expanded", "false");
    this.badge = document.createElement("span");
    this.badge.className = "yard-dock__badge quests-badge";
    this.badge.hidden = true;
    disc.append(this.badge);
    placeQuestsButton(mounts, element);
    this.unsubscribe = mounts.store.subscribe(() => this.refreshBadge());
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.refreshBadge();
  }

  /** The red number: the latest yard answer's `questsClaimable`, else the window's own count. */
  get claimable(): number {
    const fromStore = Number(this.mounts.store.save.questsClaimable);
    const count = Number.isFinite(fromStore) ? fromStore : (this.view?.claimable ?? 0);
    return count > 0 ? Math.floor(count) : 0;
  }

  /** Reads the window's state (one read at a time). */
  load(): Promise<void> {
    this.loading ??= this.read().finally(() => (this.loading = null));
    return this.loading;
  }

  private async read(): Promise<void> {
    const result = await this.actions.state();
    if (this.destroyed) return;
    if (result.ok) {
      this.view = result.report.quests;
      this.loadFailed = null;
    } else {
      this.loadFailed = result.refusal.message;
    }
    this.render();
    if (result.ok) this.schedulePopup();
  }

  /** Opens or closes the window; `tab` brings that tab forward. */
  toggle(tab?: QuestsTab): void {
    if (this.panel) {
      this.panel.close();
      return;
    }
    this.open(tab);
  }

  open(tab?: QuestsTab): void {
    if (this.panel) {
      if (tab) this.panel.show(tab);
      return;
    }
    this.panel = new QuestsPanel({
      onClaimLogin: () => void this.claimLogin(),
      onClaim: (period, slot) => void this.claim(period, slot),
      onClaimBonus: (period) => void this.claimBonus(period),
      onSwap: (slot) => void this.swap(slot),
      onRetry: () => void this.load(),
      onClose: () => {
        this.panel = null;
        this.refusal = null;
        this.button.setAttribute("aria-expanded", "false");
      },
      ...(tab && { tab }),
    }).mount(this.mounts.overlay.content);
    this.button.setAttribute("aria-expanded", "true");
    this.render();
    void this.load();
  }

  private get now(): number {
    return this.mounts.store.now();
  }

  private panelView(): QuestsPanelView {
    if (this.view) return { kind: "list", quests: this.view, now: this.now, busy: this.busy, refusal: this.refusal };
    if (this.loadFailed) return { kind: "error", message: this.loadFailed };
    return { kind: "loading" };
  }

  private render(): void {
    this.panel?.render(this.panelView());
    if (this.popup && this.view) {
      this.popup.render({ quests: this.view, now: this.now, busy: this.busy, refusal: this.refusal });
    }
    this.refreshBadge();
  }

  private refreshBadge(): void {
    const count = this.claimable;
    this.badge.hidden = count === 0;
    this.badge.textContent = count > 99 ? "99+" : String(count);
    const words = count === 1 ? "1 reward to claim" : `${count} rewards to claim`;
    this.button.setAttribute("aria-label", count > 0 ? `Quests. ${words}` : "Quests");
    this.button.title = count > 0 ? `Quests: ${words}` : "Quests: daily login, daily and weekly quests";
  }

  /** Every second: the countdowns, and a fresh read once the day or the week has turned. */
  private tick(): void {
    if (!this.view || this.loading) return;
    const now = this.now;
    if (now >= this.view.nextDayAt || now >= this.view.nextWeekAt) {
      void this.load();
      return;
    }
    this.panel?.tick(now);
  }

  /* ── Claims ──────────────────────────────────────────────────────────── */

  /** Runs one claim or swap under `key`; the answer's view replaces the window's. */
  private async act(
    key: string,
    send: () => Promise<YardActionResult<QuestsReport>>,
    notice: (report: QuestsReport) => HTMLElement | null,
  ): Promise<boolean> {
    if (this.busy !== null) return false;
    this.busy = key;
    this.refusal = null;
    this.render();
    const result = await send();
    if (this.destroyed) return false;
    this.busy = null;
    if (result.ok) {
      this.view = result.report.quests;
      const line = notice(result.report);
      if (line) this.mounts.notices.show(QUESTS_NOTICE, line, { level: "info", timeoutMs: 5_000 });
    } else {
      this.refusal = { key, message: result.refusal.message };
      // The window may be stale (a day turned, a claim from another tab): read it again.
      void this.load();
    }
    this.render();
    return result.ok;
  }

  async claimLogin(): Promise<void> {
    const claimed = await this.act(LOGIN_KEY, () => this.actions.claimLogin(), (report) =>
      claimedLine(`Day ${report.day ?? ""} claimed`, grantedRewards(report.granted ?? [])),
    );
    // The pop-up has done its job once the day is claimed: it closes a moment later.
    if (claimed && this.popup) {
      const popup = this.popup;
      window.setTimeout(() => popup.close(), 1_200);
    }
  }

  async claim(period: QuestPeriod, slot: number): Promise<void> {
    await this.act(questKey(period, slot), () => this.actions.claim(period, slot), (report) =>
      claimedLine("Quest claimed", grantedRewards(report.granted ?? [])),
    );
  }

  async claimBonus(period: QuestPeriod): Promise<void> {
    await this.act(bonusKey(period), () => this.actions.claimBonus(period), (report) =>
      claimedLine("Bonus claimed", grantedRewards(report.granted ?? [])),
    );
  }

  async swap(slot: number): Promise<void> {
    await this.act(swapKey(slot), () => this.actions.swap(slot), () => null);
  }

  /* ── The login pop-up ────────────────────────────────────────────────── */

  /** After the first good read: the pop-up, if today's day is unclaimed and it has not shown today. */
  private schedulePopup(): void {
    if (this.popupChecked || !this.view) return;
    this.popupChecked = true;
    if (this.view.login.claimedToday) return;
    const baseid = String(this.mounts.store.save.baseid ?? "");
    if (readShownDay(baseid) === utcDayOf(this.view.now)) return;
    this.popupTimer = window.setTimeout(() => this.tryPopup(), POPUP_FIRST_DELAY_MS);
  }

  /** Shows the pop-up once the screen has been free for two checks in a row. */
  private tryPopup(): void {
    this.popupTimer = null;
    if (this.destroyed || !this.view || this.view.login.claimedToday) return;
    const free = !screenBusy(this.mounts) && !this.panel;
    this.popupFreeTicks = free ? this.popupFreeTicks + 1 : 0;
    if (this.popupFreeTicks < 2) {
      this.popupTimer = window.setTimeout(() => this.tryPopup(), POPUP_RETRY_MS);
      return;
    }
    this.showPopup();
  }

  /** Opens the login card's pop-up now. */
  showPopup(): void {
    if (this.popup || !this.view) return;
    writeShownDay(String(this.mounts.store.save.baseid ?? ""), utcDayOf(this.view.now));
    this.popup = new LoginPopup(
      {
        container: this.mounts.overlay.modal,
        onClaim: () => void this.claimLogin(),
        onMore: () => {
          this.popup?.close();
          this.open("today");
        },
        onClose: () => {
          this.popup = null;
          if (this.refusal?.key === LOGIN_KEY) this.refusal = null;
        },
      },
      { quests: this.view, now: this.now, busy: this.busy, refusal: this.refusal },
    );
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.popupTimer !== null) window.clearTimeout(this.popupTimer);
    this.popup?.close();
    this.panel?.close();
    this.button.remove();
  }
}

export const questsPlugin: YardPlugin = (mounts) => {
  if (mounts.store.kind !== "main") return;
  const door = new QuestsDoor(mounts);
  void door.load();
  return () => door.destroy();
};

YARD_PLUGINS.push(questsPlugin);
