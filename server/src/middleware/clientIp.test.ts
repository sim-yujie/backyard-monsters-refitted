import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Koa from "koa";
import { RateLimit, Stores } from "koa2-ratelimit";

import { parseTrustedProxies, type TrustedProxies } from "../config/ProxyConfig.js";
import { clientIp } from "./clientIp.js";

/** A real Koa server answering with ctx.ip behind a 2-per-minute per-IP limit. */
const startServer = async (proxies: TrustedProxies) => {
  const app = new Koa();
  app.use(clientIp(proxies));
  app.use(
    RateLimit.middleware({
      interval: { min: 1 },
      max: 2,
      prefixKey: "clientip-test",
      store: new Stores.Memory(),
    })
  );
  app.use((ctx) => {
    ctx.body = ctx.ip;
  });

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/` };
};

const ask = (url: string, cfConnectingIp: string) => fetch(url, { headers: { "CF-Connecting-IP": cfConnectingIp } });

describe("clientIp (issue #214)", () => {
  describe("a direct connection, not from a trusted proxy", () => {
    let running: Awaited<ReturnType<typeof startServer>>;
    beforeAll(async () => (running = await startServer(parseTrustedProxies("cloudflare"))));
    afterAll(() => running.server.close());

    test("is keyed by the connecting address, so a new fake header every request is still limited", async () => {
      const first = await ask(running.url, "198.51.100.1");
      expect(first.status).toBe(200);
      expect(await first.text()).toBe("127.0.0.1");

      expect((await ask(running.url, "198.51.100.2")).status).toBe(200);
      expect((await ask(running.url, "198.51.100.3")).status).toBe(429);
    });
  });

  describe("a connection from a trusted proxy", () => {
    let running: Awaited<ReturnType<typeof startServer>>;
    beforeAll(async () => (running = await startServer(parseTrustedProxies("127.0.0.1"))));
    afterAll(() => running.server.close());

    test("is keyed by the address the proxy names", async () => {
      const first = await ask(running.url, "198.51.100.1");
      expect(await first.text()).toBe("198.51.100.1");

      // Each visitor behind the proxy has a limit of their own.
      expect((await ask(running.url, "198.51.100.1")).status).toBe(200);
      expect((await ask(running.url, "198.51.100.1")).status).toBe(429);
      expect((await ask(running.url, "198.51.100.2")).status).toBe(200);
    });
  });
});
