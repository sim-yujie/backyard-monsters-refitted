/**
 * For tests: the part of Bun's `RedisClient` the presence and bot-check code
 * uses (#271, #273), in memory. Strings, lists, sets (`sadd`, `srem`,
 * `scard`, `smembers`, for the chat mute list) and hashes (the last through
 * `send("HINCRBY" | "HGET" | "HSET")`, which the typed client lacks, and
 * `send("EXPIRE")` for a hash's life), with key lives
 * read off `Date.now()`, so `setSystemTime` ages them. Anything else fails
 * loudly rather than answering by accident.
 *
 * `strings` may be a map the test already holds, so it can read or clear the
 * plain keys itself. `ages: false` keeps every key for ever, for a test that
 * reads a stored time past its key's life.
 */
export const memoryRedis = (strings: Map<string, string> = new Map(), { ages = true }: { ages?: boolean } = {}) => {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  /** When each key dies, epoch milliseconds; absent while it lives for ever. */
  const expiry = new Map<string, number>();

  const drop = (key: string): boolean => {
    const had = strings.delete(key) || lists.delete(key) || hashes.delete(key) || sets.delete(key);
    expiry.delete(key);
    return had;
  };
  /** Forgets a key whose life is over. */
  const age = (key: string): void => {
    const at = expiry.get(key);
    if (ages && at !== undefined && at <= Date.now()) drop(key);
  };
  const exists = (key: string): boolean => {
    age(key);
    return strings.has(key) || lists.has(key) || hashes.has(key) || sets.has(key);
  };
  const setString = (key: string, value: string, ttlSeconds?: number): void => {
    drop(key);
    strings.set(key, value);
    if (ttlSeconds !== undefined) expiry.set(key, Date.now() + ttlSeconds * 1000);
  };

  return {
    get: async (key: string): Promise<string | null> => {
      age(key);
      return strings.get(key) ?? null;
    },
    mget: async (...keys: string[]): Promise<(string | null)[]> =>
      keys.map((key) => {
        age(key);
        return strings.get(key) ?? null;
      }),
    set: async (key: string, value: string, ...options: (string | number)[]): Promise<"OK" | null> => {
      const flags = options.map((option) => String(option).toUpperCase());
      const ex = flags.indexOf("EX");
      // NX writes only a missing key, XX only an existing one; either answers null when it skips.
      if (flags.includes("NX") && exists(key)) return null;
      if (flags.includes("XX") && !exists(key)) return null;
      setString(key, value, ex >= 0 ? Number(options[ex + 1]) : undefined);
      return "OK";
    },
    setex: async (key: string, ttlSeconds: number, value: string): Promise<"OK"> => {
      setString(key, value, ttlSeconds);
      return "OK";
    },
    getdel: async (key: string): Promise<string | null> => {
      age(key);
      const value = strings.get(key) ?? null;
      if (value !== null) drop(key);
      return value;
    },
    del: async (...keys: string[]): Promise<number> => keys.filter((key) => exists(key) && drop(key)).length,
    incr: async (key: string): Promise<number> => {
      age(key);
      const next = Number(strings.get(key) ?? "0") + 1;
      strings.set(key, String(next));
      return next;
    },
    expire: async (key: string, seconds: number): Promise<number> => {
      if (!exists(key)) return 0;
      expiry.set(key, Date.now() + seconds * 1000);
      return 1;
    },
    ttl: async (key: string): Promise<number> => {
      if (!exists(key)) return -2;
      const at = expiry.get(key);
      return at === undefined ? -1 : Math.ceil((at - Date.now()) / 1000);
    },
    lpush: async (key: string, ...values: string[]): Promise<number> => {
      age(key);
      const list = lists.get(key) ?? [];
      for (const value of values) list.unshift(value);
      lists.set(key, list);
      return list.length;
    },
    ltrim: async (key: string, start: number, stop: number): Promise<string> => {
      age(key);
      const list = lists.get(key);
      if (list) lists.set(key, list.slice(start, stop < 0 ? list.length + stop + 1 : stop + 1));
      return "OK";
    },
    lrange: async (key: string, start: number, stop: number): Promise<string[]> => {
      age(key);
      const list = lists.get(key) ?? [];
      return list.slice(start, stop < 0 ? list.length + stop + 1 : stop + 1);
    },
    sadd: async (key: string, ...members: string[]): Promise<number> => {
      age(key);
      const set = sets.get(key) ?? new Set<string>();
      const before = set.size;
      for (const member of members) set.add(member);
      sets.set(key, set);
      return set.size - before;
    },
    srem: async (key: string, ...members: string[]): Promise<number> => {
      age(key);
      const set = sets.get(key);
      if (!set) return 0;
      const removed = members.filter((member) => set.delete(member)).length;
      if (set.size === 0) drop(key);
      return removed;
    },
    scard: async (key: string): Promise<number> => {
      age(key);
      return sets.get(key)?.size ?? 0;
    },
    smembers: async (key: string): Promise<string[]> => {
      age(key);
      return [...(sets.get(key) ?? [])];
    },
    send: async (command: string, args: string[]): Promise<unknown> => {
      const [key = "", field = "", by = "0"] = args;
      age(key);
      switch (command.toUpperCase()) {
        case "HINCRBY": {
          const hash = hashes.get(key) ?? new Map<string, string>();
          const next = Number(hash.get(field) ?? "0") + Number(by);
          hash.set(field, String(next));
          hashes.set(key, hash);
          return next;
        }
        case "HGET":
          return hashes.get(key)?.get(field) ?? null;
        case "HSET": {
          const hash = hashes.get(key) ?? new Map<string, string>();
          const pairs = args.slice(1);
          let added = 0;
          for (let i = 0; i + 1 < pairs.length; i += 2) {
            if (!hash.has(pairs[i]!)) added++;
            hash.set(pairs[i]!, pairs[i + 1]!);
          }
          hashes.set(key, hash);
          return added;
        }
        case "EXPIRE":
          if (!exists(key)) return 0;
          expiry.set(key, Date.now() + Number(field) * 1000);
          return 1;
        default:
          throw new Error(`memoryRedis: ${command} is not supported`);
      }
    },
    /** For tests: every key, of every kind, gone. */
    clear: (): void => {
      strings.clear();
      lists.clear();
      hashes.clear();
      sets.clear();
      expiry.clear();
    },
  };
};

export type MemoryRedis = ReturnType<typeof memoryRedis>;
