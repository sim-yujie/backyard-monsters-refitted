import type { ApiError } from "@/api/http";
import {
  maintenanceRefusal,
  readMaintenanceNotice,
  type MaintenanceNotice,
  type MaintenanceRefusal,
} from "@/api/maintenance";
import type { MaintenanceBannerView } from "@/ui/MaintenanceBanner";
import { maintenanceBlock, setMaintenanceBlock } from "./maintenanceBlock";

/**
 * The maintenance switch in a running game (owner, 22 Nov 2026;
 * `server/src/services/admin/maintenance.ts`).
 *
 * How the countdown reaches the player:
 * - the chat connection, which every player in the game normally has open,
 *   carries each change at once (`server/src/chat/chatMaintenance.ts`);
 * - with chat off or down, the game asks `GET /maintenance` every
 *   {@link POLL_MS}, and once right after signing in;
 * - past the cut-off the server refuses every request, so the first one the
 *   game sends signs the player out too, whatever was missed.
 *
 * At zero (the game's own clock, from the time left the server sent) a
 * player who is not the owner is signed out at once, mid-attack too, and
 * lands on the sign-in screen with the owner's message. The saved session is
 * kept (`pauseSession`), so Try again comes back in once it is over.
 */

/** How often a game without chat asks. */
export const POLL_MS = 30_000;

/** How often the banner's clock is redrawn. */
export const TICK_MS = 250;

export interface MaintenanceWatchDeps {
  /** The chat connection's maintenance news, and whether it is up. */
  readonly chat: {
    onMaintenance(listener: (raw: unknown) => void): () => void;
    readonly online: boolean;
  };
  /** Every refused request (`api/http.ts` `onRefusal`). */
  readonly onRefusal: (listener: (error: ApiError) => void) => () => void;
  readonly fetch: () => Promise<MaintenanceNotice | null>;
  /** Signed in: a session token is in use. */
  readonly signedIn: () => boolean;
  readonly banner: { show(view: MaintenanceBannerView): void; hide(): void };
  /** Takes the player to the sign-in screen, the session put aside. */
  readonly signOut: () => void;
  /** A clock that only goes forward (ms). */
  readonly now?: () => number;
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

/** The sign-in route: its refusals are the sign-in screens' to show, not a sign-out. */
const SIGN_IN_ROUTE = "/player/getinfo";

export class MaintenanceWatch {
  private notice: MaintenanceNotice | null = null;
  /** When the cut-off comes, on {@link now}'s clock. */
  private deadline = 0;
  private wasSignedIn = false;
  private lastPoll = -Infinity;
  private polling = false;
  private stops: (() => void)[] = [];
  private ticker: unknown = null;
  private readonly now: () => number;

  constructor(private readonly deps: MaintenanceWatchDeps) {
    this.now = deps.now ?? (() => performance.now());
  }

  start(): void {
    this.stops.push(
      this.deps.chat.onMaintenance((raw) => {
        const notice = readMaintenanceNotice(raw);
        if (notice) this.heard(notice);
      }),
      this.deps.onRefusal((error) => this.refused(error)),
    );
    const set = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    this.ticker = set(() => this.tick(), TICK_MS);
  }

  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
    const clear = this.deps.clearInterval ?? ((handle: unknown) => clearInterval(handle as number));
    if (this.ticker !== null) clear(this.ticker);
    this.ticker = null;
  }

  /** News from the server, by chat or by asking. */
  heard(notice: MaintenanceNotice): void {
    if (!this.deps.signedIn()) return;
    if (!notice.on) {
      this.notice = null;
      this.deps.banner.hide();
      return;
    }
    this.notice = notice;
    this.deadline = this.now() + notice.remainingMs;
    this.tick();
  }

  /** Every {@link TICK_MS}: the clock, the cut-off, and asking when chat is down. */
  tick(): void {
    const signedIn = this.deps.signedIn();
    if (!signedIn) {
      this.wasSignedIn = false;
      if (this.notice) {
        this.notice = null;
        this.deps.banner.hide();
      }
      return;
    }
    const now = this.now();
    // Just signed in (the owner during maintenance, or anyone): ask once.
    if (!this.wasSignedIn) {
      this.wasSignedIn = true;
      void this.poll();
    } else if (!this.deps.chat.online && now - this.lastPoll >= POLL_MS) {
      void this.poll();
    }

    const notice = this.notice;
    if (!notice) return;
    const remainingMs = Math.max(0, this.deadline - now);
    if (remainingMs <= 0 && !notice.exempt) {
      this.cut({ message: notice.message, backAt: notice.backAt });
      return;
    }
    this.deps.banner.show({ message: notice.message, backAt: notice.backAt, remainingMs, exempt: notice.exempt });
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    this.lastPoll = this.now();
    try {
      const notice = await this.deps.fetch();
      if (notice) this.heard(notice);
    } catch {
      // Out of reach: the next poll, chat, or the next refusal will tell.
    } finally {
      this.polling = false;
    }
  }

  private refused(error: ApiError): void {
    const refusal = maintenanceRefusal(error);
    if (!refusal) return;
    // A refused sign-in is shown by the sign-in screen itself.
    if ((error.url ?? "").includes(SIGN_IN_ROUTE) || !this.deps.signedIn()) {
      // A request still on its way out (an attack's last save) keeps the
      // card's "Signed out" from the countdown that just ended.
      setMaintenanceBlock(maintenanceBlock()?.signedOut ? { ...refusal, signedOut: true } : refusal);
      return;
    }
    this.cut(refusal);
  }

  /** Signs the player out for maintenance, the message kept for the sign-in screen. */
  private cut(refusal: MaintenanceRefusal): void {
    this.notice = null;
    this.deps.banner.hide();
    setMaintenanceBlock({ ...refusal, signedOut: true });
    this.wasSignedIn = false;
    this.deps.signOut();
  }
}
