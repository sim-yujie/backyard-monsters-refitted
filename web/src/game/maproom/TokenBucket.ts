/**
 * A token bucket, used to stay under the server's getarea rate limit.
 *
 * Why a bucket rather than a fixed counter: the server's limiter
 * (koa2-ratelimit, `interval: { min: 1 }`) is a *fixed* window, so a client
 * that counted its own fixed minute could line two windows up badly and send
 * 2x the limit across the boundary. A bucket admits at most
 * `capacity + refillPerSecond * seconds` requests in *any* window of that
 * length, whatever the phase, so choosing the two numbers such that
 * `capacity + refillPerSecond * 60 <= 120` means the server's limit cannot be
 * hit no matter where its window edges fall. See AREA_BURST and
 * AREA_REFILL_PER_SECOND in config.ts for the pair this client uses.
 *
 * The clock is injectable so the behaviour can be tested without waiting.
 */
export interface TokenBucketOptions {
  /** Maximum tokens held, which is the largest burst allowed. */
  capacity: number;
  /** Tokens added per second of wall clock. */
  refillPerSecond: number;
  /** Milliseconds since an arbitrary epoch. Defaults to `Date.now`. */
  now?: () => number;
  /** Tokens present at construction. Defaults to a full bucket. */
  initialTokens?: number;
}

export class TokenBucket {
  readonly capacity: number;
  readonly refillPerSecond: number;

  private readonly now: () => number;
  private available: number;
  private lastRefillMs: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? Date.now;
    this.available = Math.min(options.initialTokens ?? options.capacity, options.capacity);
    this.lastRefillMs = this.now();
  }

  /** Tokens currently available, fractional. */
  get tokens(): number {
    this.refill();
    return this.available;
  }

  /** Takes one token if there is one. Returns false without taking otherwise. */
  take(count = 1): boolean {
    this.refill();
    if (this.available < count) return false;
    this.available -= count;
    return true;
  }

  /** Seconds until `count` tokens exist. 0 when they already do. */
  waitSeconds(count = 1): number {
    this.refill();
    if (this.available >= count) return 0;
    return (count - this.available) / this.refillPerSecond;
  }

  /**
   * Empties the bucket.
   *
   * Used when the server answers 429 anyway: whatever the client believed, the
   * server's own window says no, so the local budget is wrong and the honest
   * response is to start from empty.
   */
  drain(): void {
    this.refill();
    this.available = 0;
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = now - this.lastRefillMs;
    // A clock that jumped backwards would otherwise remove tokens.
    if (elapsedMs <= 0) {
      this.lastRefillMs = now;
      return;
    }
    this.available = Math.min(
      this.capacity,
      this.available + (elapsedMs / 1000) * this.refillPerSecond,
    );
    this.lastRefillMs = now;
  }
}
