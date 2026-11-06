import { Assets, type Texture } from "pixi.js";
import { isHighResolutionSheet } from "./monsterSprites";

/**
 * Fetching monster sheets, and the queue a raid's sheets wait in (patch 6.4,
 * round 2).
 *
 * On Fast 3G a Trojan Horse fight asked for twenty sheets at once: every
 * small stand-in (1x) and every full painting (`@4x`, ten times the bytes).
 * They all shared the line, so the stand-ins of the later monsters (Brain,
 * Crabatron, Project X) came a minute in, after those monsters had fought as
 * green squares; and on the dev server (HTTP/1.1, six connections a host) the
 * raid's finish waited ~38 s for a connection behind the paintings.
 *
 * The queue fixes the order and the number in flight:
 * - every stand-in (and any other small copy) first, in the order asked,
 *   which is the order the monsters come on, up to {@link SheetQueueOptions.maxActive}
 *   at a time;
 * - the full paintings only once no stand-in is waiting or coming, at most
 *   {@link SheetQueueOptions.maxFull} at a time, in the order asked;
 * - never more than `maxActive` sheets in flight, so the game's own requests
 *   (the finish, saves) always find a free connection;
 * - {@link SheetQueue.hold} starts nothing new while the raid is landed, and
 *   {@link SheetQueue.dropWaiting} forgets what has not started once the
 *   fight is gone, so a finished raid does not keep downloading paintings
 *   nobody will see.
 * A sheet Pixi already holds is handed straight over, never queued.
 */

/** What a caller wants a sheet for: `standIn` for a small copy drawn until the full one is in. */
export interface SheetWant {
  readonly standIn?: boolean;
}

/** Fetches one sheet; `Assets.load` in the client, something else in a test. */
export type SheetLoader = (url: string, want?: SheetWant) => Promise<Texture>;

/**
 * `Assets.load`, with mipmaps for a high-resolution sheet: a 4x repaint is
 * drawn at a quarter of its size or less at the usual zoom, and without them
 * it shimmers.
 */
export const loadSheet: SheetLoader = (url) =>
  Assets.load<Texture>(
    isHighResolutionSheet(url) ? { src: url, data: { autoGenerateMipmaps: true } } : url,
  );

/** Which line a sheet waits in. */
export type SheetLine = "small" | "full";

/** Thrown into a sheet's promise when it was dropped before it started. */
export class SheetDropped extends Error {
  constructor(readonly url: string) {
    super(`Sheet ${url} was dropped before it was fetched.`);
    this.name = "SheetDropped";
  }
}

export interface SheetQueueOptions {
  /** The real fetch. */
  readonly load?: SheetLoader;
  /** Whether the fetch would answer at once (Pixi's cache already has it). */
  readonly isCached?: (url: string) => boolean;
  /** Sheets in flight at once, of both lines; 3 by default (of a browser's 6 per host). */
  readonly maxActive?: number;
  /** Full paintings in flight at once; 2 by default. */
  readonly maxFull?: number;
}

interface Entry {
  readonly url: string;
  line: SheetLine;
  started: boolean;
  readonly promise: Promise<Texture>;
  readonly resolve: (texture: Texture) => void;
  readonly reject: (reason: unknown) => void;
}

/** The line a sheet belongs in: a stand-in, or any copy that is not a big painting, goes first. */
export const sheetLineOf = (url: string, want?: SheetWant): SheetLine =>
  want?.standIn || !isHighResolutionSheet(url) ? "small" : "full";

export class SheetQueue {
  private readonly fetch: SheetLoader;
  private readonly isCached: (url: string) => boolean;
  private readonly maxActive: number;
  private readonly maxFull: number;
  /** Every sheet waiting or in flight, by URL: one fetch each. */
  private readonly entries = new Map<string, Entry>();
  private readonly waiting: Record<SheetLine, Entry[]> = { small: [], full: [] };
  private readonly active: Record<SheetLine, number> = { small: 0, full: 0 };
  private holds = 0;

  constructor(options: SheetQueueOptions = {}) {
    this.fetch = options.load ?? loadSheet;
    this.isCached = options.isCached ?? (() => false);
    this.maxActive = Math.max(1, options.maxActive ?? 3);
    this.maxFull = Math.max(1, Math.min(this.maxActive, options.maxFull ?? 2));
  }

  /** The queue as a {@link SheetLoader}, for `MonsterSheetTextures`. */
  readonly loader: SheetLoader = (url, want) => this.load(url, want);

  /** Asks for a sheet; the same URL asked twice is fetched once. */
  load(url: string, want?: SheetWant): Promise<Texture> {
    const line = sheetLineOf(url, want);
    const known = this.entries.get(url);
    if (known) {
      // Wanted as a stand-in after all: it moves to the front line.
      if (!known.started && known.line === "full" && line === "small") {
        this.waiting.full.splice(this.waiting.full.indexOf(known), 1);
        known.line = "small";
        this.waiting.small.push(known);
        this.pump();
      }
      return known.promise;
    }
    if (this.isCached(url)) return this.fetch(url, want);

    let resolve!: (texture: Texture) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<Texture>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const entry: Entry = { url, line, started: false, promise, resolve, reject };
    this.entries.set(url, entry);
    this.waiting[line].push(entry);
    this.pump();
    return promise;
  }

  /** Starts nothing new until the returned release is called (each hold its own release). */
  hold(): () => void {
    this.holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      this.pump();
    };
  }

  /** Forgets every sheet not yet started (rejecting it with {@link SheetDropped}); returns how many. */
  dropWaiting(): number {
    const dropped = [...this.waiting.small, ...this.waiting.full];
    this.waiting.small.length = 0;
    this.waiting.full.length = 0;
    for (const entry of dropped) {
      this.entries.delete(entry.url);
      entry.reject(new SheetDropped(entry.url));
    }
    return dropped.length;
  }

  /** The URLs in flight, then those waiting, by line: for tests and debugging. */
  snapshot(): {
    active: Record<SheetLine, number>;
    waiting: Record<SheetLine, string[]>;
    held: boolean;
  } {
    return {
      active: { ...this.active },
      waiting: {
        small: this.waiting.small.map((e) => e.url),
        full: this.waiting.full.map((e) => e.url),
      },
      held: this.holds > 0,
    };
  }

  private pump(): void {
    while (this.holds === 0) {
      const inFlight = this.active.small + this.active.full;
      if (inFlight >= this.maxActive) return;
      const small = this.waiting.small.shift();
      if (small) {
        this.start(small);
        continue;
      }
      // The paintings only once every small copy is in (or failed).
      if (this.active.small > 0 || this.active.full >= this.maxFull) return;
      const full = this.waiting.full.shift();
      if (!full) return;
      this.start(full);
    }
  }

  private start(entry: Entry): void {
    entry.started = true;
    const line = entry.line;
    this.active[line] += 1;
    let fetching: Promise<Texture>;
    try {
      fetching = this.fetch(entry.url, line === "small" ? { standIn: true } : undefined);
    } catch (caught) {
      fetching = Promise.reject(caught);
    }
    fetching.then(entry.resolve, entry.reject).finally(() => {
      this.active[line] -= 1;
      this.entries.delete(entry.url);
      this.pump();
    });
  }
}

/**
 * The one queue every raid's sheets go through: the warning's warm-up
 * (`raidSheets.ts`), the Trojan Horse's (on the yard and at its letter), and
 * the raid scene's battle layer, so they share one order and one limit.
 */
export const raidSheetQueue = new SheetQueue({ isCached: (url) => Assets.cache.has(url) });
