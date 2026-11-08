import { describe, expect, it } from "vitest";
import type { Texture } from "pixi.js";
import { SheetDropped, SheetQueue, sheetLineOf, type SheetWant } from "./sheetQueue";

/**
 * Patch 6.4, round 2: a raid's sheets wait in one queue, every stand-in
 * before any painting, at most three in flight (two paintings), so the
 * stand-ins are never starved and the fight's finish always has a free
 * connection.
 */

const TEXTURE = {} as Texture;

/** A loader whose fetches finish only when the test says. */
const manualLoader = () => {
  const started: string[] = [];
  const open = new Map<
    string,
    { resolve: (t: Texture) => void; reject: (e: unknown) => void }
  >();
  let peak = 0;
  const load = (url: string): Promise<Texture> => {
    started.push(url);
    const promise = new Promise<Texture>((resolve, reject) =>
      open.set(url, { resolve, reject }),
    );
    peak = Math.max(peak, open.size);
    return promise;
  };
  const finish = async (url: string): Promise<void> => {
    const fetch = open.get(url);
    if (!fetch) throw new Error(`${url} is not in flight`);
    open.delete(url);
    fetch.resolve(TEXTURE);
    await flush();
  };
  return { load, started, open, finish, peak: () => peak };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const small = (name: string): string => `/assets/monsters/${name}-anim.png`;
const full = (name: string): string => `/assets/monsters/${name}-anim@4x.png?v=2`;

/** The Trojan Horse's kinds in the order they first come out (`TROJAN_ROSTER`). */
const TROJAN = [
  "pokey",
  "octo",
  "bolt",
  "fink",
  "ichi",
  "bandito",
  "fang",
  "brain",
  "crabatron",
  "projectx",
];

/** As the battle layer asks: each kind's stand-in, then its painting, kind by kind. */
const askLikeTheLayer = (queue: SheetQueue): Promise<Texture>[] =>
  TROJAN.flatMap((name) => [
    queue.load(small(name), { standIn: true }),
    queue.load(full(name)),
  ]);

describe("sheetLineOf", () => {
  it("puts stand-ins and plain copies first, big paintings after", () => {
    expect(sheetLineOf(small("pokey"), { standIn: true })).toBe("small");
    expect(sheetLineOf(small("pokey"))).toBe("small");
    expect(sheetLineOf("/assets/monsters/fink.png")).toBe("small");
    expect(sheetLineOf(full("pokey"))).toBe("full");
    expect(sheetLineOf("/assets/monsters/pokey-anim@2x.png")).toBe("full");
  });
});

describe("SheetQueue", () => {
  it("fetches every stand-in, in the order asked, before any painting", async () => {
    const loader = manualLoader();
    const queue = new SheetQueue({ load: loader.load });
    for (const promise of askLikeTheLayer(queue)) promise.catch(() => {});

    expect(loader.started).toEqual(TROJAN.slice(0, 3).map(small));
    // Each finished stand-in lets the next one go; no painting while any is coming.
    for (const name of TROJAN) await loader.finish(small(name));
    expect(loader.started.slice(0, TROJAN.length)).toEqual(TROJAN.map(small));
    // Then the paintings, two at a time, in the order asked.
    expect(loader.started.slice(TROJAN.length)).toEqual([full("pokey"), full("octo")]);
    await loader.finish(full("octo"));
    expect(loader.started.slice(TROJAN.length)).toEqual([
      full("pokey"),
      full("octo"),
      full("bolt"),
    ]);
    for (const name of TROJAN.slice(0, 1).concat(TROJAN.slice(2)))
      await loader.finish(full(name));
    expect(loader.started.slice(TROJAN.length)).toEqual(TROJAN.map(full));
    expect(loader.peak()).toBeLessThanOrEqual(3);
  });

  it("never has more than three sheets, or two paintings, in flight", async () => {
    const loader = manualLoader();
    const queue = new SheetQueue({ load: loader.load });
    for (const name of TROJAN) queue.load(full(name)).catch(() => {});
    expect(loader.open.size).toBe(2);
    // A stand-in asked meanwhile still finds a free place at once.
    queue.load(small("brain"), { standIn: true }).catch(() => {});
    expect(loader.open.size).toBe(3);
    expect(loader.started.at(-1)).toBe(small("brain"));
    queue.load(small("crabatron"), { standIn: true }).catch(() => {});
    expect(loader.open.size).toBe(3);
    // It goes next, ahead of the waiting paintings.
    await loader.finish(full("pokey"));
    expect(loader.started.at(-1)).toBe(small("crabatron"));
    expect(queue.snapshot().active).toEqual({ small: 2, full: 1 });
  });

  it("fetches a URL asked twice once, and hands both callers the texture", async () => {
    const loader = manualLoader();
    const queue = new SheetQueue({ load: loader.load });
    const first = queue.load(small("fang"), { standIn: true });
    const second = queue.load(small("fang"), { standIn: true });
    expect(loader.started).toEqual([small("fang")]);
    await loader.finish(small("fang"));
    await expect(first).resolves.toBe(TEXTURE);
    await expect(second).resolves.toBe(TEXTURE);
  });

  it("hands a sheet Pixi already holds straight over, past the queue", () => {
    const asked: Array<[string, SheetWant | undefined]> = [];
    const queue = new SheetQueue({
      load: (url, want) => {
        asked.push([url, want]);
        return new Promise<Texture>(() => {});
      },
      isCached: (url) => url === full("bolt"),
    });
    for (const name of ["pokey", "octo", "fink"]) queue.load(full(name)).catch(() => {});
    queue.load(full("bolt")).catch(() => {});
    expect(asked.map(([url]) => url)).toEqual([full("pokey"), full("octo"), full("bolt")]);
    expect(queue.snapshot().waiting.full).toEqual([full("fink")]);
  });

  it("moves a waiting painting to the front when it is asked for as a stand-in", () => {
    const loader = manualLoader();
    const queue = new SheetQueue({ load: loader.load, maxActive: 1 });
    queue.load(small("pokey"), { standIn: true }).catch(() => {});
    queue.load(full("octo")).catch(() => {});
    queue.load(small("bolt"), { standIn: true }).catch(() => {});
    queue.load(full("octo"), { standIn: true }).catch(() => {});
    expect(queue.snapshot().waiting).toEqual({
      small: [small("bolt"), full("octo")],
      full: [],
    });
  });

  it("frees the place of a fetch that fails, or a loader that throws", async () => {
    const queue = new SheetQueue({
      load: (url) => {
        if (url.includes("bad")) throw new Error("no such sheet");
        return Promise.reject(new Error("offline"));
      },
      maxActive: 1,
    });
    await expect(queue.load(small("bad"))).rejects.toThrow("no such sheet");
    await expect(queue.load(small("pokey"))).rejects.toThrow("offline");
    expect(queue.snapshot().active).toEqual({ small: 0, full: 0 });
  });

  it("starts nothing while held, and forgets what waits when dropped", async () => {
    const loader = manualLoader();
    const queue = new SheetQueue({ load: loader.load });
    const asked = askLikeTheLayer(queue);
    const outcomes = asked.map((promise) =>
      promise.then(
        () => "in",
        (e: unknown) => e,
      ),
    );
    await loader.finish(small("pokey"));
    const startedBefore = loader.started.length;

    const release = queue.hold();
    expect(queue.dropWaiting()).toBe(TROJAN.length * 2 - startedBefore);
    // Finishing what was in flight starts nothing new.
    for (const url of [...loader.open.keys()]) await loader.finish(url);
    expect(loader.started.length).toBe(startedBefore);
    expect(queue.snapshot()).toEqual({
      active: { small: 0, full: 0 },
      waiting: { small: [], full: [] },
      held: true,
    });
    release();
    release();
    expect(queue.snapshot().held).toBe(false);

    const results = await Promise.all(outcomes);
    expect(results.filter((r) => r === "in")).toHaveLength(startedBefore);
    expect(results.filter((r) => r instanceof SheetDropped)).toHaveLength(
      TROJAN.length * 2 - startedBefore,
    );

    // A dropped sheet asked again later is fetched afresh.
    queue.load(full("projectx")).catch(() => {});
    expect(loader.started.at(-1)).toBe(full("projectx"));
  });
});

/**
 * The tester's case (Fast 3G, cache off, a Trojan Horse with no warning), as
 * a model: one line of ~180 KB/s shared evenly by every download in flight,
 * the real file sizes (`server/public/assets/monsters/*-anim*.png`), and the
 * first time each kind comes out of the horse's door (`TROJAN_ROSTER`, one
 * spawn each 20 Flash frames at 24 fps). Everything is asked for at fight
 * start, as the battle layer does: no warm-up on the yard is counted.
 */
const KB = 1024;
const SIZES: Record<string, { small: number; full: number; spawn: number }> = {
  pokey: { small: 69, full: 701, spawn: 0 },
  octo: { small: 186, full: 2029, spawn: 100 / 24 },
  bolt: { small: 136, full: 1435, spawn: 200 / 24 },
  fink: { small: 204, full: 2202, spawn: 300 / 24 },
  ichi: { small: 125, full: 1338, spawn: 520 / 24 },
  bandito: { small: 168, full: 1877, spawn: 600 / 24 },
  fang: { small: 155, full: 1579, spawn: 700 / 24 },
  brain: { small: 168, full: 1704, spawn: 800 / 24 },
  crabatron: { small: 200, full: 2073, spawn: 900 / 24 },
  projectx: { small: 263, full: 2760, spawn: 1000 / 24 },
};
const FAST_3G = 180 * KB;

/**
 * The browser before this fix: every fetch asked at once, in the layer's
 * order, and HTTP/1.1's six connections a host (the dev server) taking them
 * first come, first served.
 */
const sixConnections = (load: (url: string) => Promise<Texture>) => {
  const waiting: string[] = [];
  let open = 0;
  const next = (): void => {
    while (open < 6 && waiting.length > 0) {
      open += 1;
      void load(waiting.shift()!).then(() => {
        open -= 1;
        next();
      });
    }
  };
  return (url: string): void => {
    waiting.push(url);
    next();
  };
};

/** Seconds from fight start until each URL is in, through the queue or (`null`) the old way. */
const simulate = async (
  limits: { maxActive: number; maxFull: number } | null,
): Promise<Map<string, number>> => {
  const bytes = new Map<string, number>();
  for (const [name, size] of Object.entries(SIZES)) {
    bytes.set(small(name), size.small * KB);
    bytes.set(full(name), size.full * KB);
  }
  const flying = new Map<string, { left: number; resolve: (t: Texture) => void }>();
  const load = (url: string): Promise<Texture> =>
    new Promise<Texture>((resolve) => {
      flying.set(url, { left: bytes.get(url)!, resolve });
    });
  if (limits) {
    const queue = new SheetQueue({ load, ...limits });
    for (const promise of askLikeTheLayer(queue)) promise.catch(() => {});
  } else {
    const ask = sixConnections(load);
    for (const name of TROJAN) {
      ask(small(name));
      ask(full(name));
    }
  }
  const done = new Map<string, number>();
  let now = 0;
  while (flying.size > 0) {
    const share = FAST_3G / flying.size;
    const soonest = Math.min(...[...flying.values()].map((f) => f.left));
    now += soonest / share;
    for (const [url, f] of [...flying]) {
      f.left -= soonest;
      if (f.left <= 1e-6) {
        flying.delete(url);
        done.set(url, now);
        f.resolve(TEXTURE);
      }
    }
    await flush();
  }
  return done;
};

describe("SheetQueue on a Trojan Horse fight, Fast 3G model", () => {
  it("has each kind's stand-in in before that kind first comes out (Pokey within a second)", async () => {
    const done = await simulate({ maxActive: 3, maxFull: 2 });
    for (const [name, size] of Object.entries(SIZES)) {
      const at = done.get(small(name))!;
      expect(at, name).toBeLessThan(Math.max(size.spawn, 1.5));
    }
    // Every stand-in is in within the first ~10 s.
    expect(Math.max(...TROJAN.map((name) => done.get(small(name))!))).toBeLessThan(10);
    // And Pokey's painting first, Project X's last.
    expect(done.get(full("pokey"))!).toBeLessThan(done.get(full("projectx"))!);
  });

  it("shows why: all twenty at once, Brain's, Crabatron's and Project X's stand-ins come after they do", async () => {
    const done = await simulate(null);
    for (const name of ["brain", "crabatron", "projectx"]) {
      expect(done.get(small(name))!, name).toBeGreaterThan(SIZES[name]!.spawn);
    }
  });
});
