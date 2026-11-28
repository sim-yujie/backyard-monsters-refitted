import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { configure, getLogger, type LogRecord, reset } from "@logtape/logtape";
import { koaLogger } from "@logtape/koa";
import Koa from "koa";
import { pageBuildContext, pageBuildOf } from "./pageBuild.js";

/**
 * The page's build id reaches the request log (beta 10, owner's pick B+):
 * the record the request logger writes, and every line logged while the
 * request runs, carry `pageBuild` from the `pb` query parameter.
 */

const records: LogRecord[] = [];

beforeAll(async () => {
  await configure({
    reset: true,
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: { memory: (record) => records.push(record) },
    loggers: [
      { category: ["logtape", "meta"], lowestLevel: "error", sinks: [] },
      { category: ["test"], lowestLevel: "debug", sinks: ["memory"] },
    ],
  });
});
afterAll(() => reset());

const serve = async (path: string): Promise<void> => {
  const app = new Koa();
  app.use(pageBuildContext);
  app.use(koaLogger({ category: ["test", "http"], format: "structured-common" }));
  app.use((ctx) => {
    getLogger(["test", "route"]).info("handled");
    ctx.body = "ok";
  });
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    expect((await fetch(`http://127.0.0.1:${port}${path}`)).status).toBe(200);
  } finally {
    server.close();
  }
};

describe("the page build", () => {
  test("is on the request record and on lines logged inside the request", async () => {
    records.length = 0;
    await serve("/api/v1/base/load?pb=AbC12-x_9");
    const request = records.find((record) => record.category.join(".") === "test.http");
    const route = records.find((record) => record.category.join(".") === "test.route");
    expect(request?.properties.pageBuild).toBe("AbC12-x_9");
    expect(route?.properties.pageBuild).toBe("AbC12-x_9");
  });

  test("is absent when the page sends none", async () => {
    records.length = 0;
    await serve("/api/v1/base/load");
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) expect(record.properties.pageBuild).toBeUndefined();
  });

  test("takes only a short id of word characters", () => {
    expect(pageBuildOf("D4xk2_-9")).toBe("D4xk2_-9");
    expect(pageBuildOf("a".repeat(41))).toBeNull();
    expect(pageBuildOf("<script>")).toBeNull();
    expect(pageBuildOf(["a", "b"])).toBeNull();
    expect(pageBuildOf(undefined)).toBeNull();
  });
});
