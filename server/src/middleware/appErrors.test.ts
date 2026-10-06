import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import Koa from "koa";

/**
 * A client that leaves mid-response is not an error worth a stack trace
 * (issue #274); every other error Koa reports still is.
 */

const debug = mock((..._args: unknown[]) => {});
const error = mock((..._args: unknown[]) => {});
mock.module("../utils/logger.js", () => ({
  logger: { debug, error, warn: mock(() => {}), info: mock(() => {}) },
}));

const { onAppError } = await import("./appErrors.js");

const ctx = { method: "GET", path: "/assets/sprites/pokey.png" } as never;

beforeEach(() => {
  debug.mockClear();
  error.mockClear();
});

describe("onAppError", () => {
  test("a premature close is logged at debug, with the request", () => {
    const err = Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    onAppError(err, ctx);
    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0]![1]).toMatchObject({ method: "GET", path: "/assets/sprites/pokey.png" });
  });

  test("a reset or broken pipe is the client leaving too", () => {
    for (const code of ["ECONNRESET", "EPIPE", "ECONNABORTED"]) {
      onAppError(Object.assign(new Error("socket gone"), { code }), ctx);
    }
    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(3);
  });

  test("any other error is still logged as one", () => {
    onAppError(new Error("disk on fire"), ctx);
    expect(error).toHaveBeenCalledTimes(1);
    expect(debug).not.toHaveBeenCalled();
  });

  test("a 404 or an error meant for the client is not logged, as with Koa's default", () => {
    onAppError(Object.assign(new Error("Not Found"), { status: 404 }), ctx);
    onAppError(Object.assign(new Error("Bad JSON"), { status: 400, expose: true }), ctx);
    expect(error).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  test("a client that aborts a streamed body mid-download lands at debug, not as an error", async () => {
    const app = new Koa();
    app.on("error", onAppError);
    let pushes = 0;
    app.use((context) => {
      // A body that keeps streaming, as a large static file does.
      context.body = new Readable({
        read() {
          pushes++;
          setTimeout(() => this.push(Buffer.alloc(64 * 1024, 1)), 5);
        },
      });
    });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const aborter = new AbortController();
      const response = await fetch(`http://127.0.0.1:${port}/big.bin`, { signal: aborter.signal });
      const reader = response.body!.getReader();
      await reader.read();
      aborter.abort();
      await reader.read().catch(() => {});
      for (let waited = 0; waited < 2_000 && debug.mock.calls.length === 0; waited += 20) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      server.close();
    }
    expect(pushes).toBeGreaterThan(0);
    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalled();
    expect(debug.mock.calls[0]![1]).toMatchObject({ method: "GET", path: "/big.bin" });
  });
});
