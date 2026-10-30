import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import Koa from "koa";
import serve from "koa-static";
import { notModified, tagFile } from "./notModified.js";

describe("notModified with koa-static", () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "not-modified-"));
    writeFileSync(join(dir, "top.png"), Buffer.alloc(500, 1));

    const app = new Koa();
    const staticFiles = serve(dir, { setHeaders: tagFile });
    app.use((ctx, next) => notModified(ctx, () => staticFiles(ctx, next)));
    app.use((ctx) => {
      ctx.body = "not a file";
    });

    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (headers: Record<string, string> = {}) => fetch(`${base}/top.png`, { headers });

  test("sends the file with a tag the first time", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    // Strong, so a browser can resume a cut-off download with If-Range.
    expect(res.headers.get("ETag")).toMatch(/^"1f4-[0-9a-f]+"$/);
    expect((await res.arrayBuffer()).byteLength).toBe(500);
  });

  test("answers an empty 304 when the browser's copy is current", async () => {
    const first = await get();
    await first.arrayBuffer();

    const res = await get({
      "If-None-Match": first.headers.get("ETag") ?? "",
      "If-Modified-Since": first.headers.get("Last-Modified") ?? "",
    });

    expect(res.status).toBe(304);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  test("sends a replacement copied in with an older date", async () => {
    const first = await get();
    await first.arrayBuffer();

    writeFileSync(join(dir, "top.png"), Buffer.alloc(500, 2));
    const older = new Date(Date.parse(first.headers.get("Last-Modified") ?? "") - 60_000);
    utimesSync(join(dir, "top.png"), older, older);

    const res = await get({
      "If-None-Match": first.headers.get("ETag") ?? "",
      "If-Modified-Since": first.headers.get("Last-Modified") ?? "",
    });

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.alloc(500, 2));
  });

  test("leaves anything that is not a file alone", async () => {
    const res = await fetch(`${base}/missing.png`, { headers: { "If-None-Match": "*" } });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("not a file");
  });
});
