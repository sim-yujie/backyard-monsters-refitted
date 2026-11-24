import type { EntityManager } from "@mikro-orm/postgresql";

import { logger } from "../../utils/logger.js";
import type { WatchKind, WatchWord } from "./chatFilter.js";

/**
 * The chat filter's watched words (owner, 24 Nov 2026): kept in
 * `bym.chat_watch_word` (migration `20261207_AddChatFilter.ts`), edited on
 * the dashboard's Chat filter tab, read by the chat server every minute and
 * at once when the dashboard changes them (`chat/chatWatchWords.ts`). Each
 * hit is counted per word and day in Redis ({@link countHits}), so the tab
 * shows how often each word came up in the last seven days. Counting is
 * never capped (only flags are).
 */

export interface WatchWordRow extends WatchWord {
  readonly id: number;
}

const KINDS: readonly WatchKind[] = ["always", "near", "context"];

/** The longest word or phrase the list takes. */
export const MAX_WATCH_WORD = 40;

/** Every watched word, oldest first. */
export const readWatchWords = async (em: EntityManager): Promise<WatchWordRow[]> => {
  const rows = await em.execute<{ id: number | string; word: string; kind: string }[]>(
    `SELECT id, word, kind FROM bym.chat_watch_word ORDER BY id`,
  );
  return rows
    .filter((row): row is typeof row & { kind: WatchKind } => KINDS.includes(row.kind as WatchKind))
    .map((row) => ({ id: Number(row.id), word: row.word, kind: row.kind }));
};

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Reads the add box: `{ word, kind }`. Words are kept lower case with single
 * spaces; only "always" words may be phrases, since "near" and "context"
 * words are matched one word against the next.
 */
export const parseWatchWord = (raw: unknown): Parsed<WatchWord> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = body.kind as WatchKind;
  if (!KINDS.includes(kind)) return { ok: false, message: "Pick where the word goes." };
  const word = (typeof body.word === "string" ? body.word : "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!word) return { ok: false, message: "Type a word or phrase." };
  if (word.length > MAX_WATCH_WORD) return { ok: false, message: `Keep it to ${MAX_WATCH_WORD} characters.` };
  if (!/[\p{L}\p{N}]/u.test(word)) return { ok: false, message: "Use at least one letter or number." };
  if (kind !== "always" && !/^[\p{L}\p{N}]+$/u.test(word)) {
    return { ok: false, message: "Only one word here, letters and numbers only." };
  }
  return { ok: true, value: { word, kind } };
};

export type AddOutcome = { outcome: "added"; row: WatchWordRow } | { outcome: "already" };

export const addWatchWord = async (em: EntityManager, word: WatchWord, by: number): Promise<AddOutcome> => {
  const [row] = await em.execute<{ id: number | string }[]>(
    `INSERT INTO bym.chat_watch_word (word, kind, added_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
    [word.word, word.kind, by],
  );
  if (!row) return { outcome: "already" };
  logger.info(`Dashboard: watched word "${word.word}" (${word.kind}) added by ${by}`);
  return { outcome: "added", row: { id: Number(row.id), ...word } };
};

/** Removes one word; false when it was not there. */
export const removeWatchWord = async (em: EntityManager, id: number, by: number): Promise<boolean> => {
  const rows = await em.execute<{ word: string; kind: string }[]>(
    `DELETE FROM bym.chat_watch_word WHERE id = ? RETURNING word, kind`,
    [id],
  );
  const [gone] = rows;
  if (!gone) return false;
  logger.info(`Dashboard: watched word "${gone.word}" (${gone.kind}) removed by ${by}`);
  return true;
};

// ------------------------------------------------------------- hit counts

/** The Redis commands the counts need (Bun's `RedisClient` has `send`). */
export interface CommandRedis {
  send(command: string, args: string[]): Promise<unknown>;
}

/** How many days the tab adds up. */
export const HIT_DAYS = 7;

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** One day's counts: `chat-filter-hits:2026-11-24`, a hash of word → hits. */
export const hitsKey = (ms: number): string => `chat-filter-hits:${dayOf(ms)}`;

/** Counts one line's watched words (each once). Never throws. */
export const countHits = async (redis: CommandRedis, words: readonly string[], now: number): Promise<void> => {
  if (words.length === 0) return;
  const key = hitsKey(now);
  try {
    for (const word of new Set(words)) await redis.send("HINCRBY", [key, word, "1"]);
    await redis.send("EXPIRE", [key, String((HIT_DAYS + 1) * 86_400)]);
  } catch (err) {
    logger.warn(`Chat filter: hit count not saved: ${err}`);
  }
};

/** Each word's hits over the last {@link HIT_DAYS} days, today included. */
export const readHits = async (redis: CommandRedis, now: number): Promise<Record<string, number>> => {
  const totals: Record<string, number> = {};
  for (let day = 0; day < HIT_DAYS; day += 1) {
    const flat = (await redis.send("HGETALL", [hitsKey(now - day * 86_400_000)])) as string[] | Record<string, string> | null;
    const pairs: [string, string][] = Array.isArray(flat)
      ? flat.flatMap((value, at) => (at % 2 === 0 ? [[value, flat[at + 1] ?? "0"] as [string, string]] : []))
      : Object.entries(flat ?? {});
    for (const [word, hits] of pairs) totals[word] = (totals[word] ?? 0) + (Number(hits) || 0);
  }
  return totals;
};
