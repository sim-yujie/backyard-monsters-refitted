import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Context } from "koa";

import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The in-game check (#273): the patterns that ask for it, the check the
 * server makes and marks, the wait after wrong answers, the player reading as
 * offline while it waits, and the review log.
 *
 * Runs the real middleware, controllers and services over an in-memory Redis
 * whose keys age with the clock, moved by hand.
 */

const redis = memoryRedis();

mock.module("../../server.js", () => ({ postgres: { em: {} }, redis }));

const { realActionTracker } = await import("../../middleware/realAction.js");
const { presence, stayProtected } = await import("../../controllers/maproom/presence.js");
const { botCheck, botCheckAnswer, botCheckForce, devCheckEnabled } = await import(
  "../../controllers/maproom/botCheck.js"
);
const patterns = await import("./botPatterns.js");
const challenge = await import("./botChallenge.js");
const { BOT_CHECK_LOG_KEY, BOT_CHECK_LOG_MAX, BOT_CHECK_LOG_TTL_SECONDS, readBotCheckLog } = await import(
  "./botCheckLog.js"
);
const { ATTACK_ONLINE_SECONDS, CHALLENGE_PENDING_TTL_SECONDS, challengeKey, isPlayerOnline } = await import(
  "./online.js"
);
const { PICTURE_HEIGHT, PICTURE_WIDTH } = await import("./botPicture.js");
const { decodePng } = await import("../../utils/png.js");
const { monsterEntry } = await import("../../game-data/monsterCatalogue.js");

const {
  REGULAR_MIN_GAP_MS,
  REGULAR_RUN_ACTIONS,
  SAME_ROUTE_LIMIT,
  STAY_STREAK_LIMIT,
  regularRun,
} = patterns;
const { COOLDOWN_SECONDS, WRONG_ANSWER_LIMIT, WRONG_ANSWER_WINDOW_SECONDS } = challenge;

const USER = 2505;
const T0 = 1_900_000_000;
/** The clock, milliseconds. */
let clockMs = T0 * 1000;
const atMs = (ms: number) => {
  clockMs = ms;
  setSystemTime(new Date(ms));
};
const after = (ms: number) => atMs(clockMs + ms);
const nowSeconds = () => Math.floor(clockMs / 1000);
const track = realActionTracker();

type Body = Record<string, unknown>;

/** One request through the tracker and a controller; returns the answer's body. */
const call = async (route: string, controller: (ctx: Context) => Promise<void> | void, body: Body = {}) => {
  const ctx = {
    method: "POST",
    _matchedRoute: route,
    request: { body },
    authUser: { userid: USER },
  } as unknown as Context;
  await track(ctx, async () => {
    await controller(ctx);
  });
  return ctx.body as Body;
};

const action = (path: string) =>
  call(`/api/:apiVersion/bm/yard/${path}`, (ctx) => {
    ctx.status = 200;
    ctx.body = { error: 0 };
  });
const ping = () => call("/api/:apiVersion/bm/presence", (ctx) => presence(ctx, async () => {}));
const stay = () => call("/api/:apiVersion/bm/presence/stay", (ctx) => stayProtected(ctx, async () => {}));
const readCheck = () => call("/api/:apiVersion/bm/presence/check", (ctx) => botCheck(ctx, async () => {}));
const answer = (challengeId: string, option: string) =>
  call("/api/:apiVersion/bm/presence/check/answer", (ctx) => botCheckAnswer(ctx, async () => {}), {
    challenge: challengeId,
    option,
  });
const online = () => isPlayerOnline(USER, nowSeconds(), ATTACK_ONLINE_SECONDS);
const pending = async () => (await redis.get(challengeKey(USER))) !== null;

interface Check {
  id: string;
  prompt: string;
  name: string;
  reference: string;
  picture: string;
}
/** The stored check, as only the server sees it. */
const stored = async (): Promise<{ id: string; target: string; count: number; seed: string }> =>
  JSON.parse((await redis.get(`bot-check:challenge:${USER}`))!);
const rightOption = async () => String((await stored()).count);
const aWrongOption = async () => String((await stored()).count + 1);

/** A small deterministic random, so the human-like runs are the same every time. */
const seeded = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

afterEach(() => {
  redis.clear();
  setSystemTime();
  clockMs = T0 * 1000;
});

describe("regularRun", () => {
  const evenly = (count: number, gapMs: number, jitter = () => 0) =>
    Array.from({ length: count }, (_, i) => T0 * 1000 + i * gapMs + jitter());

  test(`fires on ${REGULAR_RUN_ACTIONS} actions with identical gaps of at least two seconds`, () => {
    expect(regularRun(evenly(REGULAR_RUN_ACTIONS, 5_000))).toMatchObject({ meanGapMs: 5_000, cv: 0 });
    expect(regularRun(evenly(REGULAR_RUN_ACTIONS, REGULAR_MIN_GAP_MS))).not.toBeNull();
    // A script acting every nine minutes, just inside the ten-minute protection.
    expect(regularRun(evenly(REGULAR_RUN_ACTIONS, 9 * 60_000))).not.toBeNull();
  });

  test("not on one action fewer", () => {
    expect(regularRun(evenly(REGULAR_RUN_ACTIONS - 1, 5_000))).toBeNull();
  });

  test("not on fast play, however even: gaps under two seconds", () => {
    expect(regularRun(evenly(REGULAR_RUN_ACTIONS, REGULAR_MIN_GAP_MS - 1))).toBeNull();
    const times = evenly(REGULAR_RUN_ACTIONS, 5_000);
    times[times.length - 1] = times[times.length - 2]! + 1_000;
    expect(regularRun(times)).toBeNull();
  });

  test("not on a hand's timing: gaps a few percent apart and more", () => {
    const random = seeded(7);
    // Up to a quarter of a second either way on five seconds.
    expect(regularRun(evenly(REGULAR_RUN_ACTIONS, 5_000, () => (random() - 0.5) * 500))).toBeNull();
    // A timer with a little noise is still caught: 1% of the gap.
    expect(regularRun(evenly(REGULAR_RUN_ACTIONS, 5_000, () => (random() - 0.5) * 100))).not.toBeNull();
  });
});

describe("the patterns, through the real-action middleware", () => {
  test("ordinary play for two hours asks for nothing", async () => {
    const random = seeded(42);
    const routes = ["bank", "upgrade", "build", "hatchery/add", "mushroom/pick", "repair", "locker/start"];
    atMs(T0 * 1000);
    for (let i = 0; i < 600; i += 1) {
      // Bursts of quick taps (collecting a row of buildings), then a pause to look around.
      const burst = random() < 0.3;
      after(burst ? 300 + random() * 1_500 : 2_000 + random() * 25_000);
      const body = await action(routes[Math.floor(random() * routes.length)]!);
      expect(body.checkPending).toBeUndefined();
    }
    // A "Stay protected" tap now and then, between real play.
    for (let i = 0; i < 10; i += 1) {
      after(9 * 60_000);
      await stay();
      after(30_000);
      await action("upgrade");
    }
    expect(await pending()).toBe(false);
    expect(await readBotCheckLog()).toEqual([]);
  });

  test(`regular: ${REGULAR_RUN_ACTIONS} actions on a timer ask for the check on the last one`, async () => {
    atMs(T0 * 1000);
    for (let i = 1; i < REGULAR_RUN_ACTIONS; i += 1) {
      expect((await action(i % 2 ? "upgrade" : "bank")).checkPending).toBeUndefined();
      after(4_000 + (i % 3) * 10);
    }
    expect(await pending()).toBe(false);
    const body = await action("upgrade");
    expect(body.checkPending).toBe(true);
    expect(body.lastAction).toBe(nowSeconds());
    expect(await pending()).toBe(true);
    const [row] = await readBotCheckLog();
    expect(row).toMatchObject({ userid: USER, event: "trigger", rule: "regular", at: nowSeconds() });
    expect(row!.detail).toContain("4.01 s apart");
  });

  test(`repeat: one route ${SAME_ROUTE_LIMIT} times in an hour, at no steady pace`, async () => {
    const random = seeded(3);
    atMs(T0 * 1000);
    for (let i = 1; i < SAME_ROUTE_LIMIT; i += 1) {
      expect((await action("bank")).checkPending).toBeUndefined();
      after(500 + random() * 20_000);
    }
    expect((await action("bank")).checkPending).toBe(true);
    const [row] = await readBotCheckLog();
    expect(row).toMatchObject({ event: "trigger", rule: "repeat" });
    expect(row!.detail).toBe(`POST /api/:apiVersion/bm/yard/bank ${SAME_ROUTE_LIMIT} times in the last hour`);
  });

  test("repeat: counts only the last hour, and each route on its own", async () => {
    const random = seeded(5);
    atMs(T0 * 1000);
    for (let i = 0; i < 150; i += 1) {
      await action("bank");
      after(100 + random() * 500);
    }
    // Over an hour later: the first 150 no longer count.
    after(70 * 60_000);
    for (let i = 0; i < 150; i += 1) {
      await action("bank");
      await action("upgrade");
      after(100 + random() * 500);
    }
    expect(await pending()).toBe(false);
  });

  test(`stay: the "Stay protected" tap ${STAY_STREAK_LIMIT} times running, nothing else`, async () => {
    atMs(T0 * 1000);
    for (let i = 1; i < STAY_STREAK_LIMIT; i += 1) {
      expect((await stay()).checkPending).toBe(false);
      after(9 * 60_000 + i * 7_000);
    }
    // Another real action breaks the streak.
    await action("upgrade");
    for (let i = 1; i < STAY_STREAK_LIMIT; i += 1) {
      after(9 * 60_000 + i * 7_000);
      await stay();
    }
    expect(await pending()).toBe(false);
    after(9 * 60_000);
    const body = await stay();
    expect(body.checkPending).toBe(true);
    expect((await readBotCheckLog())[0]).toMatchObject({ event: "trigger", rule: "stay" });
  });

  test("every key the patterns keep has a life", async () => {
    atMs(T0 * 1000);
    await action("bank");
    await stay();
    await stay();
    const keys = [
      `bot-check:times:${USER}`,
      `bot-check:stay:${USER}`,
      `bot-check:routes:${USER}:${Math.floor(T0 / 600)}`,
    ];
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      expect([key, ttl > 0]).toEqual([key, true]);
    }
    await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, T0);
    await readCheck();
    for (const key of [challengeKey(USER), `bot-check:challenge:${USER}`, BOT_CHECK_LOG_KEY]) {
      const ttl = await redis.ttl(key);
      expect([key, ttl > 0]).toEqual([key, true]);
    }
    expect(await redis.ttl(challengeKey(USER))).toBe(CHALLENGE_PENDING_TTL_SECONDS);
    expect(await redis.ttl(BOT_CHECK_LOG_KEY)).toBe(BOT_CHECK_LOG_TTL_SECONDS);
  });
});

describe("while a check waits", () => {
  test("the player reads as offline, and the game keeps working", async () => {
    atMs(T0 * 1000);
    await action("upgrade");
    await ping();
    expect(await online()).toBe(true);
    await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, nowSeconds());
    expect(await online()).toBe(false);

    // Real actions still go through and still count, but protect nothing.
    after(5_000);
    const body = await action("build");
    expect(body).toMatchObject({ error: 0, lastAction: nowSeconds(), checkPending: true });
    expect((await ping()).checkPending).toBe(true);
    expect((await stay()).checkPending).toBe(true);
    expect(await online()).toBe(false);
  });

  test("no further pattern is noted", async () => {
    atMs(T0 * 1000);
    await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, nowSeconds());
    for (let i = 0; i < REGULAR_RUN_ACTIONS + 5; i += 1) {
      await action("upgrade");
      after(3_000);
    }
    expect((await readBotCheckLog()).map(({ event }) => event)).toEqual(["trigger"]);
    expect(await redis.lrange(`bot-check:times:${USER}`, 0, -1)).toEqual([]);
  });
});

describe("the check", () => {
  test("nothing waits until something asks for it", async () => {
    expect(await readCheck()).toMatchObject({ error: 0, checkPending: false });
    expect((await ping()).checkPending).toBe(false);
  });

  test("is a picture, a portrait and a name, and never says how many, which monster id or where", async () => {
    const counts = new Set<number>();
    const targets = new Set<string>();
    const pictures = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      redis.clear();
      await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, T0);
      const body = await readCheck();
      expect(Object.keys(body).sort()).toEqual(["challenge", "checkPending", "error", "now"]);
      const check = body.challenge as Check;
      expect(Object.keys(check).sort()).toEqual(["id", "name", "picture", "prompt", "reference"]);
      expect(check.id).toMatch(/^[0-9a-f]{16}$/);
      expect(check.prompt).toBe("How many of these are in the picture?");

      const secret = await stored();
      expect(check.name).toBe(monsterEntry(secret.target)!.name);
      expect(challenge.CHALLENGE_TARGETS).toContain(secret.target);
      expect(secret.count).toBeGreaterThanOrEqual(challenge.CHALLENGE_COUNT_MIN);
      expect(secret.count).toBeLessThanOrEqual(challenge.CHALLENGE_COUNT_MAX);

      // The pictures are image bytes and nothing else.
      expect(check.reference).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);
      expect(check.picture).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
      const png = decodePng(Buffer.from(check.picture.slice(check.picture.indexOf(",") + 1), "base64"));
      expect([png.width, png.height]).toEqual([PICTURE_WIDTH, PICTURE_HEIGHT]);

      // Outside the image bytes: no count, no monster id, no seed, no position.
      const words = JSON.stringify({ ...body, challenge: { ...check, picture: "", reference: "" } });
      expect(words).not.toMatch(/\bC\d+\b/);
      expect(words).not.toContain(secret.seed);
      expect(words).not.toMatch(/count|target|seed|monster|options|answer|"x"|"y"/);
      expect(words.replace(/"now":\d+/, "").replace('"error":0', "").replace(check.id, "")).not.toMatch(/\d/);
      counts.add(secret.count);
      targets.add(secret.target);
      pictures.add(check.picture);
    }
    expect(counts.size).toBeGreaterThan(3);
    expect(targets.size).toBeGreaterThan(3);
    expect(pictures.size).toBe(30);
  });

  test("asking again shows the same check", async () => {
    await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, T0);
    const first = (await readCheck()).challenge as Check;
    expect((await readCheck()).challenge).toEqual(first);
  });

  test("the right answer clears it, is a real action and protects the player again", async () => {
    atMs(T0 * 1000);
    await ping();
    // Some pattern state from before, which a solved check forgets.
    await action("bank");
    await stay();
    await challenge.raiseCheck(USER, { rule: "regular", detail: "test" }, nowSeconds());
    const check = (await readCheck()).challenge as Check;
    expect(await online()).toBe(false);

    after(2_000);
    const right = await rightOption();
    const body = await answer(check.id, right);
    expect(body).toMatchObject({ error: 0, solved: true, checkPending: false, lastAction: nowSeconds() });
    expect(body.challenge).toBeUndefined();
    expect(await pending()).toBe(false);
    expect(await online()).toBe(true);
    expect(await redis.lrange(`bot-check:times:${USER}`, 0, -1)).toEqual([]);
    expect(await redis.get(`bot-check:stay:${USER}`)).toBeNull();

    const rows = await readBotCheckLog();
    expect(rows.map(({ event }) => event)).toEqual(["solved", "trigger"]);
    expect(rows[0]!.detail).toMatch(/^counted \d (Pokey|Octo-ooze|Bolt|Fink|Eye-ra|Ichi|Bandito|Fang)s?$/);
    // Used once: the same answer again is nothing.
    expect(await answer(check.id, right)).toMatchObject({
      solved: false,
      checkPending: false,
    });
  });

  test("a wrong answer is no real action, and gets a new check", async () => {
    atMs(T0 * 1000);
    await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, nowSeconds());
    const check = (await readCheck()).challenge as Check;
    const body = await answer(check.id, await aWrongOption());
    expect(body).toMatchObject({ error: 0, solved: false, checkPending: true });
    expect(body.lastAction).toBeUndefined();
    const next = body.challenge as Check;
    expect(next.id).not.toBe(check.id);
    expect(await pending()).toBe(true);
    const [row] = await readBotCheckLog();
    expect(row).toMatchObject({ event: "wrong", userid: USER });
    expect(row!.detail).toContain(`wrong answer 1 of ${WRONG_ANSWER_LIMIT}`);

    // An answer to the old check is not counted: it gets the one that stands.
    const stale = await answer(check.id, "3");
    expect(stale).toMatchObject({ solved: false, checkPending: true, challenge: next });
    expect((await readBotCheckLog()).length).toBe(2);
  });

  test(`${WRONG_ANSWER_LIMIT} wrong answers in ten minutes: a wait, then a new check`, async () => {
    atMs(T0 * 1000);
    await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, nowSeconds());
    let check = (await readCheck()).challenge as Check;
    let body: Body = {};
    for (let i = 1; i <= WRONG_ANSWER_LIMIT; i += 1) {
      after(20_000);
      body = await answer(check.id, await aWrongOption());
      if (i < WRONG_ANSWER_LIMIT) check = body.challenge as Check;
    }
    const until = nowSeconds() + COOLDOWN_SECONDS;
    expect(body).toMatchObject({ solved: false, checkPending: true, cooldownUntil: until });
    expect(body.challenge).toBeUndefined();
    expect((await readBotCheckLog()).slice(0, 2).map(({ event }) => event)).toEqual(["cooldown", "wrong"]);

    // During the wait: no check, and an answer is not even tried.
    after(30_000);
    expect(await readCheck()).toMatchObject({ checkPending: true, cooldownUntil: until });
    expect(await answer(check.id, "anything")).toMatchObject({ solved: false, cooldownUntil: until });
    expect((await readBotCheckLog()).length).toBe(1 + WRONG_ANSWER_LIMIT + 1);

    // After it: a new check, and the count starts again.
    atMs(until * 1000);
    const fresh = (await readCheck()).challenge as Check;
    expect(fresh.picture).toStartWith("data:image/png;base64,");
    const again = await answer(fresh.id, await aWrongOption());
    expect(again.challenge).toBeDefined();
    expect((await readBotCheckLog())[0]!.detail).toContain(`wrong answer 1 of ${WRONG_ANSWER_LIMIT}`);
  });

  test("wrong answers further apart than the window do not add up", async () => {
    atMs(T0 * 1000);
    await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, nowSeconds());
    let check = (await readCheck()).challenge as Check;
    for (let i = 1; i < WRONG_ANSWER_LIMIT; i += 1) {
      check = (await answer(check.id, await aWrongOption())).challenge as Check;
    }
    after((WRONG_ANSWER_WINDOW_SECONDS + 1) * 1000);
    // The check itself ran out meanwhile; the next read makes another.
    check = (await readCheck()).challenge as Check;
    const body = await answer(check.id, await aWrongOption());
    expect(body.cooldownUntil).toBeUndefined();
    expect(body.challenge).toBeDefined();
  });

  test("an answer with no check waiting does nothing", async () => {
    expect(await answer("abc", "def")).toMatchObject({ solved: false, checkPending: false });
    expect(await readBotCheckLog()).toEqual([]);
  });

  test("an answer that is no number is a wrong answer", async () => {
    await challenge.raiseCheck(USER, { rule: "dev", detail: "test" }, T0);
    const check = (await readCheck()).challenge as Check;
    expect(await answer(check.id, "many")).toMatchObject({ solved: false, checkPending: true });
    expect((await readBotCheckLog())[0]!.detail).toContain("answered many for");
  });
});

describe("the review log", () => {
  test("keeps the newest rows, capped", async () => {
    const { logBotCheck } = await import("./botCheckLog.js");
    for (let i = 0; i < 3; i += 1) await logBotCheck({ at: T0 + i, userid: USER, event: "wrong", detail: `row ${i}` });
    expect((await readBotCheckLog(2)).map(({ detail }) => detail)).toEqual(["row 2", "row 1"]);
    expect(BOT_CHECK_LOG_MAX).toBeGreaterThanOrEqual(1_000);
  });
});

describe("the DEV trigger", () => {
  test("is on only for a local server", () => {
    expect(devCheckEnabled("local")).toBe(true);
    expect(devCheckEnabled("production")).toBe(false);
    expect(devCheckEnabled(undefined)).toBe(false);
    expect(devCheckEnabled("staging")).toBe(false);
  });

  test("is mounted only behind that switch", () => {
    const routes = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8");
    const lines = routes.split(/\r?\n/);
    const line = lines.findIndex((text) => text.includes('"/api/:apiVersion/bm/presence/check/dev"'));
    expect(line).toBeGreaterThan(0);
    expect(lines[line - 1]).toBe("if (devCheckEnabled()) {");
  });

  test("refuses on any other server, and asks for a check on a local one", async () => {
    const saved = process.env.ENV;
    try {
      process.env.ENV = "production";
      const refused = { request: { body: {} }, authUser: { userid: USER } } as unknown as Context;
      await botCheckForce(refused, async () => {});
      expect(refused.status).toBe(404);
      expect(await pending()).toBe(false);

      process.env.ENV = "local";
      const ctx = { request: { body: {} }, authUser: { userid: USER } } as unknown as Context;
      await botCheckForce(ctx, async () => {});
      expect(ctx.body).toMatchObject({ error: 0, checkPending: true });
      expect(await pending()).toBe(true);
      expect((await readBotCheckLog())[0]).toMatchObject({ event: "trigger", rule: "dev" });
    } finally {
      process.env.ENV = saved;
    }
  });
});
