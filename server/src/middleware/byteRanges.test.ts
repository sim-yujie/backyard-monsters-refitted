import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import Koa from "koa";
import serve from "koa-static";
import { byteRanges, parseByteRange, UNSATISFIABLE } from "./byteRanges.js";

describe("parseByteRange", () => {
  test("reads a closed range", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
  });

  test("reads an open-ended range to the end of the file", () => {
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
  });

  test("reads a suffix range as the last bytes", () => {
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  test("cuts an end past the file to the last byte", () => {
    expect(parseByteRange("bytes=990-5000", 1000)).toEqual({ start: 990, end: 999 });
  });

  test("gives the whole file for a suffix longer than the file", () => {
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  test("calls a start past the end unsatisfiable", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBe(UNSATISFIABLE);
    expect(parseByteRange("bytes=2000-3000", 1000)).toBe(UNSATISFIABLE);
  });

  test("calls an empty suffix unsatisfiable", () => {
    expect(parseByteRange("bytes=-0", 1000)).toBe(UNSATISFIABLE);
  });

  test("ignores headers it cannot read", () => {
    for (const header of ["bytes=", "bytes=-", "items=0-9", "bytes=a-b", "bytes=9-0", "bytes=0-9,20-29"]) {
      expect(parseByteRange(header, 1000)).toBeUndefined();
    }
  });
});

describe("byteRanges with koa-static", () => {
  const content = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "byte-ranges-"));
    writeFileSync(join(dir, "tune.mp3"), content);

    const app = new Koa();
    const staticFiles = serve(dir);
    app.use((ctx, next) => byteRanges(ctx, () => staticFiles(ctx, next)));
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

  const get = (range?: string, init: RequestInit = {}) =>
    fetch(`${base}/tune.mp3`, { ...init, headers: range ? { Range: range } : {} });

  test("sends the whole file unchanged without a Range header", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Content-Range")).toBeNull();
    expect(Buffer.from(await res.arrayBuffer())).toEqual(content);
  });

  test("sends a closed range as 206", async () => {
    const res = await get("bytes=0-99");

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-99/1000");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Last-Modified")).not.toBeNull();
    expect(Buffer.from(await res.arrayBuffer())).toEqual(content.subarray(0, 100));
  });

  test("sends an open-ended range to the end", async () => {
    const res = await get("bytes=950-");

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 950-999/1000");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(content.subarray(950));
  });

  test("sends a suffix range as the last bytes", async () => {
    const res = await get("bytes=-10");

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 990-999/1000");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(content.subarray(990));
  });

  test("answers 416 for a range past the end", async () => {
    const res = await get("bytes=5000-");

    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */1000");
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  test("sends the whole file for a range it cannot read", async () => {
    const res = await get("bytes=0-9,20-29");

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(content);
  });

  test("sends the whole file when If-Range names another version", async () => {
    const res = await fetch(`${base}/tune.mp3`, {
      headers: { Range: "bytes=0-99", "If-Range": "Thu, 01 Jan 1970 00:00:00 GMT" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("1000");
    await res.arrayBuffer();
  });

  test("sends the range when If-Range matches the file", async () => {
    const lastModified = (await fetch(`${base}/tune.mp3`, { method: "HEAD" })).headers.get("Last-Modified")!;

    const res = await fetch(`${base}/tune.mp3`, { headers: { Range: "bytes=0-99", "If-Range": lastModified } });

    expect(res.status).toBe(206);
    await res.arrayBuffer();
  });

  test("answers HEAD with the full length and Accept-Ranges", async () => {
    const res = await get(undefined, { method: "HEAD" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Length")).toBe("1000");
  });

  test("ignores Range on HEAD", async () => {
    const res = await fetch(`${base}/tune.mp3`, { method: "HEAD", headers: { Range: "bytes=0-99" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("1000");
  });

  test("leaves responses that are not files alone", async () => {
    const res = await fetch(`${base}/missing.mp3`, { headers: { Range: "bytes=0-1" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBeNull();
    expect(await res.text()).toBe("not a file");
  });
});
