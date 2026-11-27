import { describe, expect, mock, test } from "bun:test";
import Koa from "koa";

/**
 * A clean stop on SIGTERM (beta 10, owner's pick B+): a request being
 * handled when the server is told to stop is answered, a new connection is
 * refused (so Caddy holds it for the next server), and the server then
 * closes its services and exits.
 */

mock.module("./logger.js", () => ({
  logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}));
const { shutdownGracefully } = await import("./gracefulShutdown.js");

const serve = (slowMs: number) => {
  const app = new Koa();
  app.use(async (ctx) => {
    if (ctx.path === "/slow") await Bun.sleep(slowMs);
    ctx.body = `done ${ctx.path}`;
  });
  const http = app.listen(0);
  const { port } = http.address() as { port: number };
  return { http, url: (path: string) => `http://127.0.0.1:${port}${path}` };
};

describe("a clean shutdown", () => {
  test("finishes the open request, refuses new ones, then closes services and exits", async () => {
    const { http, url } = serve(800);
    // A keep-alive connection left idle must not hold the shutdown up.
    expect(await (await fetch(url("/warm"))).text()).toBe("done /warm");

    const started = Date.now();
    const open = fetch(url("/slow")).then(async (r) => ({ status: r.status, body: await r.text(), at: Date.now() - started }));
    await Bun.sleep(100);

    const order: string[] = [];
    const exit = mock((code: number) => void order.push(`exit ${code}`));
    const done = shutdownGracefully("test", {
      http,
      graceMs: 5_000,
      exit,
      closers: [
        ["one", () => void order.push("one")],
        ["broken", () => { throw new Error("no"); }],
        ["hangs", () => new Promise(() => {})],
        ["two", async () => void order.push("two")],
      ],
      closerMs: 100,
    });

    await Bun.sleep(50);
    const fresh = await fetch(url("/new")).then(() => "answered", (err: { code?: string }) => err.code ?? "refused");
    expect(fresh).not.toBe("answered");

    expect(await open).toMatchObject({ status: 200, body: "done /slow" });
    await done;
    expect(order).toEqual(["one", "two", "exit 0"]);
    // Done soon after the open request, not at the grace limit.
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  test("cuts off what is still open at the grace limit", async () => {
    const { http, url } = serve(5_000);
    const started = Date.now();
    const open = fetch(url("/slow")).then(() => "answered", () => "cut off");
    await Bun.sleep(100);
    const exit = mock(() => {});
    await shutdownGracefully("test", { http, graceMs: 300, exit });
    expect(await open).toBe("cut off");
    expect(exit).toHaveBeenCalledWith(0);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
