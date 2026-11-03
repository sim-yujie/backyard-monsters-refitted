import type { EntityManager } from "@mikro-orm/postgresql";

import type { FlagSeverity } from "./chatFlags.js";

/**
 * The full chat log (owner, 4 Nov 2026: "Cant we have a backup of world
 * chat?"): every World and country room line goes into `bym.chat_log`, the
 * player's own words and the masked copy players saw, for the dashboard.
 * Players' chat is unchanged: Redis still keeps only the last 100 lines per
 * room (`chat/chatHistory.ts`). The daily clean-up deletes lines older than
 * `CHAT_LOG_RETENTION_DAYS` (`config/RetentionConfig.ts`).
 *
 * Lines are written in batches by {@link ChatLogWriter}, never while chat
 * waits: a line is queued and the message goes out at once. A batch that
 * fails to save is logged and dropped; chat carries on.
 */

export interface ChatLogLine {
  userid: number;
  channel: string;
  /** The player's own words. */
  message: string;
  /** What other players saw. */
  shown: string;
  /** The line's flag, or null. */
  flagged: FlagSeverity | null;
  at: Date;
}

/** How long a queued line waits before its batch is saved. */
export const CHAT_LOG_FLUSH_MS = 2000;

/** Lines per INSERT; a full batch is saved at once. */
export const CHAT_LOG_BATCH = 200;

/** Lines held while the database is slow or down; newer lines past this are dropped. */
export const CHAT_LOG_MAX_QUEUE = 5000;

/**
 * Saves a batch of lines in one statement.
 *
 * @param {EntityManager} em - Any entity manager; raw SQL, flushes nothing.
 * @param {readonly ChatLogLine[]} lines - The lines, oldest first.
 */
export const insertChatLogLines = async (em: EntityManager, lines: readonly ChatLogLine[]): Promise<void> => {
  if (lines.length === 0) return;
  const values = lines.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
  const params = lines.flatMap((line) => [line.userid, line.channel, line.message, line.shown, line.flagged, line.at]);
  await em.execute(
    `INSERT INTO bym.chat_log (userid, channel, message, shown, flagged, created_at) VALUES ${values}`,
    params,
  );
};

export interface ChatLogWriterOptions {
  flushMs?: number;
  batch?: number;
  maxQueue?: number;
}

/**
 * Queues lines and saves them in batches, one batch at a time. `add` never
 * throws and never waits; a failed save is passed to `warn` and its lines
 * are dropped.
 */
export class ChatLogWriter {
  private queue: ChatLogLine[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<number> = Promise.resolve(0);
  private dropping = false;
  private readonly flushMs: number;
  private readonly batch: number;
  private readonly maxQueue: number;

  constructor(
    private readonly insert: (lines: readonly ChatLogLine[]) => Promise<unknown>,
    private readonly warn: (message: string) => void,
    options: ChatLogWriterOptions = {},
  ) {
    this.flushMs = options.flushMs ?? CHAT_LOG_FLUSH_MS;
    this.batch = options.batch ?? CHAT_LOG_BATCH;
    this.maxQueue = options.maxQueue ?? CHAT_LOG_MAX_QUEUE;
  }

  /** Lines waiting to be saved. */
  get queued(): number {
    return this.queue.length;
  }

  /** Queues a line; a full batch starts saving now, otherwise within `flushMs`. */
  add(line: ChatLogLine): void {
    try {
      if (this.queue.length >= this.maxQueue) {
        if (!this.dropping) this.warn(`Chat log queue full (${this.maxQueue} lines); dropping new lines until it drains`);
        this.dropping = true;
        return;
      }
      this.dropping = false;
      this.queue.push(line);
      if (this.queue.length >= this.batch) {
        void this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => void this.flush(), this.flushMs);
        (this.timer as { unref?: () => void }).unref?.();
      }
    } catch (err) {
      this.warn(`Chat log line not queued: ${err}`);
    }
  }

  /** Saves everything queued; resolves with how many lines were saved. */
  flush(): Promise<number> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.saving = this.saving.then(() => this.drain());
    return this.saving;
  }

  private async drain(): Promise<number> {
    let saved = 0;
    while (this.queue.length > 0) {
      const lines = this.queue.splice(0, this.batch);
      try {
        await this.insert(lines);
        saved += lines.length;
      } catch (err) {
        this.warn(`Chat log: ${lines.length} lines not saved: ${err}`);
      }
    }
    return saved;
  }
}
