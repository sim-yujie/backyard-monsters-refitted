import { quietLogin } from "@/game/quietLogin";
import {
  eventsActions,
  eventsApi,
  type EventsActions,
  type EventsApi,
  type EventView,
  type Mr2WelcomeStatus,
} from "@/api/events";
import { claimableCount, claimableTiers, grantedKrallenText, isOver, serverClock, type ServerClock } from "@/game/events/eventsModel";
import { onPumpkins, PUMPKIN_HUNT_KIND, withPumpkinCount } from "@/game/events/pumpkinHunt";
import { currentSeason, seasonFor, setSeason } from "@/game/season";
import { latestRelease, localSeen, markSeen, whatsNewDecision } from "@/game/events/whatsNew";
import { gameIcon } from "@/ui/gameIcon";
import { calendarKey, claimedLine, EventsPanel, readyLine, tierKey, type EventsPanelView } from "@/ui/events/EventsPanel";
import { modalLayer, openWhatsNew } from "@/ui/events/WhatsNewDialog";
import "@/ui/events/pumpkinHuntHint";
import { dockButton } from "@/ui/yard/YardDock";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for events (server `game-data/events/events.ts`): the
 * Events button at the top right with a badge for rewards waiting, the Events
 * page, and the "What's new" cards' one pop-up after an update.
 *
 * - **Button.** Shown only while an event is on or coming up. The badge
 *   counts today's calendar treat and any ladder tier reached.
 * - **Clock.** Countdowns run on the server's clock (`serverClock`); the list
 *   is read again when an event starts or ends, or the next day's treat
 *   opens, and whenever the page opens.
 * - **Claims** go through the yard store's queue, which merges what they pay
 *   (resources, Shiny, store items) into the HUD; a notice says what came.
 * - **Ready.** A picked pumpkin that reaches a ladder tier says so in a
 *   notice whose Claim button opens the page, and the page opens scrolled to
 *   the first Claim (bug report #10: the ladder sits under the calendar,
 *   below the fold on a phone).
 * - **What's new.** The first read also says which release's cards the
 *   player has seen; the newest pops up once (`game/events/whatsNew.ts`).
 *
 * Main yard only: the claims refuse on an outpost.
 */

const EVENTS_NOTICE = "events";
/** Its own key: a notice with a button cannot reuse one shown without. */
const READY_NOTICE = "events-ready";

/** How often the page's countdowns and the list's freshness are checked. */
const TICK_MS = 1_000;
/** A computer's screen, as the centred windows count it (ui.css). */
const COMPUTER_QUERY = "(width > 620px) and (height > 500px)";

/**
 * The button's picture: the painted festive calendar with its gold star and
 * rosette (`ui/gameIcon.ts`, art-samples/events-icons), which suits every
 * event, where the Halloween pumpkin did not (owner, 8 Nov).
 */
const buttonArt = (): HTMLImageElement => {
  const image = gameIcon("event", { size: 32, decorative: true, className: "events-door__art" });
  image.sizes = "36px";
  return image;
};

export class EventsDoor {
  readonly button: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly mounts: YardMounts;
  private readonly api: EventsApi;
  private readonly actions: EventsActions;
  private panel: EventsPanel | null = null;
  private events: readonly EventView[] | null = null;
  /** The "New to Map Room 2" card, or null. */
  private welcome: Mr2WelcomeStatus | null = null;
  private clock: ServerClock | null = null;
  private loadFailed: string | null = null;
  private claiming: string | null = null;
  private refusal: { key: string; message: string } | null = null;
  private loading: Promise<void> | null = null;
  private timer: number | null = null;
  private destroyed = false;
  private whatsNewChecked = false;
  /** The page was just opened: scroll it to the first Claim once the list shows. */
  private scrollToClaim = false;
  /** Stops following the pumpkin hunt's count (`game/events/pumpkinHunt.ts`). */
  private readonly unwatchPumpkins: () => void;

  constructor(mounts: YardMounts, api: EventsApi = eventsApi, actions: EventsActions = eventsActions(mounts.store, api)) {
    this.mounts = mounts;
    this.api = api;
    this.actions = actions;
    const { element, disc } = dockButton("events", "Events", buttonArt(), () => this.toggle());
    this.button = element;
    this.button.classList.add("events-door");
    this.button.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    // A pumpkin picked: the ladder and the badge move at once, not at the next read.
    this.unwatchPumpkins = onPumpkins((count) => {
      if (!this.events) return;
      const before = this.events;
      this.events = withPumpkinCount(this.events, count);
      this.refresh();
      this.noteTierReady(before, this.events);
    });
    this.badge = document.createElement("span");
    this.badge.className = "yard-dock__badge events-badge";
    this.badge.hidden = true;
    disc.append(this.badge);
    mounts.dock.element.append(element);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  /** Reads the list (one read at a time). */
  load(): Promise<void> {
    this.loading ??= this.read().finally(() => (this.loading = null));
    return this.loading;
  }

  private async read(): Promise<void> {
    let serverSeen: string | null = null;
    try {
      const body = await this.api.list();
      if (this.destroyed) return;
      this.clock = serverClock(body.now, Date.now());
      this.events = body.events;
      this.welcome = body.mr2Welcome ?? null;
      // An event that started since the yard loaded dresses it now. The yard's
      // own load already chose among overlapping events (a forced one first),
      // so a season whose event is still on is kept rather than replaced by
      // whichever comes first in this list.
      const activeKinds = body.events.filter((event) => event.status === "active").map((event) => event.kind);
      if (!activeKinds.includes(currentSeason())) setSeason(seasonFor(activeKinds));
      this.loadFailed = null;
      serverSeen = body.whatsNewSeen;
    } catch {
      if (this.destroyed) return;
      this.loadFailed = "Could not load the events. Check your connection and try again.";
    }
    this.refresh();
    this.checkWhatsNew(serverSeen);
  }

  /** The "What's new" pop-up, once per visit at most. */
  private checkWhatsNew(serverSeen: string | null): void {
    if (this.whatsNewChecked) return;
    this.whatsNewChecked = true;
    // A test server's quiet login: shut, and nothing marked seen.
    if (quietLogin()) return;
    const latest = latestRelease();
    const decision = whatsNewDecision(latest, serverSeen, localSeen(), this.mounts.store.save.onboarding?.guide.state);
    if (!latest || decision === "none") return;
    void markSeen(latest.version);
    if (decision === "show") openWhatsNew({ container: modalLayer() });
  }

  /**
   * Opens or shuts the Events page. Opened from its button it starts at the
   * top on a computer, where the Frontier Pass leads the page; a phone and
   * `atClaim` (a "Claim" notice) still scroll to the first Claim, which on a
   * phone sits below the fold (bug report #10).
   */
  toggle(atClaim = false): void {
    if (this.panel) {
      this.panel.close();
      return;
    }
    this.panel = new EventsPanel({
      onClaimCalendar: (event) => void this.claimCalendar(event),
      onClaimTier: (event, tier) => void this.claimTier(event, tier),
      onRetry: () => void this.load(),
      onGoToMapRoom2: () => {
        this.panel?.close();
        this.mounts.scene.openMap();
      },
      onClose: () => {
        this.panel = null;
        this.refusal = null;
        this.scrollToClaim = false;
        this.button.setAttribute("aria-expanded", "false");
      },
    }).mount(this.mounts.overlay.content);
    this.button.setAttribute("aria-expanded", "true");
    this.scrollToClaim = atClaim || window.matchMedia?.(COMPUTER_QUERY).matches !== true;
    this.render();
    void this.load();
  }

  /** The Events page open (opened if shut), scrolled to the first Claim. */
  private openAtClaim(): void {
    this.mounts.notices.clear(READY_NOTICE);
    if (this.panel) {
      this.panel.showFirstClaim();
      return;
    }
    this.toggle(true);
  }

  /** A pumpkin that reached a ladder tier: a notice with the tier's rewards and a Claim button. */
  private noteTierReady(before: readonly EventView[], after: readonly EventView[]): void {
    for (const event of after) {
      if (event.kind !== PUMPKIN_HUNT_KIND || !event.ladder) continue;
      const old = before.find((other) => other.id === event.id)?.ladder;
      const was = new Set(old ? claimableTiers(old) : []);
      const fresh = claimableTiers(event.ladder).filter((index) => !was.has(index));
      const tier = fresh.length > 0 ? event.ladder.tiers[fresh[fresh.length - 1]!] : undefined;
      if (!tier) continue;
      this.mounts.notices.show(READY_NOTICE, readyLine(tier.need, tier.rewards), {
        level: "info",
        timeoutMs: 10_000,
        actionLabel: "Claim",
        onAction: () => this.openAtClaim(),
      });
      return;
    }
  }

  private get now(): number {
    return this.clock?.now() ?? Date.now() / 1000;
  }

  private view(): EventsPanelView {
    if (this.events) {
      return {
        kind: "list",
        events: this.events,
        now: this.now,
        claiming: this.claiming,
        refusal: this.refusal,
        mr2Welcome: this.welcome,
      };
    }
    if (this.loadFailed) return { kind: "error", message: this.loadFailed };
    return { kind: "loading" };
  }

  private render(): void {
    const view = this.view();
    this.panel?.render(view);
    if (this.scrollToClaim && view.kind === "list") {
      this.scrollToClaim = false;
      this.panel?.showFirstClaim();
    }
  }

  private refresh(): void {
    const events = this.events ?? [];
    this.button.hidden = events.length === 0 && this.welcome === null;
    const count = claimableCount(events);
    this.badge.hidden = count === 0;
    this.badge.textContent = count > 99 ? "99+" : String(count);
    const words = count === 1 ? "1 reward to claim" : `${count} rewards to claim`;
    this.button.setAttribute("aria-label", count > 0 ? `Events. ${words}` : "Events");
    this.button.title = count > 0 ? `Events: ${words}` : "Events: what is on and coming up";
    this.render();
  }

  /** Every second: the page's countdowns, and a fresh read when the list has gone stale. */
  private tick(): void {
    if (!this.events || this.loading) return;
    const now = this.now;
    const stale =
      (this.welcome !== null && now >= this.welcome.endsAt) ||
      this.events.some(
        (event) => isOver(event, now) || (event.calendar?.nextAt != null && now >= event.calendar.nextAt),
      );
    if (stale) {
      void this.load();
      return;
    }
    this.panel?.tick(now);
  }

  private async claimCalendar(event: EventView): Promise<void> {
    if (this.claiming !== null) return;
    this.claiming = calendarKey(event.id);
    this.refusal = null;
    this.render();
    const result = await this.actions.claimCalendar(event.id);
    if (this.destroyed) return;
    this.claiming = null;
    if (result.ok) {
      const day = event.calendar?.days[result.report.day - 1] ?? [];
      this.mounts.notices.show(EVENTS_NOTICE, claimedLine(`Day ${result.report.day} claimed`, day), {
        level: "info",
        timeoutMs: 5_000,
      });
    } else {
      this.refusal = { key: calendarKey(event.id), message: result.refusal.message };
    }
    this.render();
    await this.load();
  }

  private async claimTier(event: EventView, tier: number): Promise<void> {
    if (this.claiming !== null) return;
    const key = tierKey(event.id, tier);
    this.claiming = key;
    this.refusal = null;
    this.render();
    const result = await this.actions.claimTier(event.id, tier);
    if (this.destroyed) return;
    this.claiming = null;
    if (result.ok) {
      const rewards = event.ladder?.tiers[tier]?.rewards ?? [];
      const words = grantedKrallenText(result.report.granted) ?? claimedLine("Claimed", rewards);
      this.mounts.notices.show(EVENTS_NOTICE, words, {
        level: "info",
        timeoutMs: 5_000,
      });
    } else {
      this.refusal = { key, message: result.refusal.message };
    }
    this.render();
    await this.load();
  }

  destroy(): void {
    this.destroyed = true;
    this.unwatchPumpkins();
    if (this.timer !== null) window.clearInterval(this.timer);
    this.panel?.close();
    this.button.remove();
  }
}

export const eventsPlugin: YardPlugin = (mounts) => {
  if (mounts.store.kind !== "main") return;
  const door = new EventsDoor(mounts);
  void door.load();
  return () => door.destroy();
};

YARD_PLUGINS.push(eventsPlugin);
