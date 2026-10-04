import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Context } from "koa";

/**
 * The one list of routes that count as a real game action (#271): it names
 * only routes that exist, every yard route is placed on one side or the
 * other, and nothing a client sends while it sits still is on it.
 */

mock.module("../../server.js", () => ({ postgres: { em: {} }, redis: {} }));

const { yardRoutes } = await import("../../controllers/yard/index.js");
const {
  NOT_REAL_ACTION_YARD_PATHS,
  REAL_ACTION_ROUTES,
  REAL_ACTION_YARD_PATHS,
  YARD_ROUTE_PREFIX,
  answeredOk,
  isRealActionRequest,
} = await import("./realActions.js");

const routesFile = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8");
const ctxOf = (method: string, body: unknown = {}) => ({ method, request: { body } }) as unknown as Context;

describe("REAL_ACTION_ROUTES", () => {
  test("every yard route is either a real action or listed as not one, never both", () => {
    const real = new Set(REAL_ACTION_YARD_PATHS);
    const notReal = new Set(NOT_REAL_ACTION_YARD_PATHS);
    for (const { path } of yardRoutes) {
      expect([path, real.has(path) !== notReal.has(path)]).toEqual([path, true]);
    }
    const mounted = new Set(yardRoutes.map(({ path }) => path));
    for (const path of [...real, ...notReal]) expect([path, mounted.has(path)]).toEqual([path, true]);
  });

  test("every other route on it is mounted by app.routes.ts with that method", () => {
    for (const { method, path } of REAL_ACTION_ROUTES) {
      if (path.startsWith(YARD_ROUTE_PREFIX)) continue;
      const registered = `router.${method.toLowerCase()}("${path}"`;
      expect([registered, routesFile.includes(registered)]).toEqual([registered, true]);
    }
  });

  test.each([
    ["POST", "/api/:apiVersion/bm/presence"],
    ["GET", "/api/:apiVersion/bm/maproom1"],
    ["POST", "/worldmapv3/getcells"],
    ["POST", "/worldmapv2/getarea"],
    ["POST", "/worldmapv2/takeoverquote"],
    ["POST", "/base/checkpoint"],
    ["POST", "/base/updatesaved"],
    ["GET", "/api/:apiVersion/bm/notifications/unread"],
    ["POST", "/api/:apiVersion/bm/yard/state"],
    ["POST", "/api/:apiVersion/player/sendmessage"],
  ])("%s %s is not a real action", (method, route) => {
    expect(isRealActionRequest(ctxOf(method), route)).toBe(false);
  });

  test("a load is one only when it starts an attack", () => {
    for (const route of ["/base/load", "/api/:apiVersion/bm/base/load"]) {
      expect(isRealActionRequest(ctxOf("POST", { type: "build" }), route)).toBe(false);
      expect(isRealActionRequest(ctxOf("POST", { type: "view" }), route)).toBe(false);
      expect(isRealActionRequest(ctxOf("POST", { type: "wmview" }), route)).toBe(false);
      expect(isRealActionRequest(ctxOf("POST", { type: "attack" }), route)).toBe(true);
      expect(isRealActionRequest(ctxOf("POST", { type: "wmattack" }), route)).toBe(true);
    }
  });

  test("an in-game check's answer is one only when it was right (#273)", () => {
    const route = "/api/:apiVersion/bm/presence/check/answer";
    const answered = (body: unknown) => ({ method: "POST", request: { body: {} }, body }) as unknown as Context;
    expect(isRealActionRequest(answered({ error: 0, solved: true }), route)).toBe(true);
    expect(isRealActionRequest(answered({ error: 0, solved: false }), route)).toBe(false);
    expect(isRealActionRequest(answered(undefined), route)).toBe(false);
    expect(isRealActionRequest(ctxOf("POST"), "/api/:apiVersion/bm/presence/check")).toBe(false);
  });

  test("matches the method as well as the route", () => {
    expect(isRealActionRequest(ctxOf("POST"), "/api/:apiVersion/bm/yard/build")).toBe(true);
    expect(isRealActionRequest(ctxOf("GET"), "/api/:apiVersion/bm/yard/build")).toBe(false);
    expect(isRealActionRequest(ctxOf("POST"), undefined)).toBe(false);
  });
});

describe("answeredOk", () => {
  const answer = (status: number, body: unknown) => ({ status, body }) as unknown as Context;

  test("a 2xx answer with no error", () => {
    expect(answeredOk(answer(200, { error: 0 }))).toBe(true);
    expect(answeredOk(answer(200, { ok: true }))).toBe(true);
    expect(answeredOk(answer(204, undefined))).toBe(true);
  });

  test("not a refusal or a failure", () => {
    expect(answeredOk(answer(400, { error: "No" }))).toBe(false);
    expect(answeredOk(answer(500, undefined))).toBe(false);
    expect(answeredOk(answer(200, { error: "Not enough resources" }))).toBe(false);
    expect(answeredOk(answer(200, { error: 1 }))).toBe(false);
  });
});
