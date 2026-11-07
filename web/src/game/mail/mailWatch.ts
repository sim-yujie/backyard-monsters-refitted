import type { LatestMail, MailStatus } from "@/api/mail";

/**
 * Live mail (owner, beta 7: "new inbox message should give a notification /
 * alert in game rather than wait for refresh").
 *
 * The game learns of new mail two ways:
 * - pushed: the world chat connection says "mail" (server
 *   `services/mail/mailNudge.ts`) and the game asks `/player/mailstatus` a
 *   moment later, once the message has surely landed;
 * - asked: with no chat connection (World chat switched off, or down), every
 *   {@link POLL_MS} while the tab is shown, never while it is hidden. A tab
 *   shown again after a while asks at once.
 *
 * Each answer gives the Mail button its count, and the newest unread message
 * pops up once ({@link mailAlert}): never one that was already unread when
 * the game first asked, never an older one that comes to the top after the
 * newer was read, never the same one twice. What was shown is remembered for
 * the whole visit, so going from the yard to the map neither shows it again
 * nor misses one.
 */

/** How often the game asks without a chat connection: 45 s, inside the owner's 30 to 60. */
export const POLL_MS = 45_000;
/** How long after the chat's "mail" the game asks, so the server has finished writing. */
export const NUDGE_DELAY_MS = 800;

/** What has popped up so far. */
export interface AlertMemory {
  /** The first answer only sets the starting point: mail already waiting does not pop up. */
  primed: boolean;
  /** Messages already shown (or already waiting at the start). */
  readonly seen: Set<string>;
  /** The newest message time seen, unix seconds: anything older does not pop up. */
  seenTime: number;
}

export const newAlertMemory = (): AlertMemory => ({ primed: false, seen: new Set(), seenTime: 0 });

/** The memory for the whole visit, shared by every screen's Mail button. */
export const visitMemory: AlertMemory = newAlertMemory();

/**
 * The message to pop up for this answer, or null; `memory` is brought up to
 * date either way.
 */
export const mailAlert = (memory: AlertMemory, status: MailStatus): LatestMail | null => {
  const latest = status.latest;
  if (!memory.primed) {
    memory.primed = true;
    if (latest) {
      memory.seen.add(latest.id);
      memory.seenTime = Math.max(memory.seenTime, latest.time);
    }
    return null;
  }
  if (!latest || memory.seen.has(latest.id)) return null;
  memory.seen.add(latest.id);
  if (latest.time < memory.seenTime) return null;
  memory.seenTime = latest.time;
  return latest;
};

/** The world chat as the watch needs it (`game/chat/chatSession.ts`'s `worldChat`). */
export interface MailChat {
  readonly online: boolean;
  onMail(listener: () => void): () => void;
}

/** The page's visibility, for a test to set. */
export interface PageVisibility {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface MailWatchOptions {
  readonly status: () => Promise<MailStatus>;
  readonly chat: MailChat;
  /** Every answer: the count for the badge, and the message to pop up, if any. */
  readonly onStatus: (status: MailStatus, alert: LatestMail | null) => void;
  readonly memory?: AlertMemory;
  readonly page?: PageVisibility;
  readonly pollMs?: number;
  readonly nudgeDelayMs?: number;
  /** Milliseconds; `Date.now` unless a test sets it. */
  readonly now?: () => number;
}

export class MailWatch {
  private readonly options: MailWatchOptions;
  private readonly memory: AlertMemory;
  private readonly page: PageVisibility | null;
  private readonly pollMs: number;
  private readonly now: () => number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private stopChat: (() => void) | null = null;
  private asking = false;
  /** A nudge came while asking: ask again after, as the answer may predate it. */
  private askAgain = false;
  /** A nudge came while the tab was hidden: ask once it is shown. */
  private dueOnShow = false;
  private lastAsked = 0;
  private running = false;

  constructor(options: MailWatchOptions) {
    this.options = options;
    this.memory = options.memory ?? visitMemory;
    this.page = options.page ?? (typeof document === "undefined" ? null : document);
    this.pollMs = options.pollMs ?? POLL_MS;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopChat = this.options.chat.onMail(() => this.nudged());
    this.page?.addEventListener("visibilitychange", this.shown);
    this.pollTimer = setInterval(() => this.tick(), this.pollMs);
    void this.check();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stopChat?.();
    this.stopChat = null;
    this.page?.removeEventListener("visibilitychange", this.shown);
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
    this.askAgain = false;
    this.pollTimer = null;
    this.nudgeTimer = null;
  }

  /** Asks now (a scene's own reason, or a test). */
  async check(): Promise<void> {
    if (!this.running) return;
    if (this.asking) {
      this.askAgain = true;
      return;
    }
    this.asking = true;
    this.lastAsked = this.now();
    this.dueOnShow = false;
    try {
      const status = await this.options.status();
      if (!this.running) return;
      this.options.onStatus(status, mailAlert(this.memory, status));
    } catch {
      // Off line or signed out for a moment: the next nudge or tick asks again.
    } finally {
      this.asking = false;
    }
    if (this.askAgain) {
      this.askAgain = false;
      await this.check();
    }
  }

  private get hidden(): boolean {
    return this.page?.hidden ?? false;
  }

  private tick(): void {
    if (this.hidden || this.options.chat.online) return;
    void this.check();
  }

  private nudged(): void {
    if (this.hidden) {
      this.dueOnShow = true;
      return;
    }
    if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      void this.check();
    }, this.options.nudgeDelayMs ?? NUDGE_DELAY_MS);
  }

  private readonly shown = (): void => {
    if (this.hidden) return;
    const overdue = !this.options.chat.online && this.now() - this.lastAsked >= this.pollMs;
    if (this.dueOnShow || overdue) void this.check();
  };
}
