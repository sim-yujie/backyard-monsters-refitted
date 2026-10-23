import { afterEach, describe, expect, it, vi } from "vitest";
import { sendClientErrors, type ClientErrorBatch } from "./clientErrors";

/** The browser error routes, and which answers mean "stop sending". */

const BATCH: ClientErrorBatch = {
  errors: [{ kind: "error", message: "boom", place: "/static/a.js:1:2", stack: "", count: 2 }],
  gameVersion: "2.0.0-beta.4",
  screen: "yard",
};

const calls: { url: string; init: RequestInit }[] = [];

const answer = (body: unknown, status = 200): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
};

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("sendClientErrors", () => {
  it("posts the batch as JSON to the signed-in or the guest route", async () => {
    answer({ error: 0, kept: 1 });
    expect(await sendClientErrors(BATCH, true)).toBe("sent");
    expect(await sendClientErrors(BATCH, false)).toBe("sent");
    expect(calls[0]!.url).toMatch(/\/api\/[^/]+\/clienterrors$/);
    expect(calls[1]!.url).toMatch(/\/api\/[^/]+\/clienterrors\/guest$/);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(BATCH);
  });

  it("too many, signed out or no such route: stop", async () => {
    for (const status of [429, 401, 404]) {
      answer({ error: "no" }, status);
      expect(await sendClientErrors(BATCH, true)).toBe("stop");
    }
  });

  it("a server error or no connection: failed", async () => {
    answer({ error: "boom" }, 500);
    expect(await sendClientErrors(BATCH, true)).toBe("failed");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    expect(await sendClientErrors(BATCH, true)).toBe("failed");
  });
});
