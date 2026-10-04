/**
 * For tests: the part of Bun's `RedisClient` the presence and bot-check code
 * uses (#271, #273), in memory. Strings, lists and hashes (the last through
 * `send("HINCRBY" | "HGET")`, which the typed client lacks), with key lives
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
  /** When each key dies, epoch milliseconds; absent while it lives for ever. */
  const expiry = new Map<string, number>();

  const drop = (key: string): boolean => {
    const had = strings.delete(key) || lists.delete(key) || hashes.delete(key);
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
    return strings.has(key) || lists.has(key) || hashes.has(key);
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
    set: async (key: string, value: string, ...options: (string | number)[]): Promise<"OK"> => {
      const ex = options.findIndex((option) => String(option).toUpperCase() === "EX");
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
        default:
          throw new Error(`memoryRedis: ${command} is not supported`);
      }
    },
    /** For tests: every key, of every kind, gone. */
    clear: (): void => {
      strings.clear();
      lists.clear();
      hashes.clear();
      expiry.clear();
    },
  };
};

export type MemoryRedis = ReturnType<typeof memoryRedis>;
