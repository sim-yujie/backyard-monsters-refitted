import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import Router from "@koa/router";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import JWT from "jsonwebtoken";
import Koa from "koa";

/**
 * `POST /api/:apiVersion/clienttiming` over HTTP, through the server's real
 * body parsers, JSON body middleware, error interceptor, sign-in check and
 * rate limiter: a Map Room 2 open timing record becomes one
 * "mr2-open-timing" log line with the account number; anything else is a 400
 * that logs nothing; signed out is refused; the fifth in a minute is a 429.
 *
 * No database or Redis: the sign-in check's two lookups are stand-ins that
 * accept one token for one account.
 */

const SECRET = "client-timing-test-secret";
const EMAIL = "timing@example.com";
const USERID = 2503;
const TOKEN = JWT.sign({ user: { email: EMAIL, discordId: null, sessionType: "game" } }, SECRET);

mock.module("../../server.js", () => ({
  postgres: { em: { findOne: async () => ({ userid: USERID, email: EMAIL, banned: false }) } },
  redis: { get: async () => TOKEN, set: async () => "OK", del: async () => 0 },
}));

const infoLines: { message: string; props: Record<string, unknown> }[] = [];
const warnLines: unknown[] = [];
mock.module("../../utils/logger.js", () => ({
  logger: {
    info: (message: string, props: Record<string, unknown>) => infoLines.push({ message, props }),
    warn: (...args: unknown[]) => warnLines.push(args),
    error: () => {},
    debug: () => {},
  },
}));

const { clientTiming, MR2_OPEN_TIMING_LOG } = await import("./clientTiming.js");
const { clientTimingLimiter } = await import("../../middleware/rateLimiters.js");
const { verifyUserAuth } = await import("../../middleware/auth.js");
const { ErrorInterceptor } = await import("../../middleware/clientSafeError.js");
const { bodyParsers } = await import("../../middleware/bodyLimits.js");
const { jsonBodyCompat } = await import("../../middleware/jsonBody.js");
const { CLIENT_TIMING_LIMITS } = await import("../../schemas/ClientTimingSchema.js");

/** A record exactly as web `compactRecord` makes it. */
const RECORD = {
  v: 1,
  open: "first",
  reason: "done",
  total: 4210,
  t: { open: 0, "own-cell": 812, painted: 2950, "full-look": 4210, "first-frame": 640 },
  spans: { "account-hexshape": 120, "atlas-bake": 35, "own-yard": 480, sight: 210 },
  area: { n: 6, ok: 6, fail: 0, avg: 180, max: 402 },
  art: { "ground@2x.webp": 900, "cliffs@2x.webp": 650 },
  cut: 74,
  shaders: { "ground-low": 41, "ground-high": 233 },
  kb: { total: 5120, area: 88, art: 4600, code: 410 },
  cached: "no",
  info: { quality: "high", classic: false, browser: "Chrome 131", gpu: "ANGLE (NVIDIA GeForce)", centreZones: 7, ownYard: "fetched" },
};

describe("POST /clienttiming", () => {
  let server: Server;
  let url = "";
  let savedSecret: string | undefined;

  /** Each test's account, so the per-account limit of one test cannot reach another. */
  let nextUser = USERID;

  const post = async (body: unknown, signedIn = true) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signedIn && { Authorization: `Bearer ${TOKEN}` }) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    savedSecret = process.env.SECRET_KEY;
    process.env.SECRET_KEY = SECRET;
    const app = new Koa();
    const router = new Router();
    // The route as `app.routes.ts` mounts it, minus the version check; the
    // stand-in after the sign-in check gives each test its own account.
    router.post(
      "/api/:apiVersion/clienttiming",
      verifyUserAuth,
      async (ctx, next) => {
        ctx.authUser = { ...ctx.authUser, userid: nextUser } as typeof ctx.authUser;
        await next();
      },
      clientTimingLimiter,
      clientTiming
    );
    app.use(ErrorInterceptor);
    app.use(bodyParsers());
    app.use(jsonBodyCompat);
    app.use(router.routes());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    url = `http://127.0.0.1:${port}/api/v/clienttiming`;
  });

  afterAll(() => {
    server?.close();
    if (savedSecret === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = savedSecret;
  });

  beforeEach(() => {
    infoLines.length = 0;
    warnLines.length = 0;
    nextUser += 1;
  });

  test("a valid record is one mr2-open-timing log line with the account number", async () => {
    const { status, body } = await post({ record: RECORD, gameVersion: "v2.0.0-beta.6.6" });
    expect(status).toBe(200);
    expect(body).toEqual({ error: 0 });
    expect(infoLines).toHaveLength(1);
    expect(infoLines[0]!.message).toBe(MR2_OPEN_TIMING_LOG);
    expect(infoLines[0]!.message).toBe("mr2-open-timing");
    expect(infoLines[0]!.props).toEqual({ userid: nextUser, gameVersion: "v2.0.0-beta.6.6", record: RECORD });
  });

  test("a later open, nulls and no game version are fine", async () => {
    const record = { ...RECORD, open: "later", reason: "left", area: { n: 0, ok: 0, fail: 0, avg: null, max: null }, cached: null, art: {}, info: {} };
    const { status } = await post({ record });
    expect(status).toBe(200);
    expect(infoLines[0]!.props).toEqual({ userid: nextUser, gameVersion: "", record });
  });

  const refused: [string, unknown][] = [
    ["no body", {}],
    ["record not an object", { record: "hello" }],
    ["record as broken JSON text", { record: "{\"v\":1," }],
    ["an unknown top-level field", { record: RECORD, userid: 1 }],
    ["an unknown record field", { record: { ...RECORD, email: "x@y.z" } }],
    ["an unknown area field", { record: { ...RECORD, area: { ...RECORD.area, extra: 1 } } }],
    ["a wrong version", { record: { ...RECORD, v: 2 } }],
    ["a wrong open type", { record: { ...RECORD, open: "third" } }],
    ["a negative time", { record: { ...RECORD, total: -5 } }],
    ["a time over the cap", { record: { ...RECORD, total: CLIENT_TIMING_LIMITS.msMax + 1 } }],
    ["text where a number goes", { record: { ...RECORD, t: { open: "0" } } }],
    ["an object in info", { record: { ...RECORD, info: { gpu: { name: "x" } } } }],
    ["an info text too long", { record: { ...RECORD, info: { gpu: "x".repeat(CLIENT_TIMING_LIMITS.infoTextMax + 1) } } }],
    ["a key too long", { record: { ...RECORD, art: { ["a".repeat(CLIENT_TIMING_LIMITS.keyMax + 1)]: 5 } } }],
    ["a control character in a key", { record: { ...RECORD, spans: { "own\nyard": 5 } } }],
    [
      "too many keys",
      { record: { ...RECORD, spans: Object.fromEntries(Array.from({ length: CLIENT_TIMING_LIMITS.mapKeysMax + 1 }, (_, i) => [`s${i}`, i])) } },
    ],
    ["a game version too long", { record: RECORD, gameVersion: "v".repeat(33) }],
    ["an array for the record", { record: [RECORD] }],
  ];

  for (const [name, body] of refused) {
    test(`refused with 400 and nothing logged: ${name}`, async () => {
      const { status, body: answer } = await post(body);
      expect(status).toBe(400);
      expect(answer.reason).toBe("invalidRequest");
      expect(infoLines).toHaveLength(0);
      expect(warnLines).toHaveLength(0);
    });
  }

  test("an oversize record text is refused", async () => {
    // Every map full of the longest keys: each field is within its limit, the whole is not.
    const full = (tag: string) =>
      Object.fromEntries(
        Array.from({ length: CLIENT_TIMING_LIMITS.mapKeysMax }, (_, i) => [`${tag}${i}`.padEnd(CLIENT_TIMING_LIMITS.keyMax, "x"), i])
      );
    const huge = { ...RECORD, t: full("t"), spans: full("s"), art: full("a"), shaders: full("h") };
    expect(JSON.stringify(huge).length).toBeGreaterThan(CLIENT_TIMING_LIMITS.rawMax);
    const { status } = await post({ record: huge });
    expect(status).toBe(400);
    expect(infoLines).toHaveLength(0);
  });

  test("signed out is refused and logs no record", async () => {
    const { status } = await post({ record: RECORD }, false);
    expect(status).toBe(401);
    expect(infoLines).toHaveLength(0);
  });

  test("the fifth in a minute from one account is a 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await post({ record: RECORD })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 429]);
    expect(infoLines).toHaveLength(4);
  });
});

describe("app.routes.ts", () => {
  test("mounts the route signed in and rate limited", () => {
    const routes = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8");
    expect(routes).toContain(
      'router.post("/api/:apiVersion/clienttiming", apiVersion, verifyUserAuth, clientTimingLimiter, clientTiming);'
    );
  });
});
