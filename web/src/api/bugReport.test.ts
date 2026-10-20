import { afterEach, describe, expect, it, vi } from "vitest";
import { sendBugReport, type BugReportPayload } from "./bugReport";

/** The bug report routes as the form calls them, and how a refusal reads. */

const PAYLOAD: BugReportPayload = {
  message: "Map will not open",
  gameVersion: "2.0.0-beta.4",
  screen: "maproom2",
  device: "computer",
  userAgent: "test",
  screenSize: "1280x720",
  errors: ["one"],
  screenshot: "data:image/jpeg;base64,AAAA",
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

describe("sendBugReport", () => {
  it("posts JSON to the signed-in route, the errors as an array", async () => {
    answer({ error: 0, id: 12, message: "Thanks!" });
    expect(await sendBugReport(PAYLOAD, true)).toEqual({ ok: true, id: 12 });
    expect(calls[0]!.url).toMatch(/\/bugreport$/);
    expect(new Headers(calls[0]!.init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(PAYLOAD);
  });

  it("posts to the guest route when signed out", async () => {
    answer({ error: 0, id: 3 });
    await sendBugReport({ ...PAYLOAD, email: "a@b.co", turnstileToken: "t" }, false);
    expect(calls[0]!.url).toMatch(/\/bugreport\/guest$/);
  });

  it("reads the daily cap as a limit, with the server's words", async () => {
    answer(
      { errorDetails: { message: "You can send 5 a day, so please try again tomorrow.", status: 429, data: { reason: "bugReportLimit" } } },
      429,
    );
    expect(await sendBugReport(PAYLOAD, true)).toEqual({
      ok: false,
      message: "You can send 5 a day, so please try again tomorrow.",
      limit: true,
      botCheck: false,
    });
  });

  it("reads the hourly limiter's answer as a limit too", async () => {
    answer({ error: "You have sent a lot of reports.", message: "You have sent a lot of reports.", reason: "bugReportLimit" }, 429);
    expect(await sendBugReport(PAYLOAD, true)).toMatchObject({ ok: false, limit: true });
  });

  it("marks a failed person check", async () => {
    answer({ errorDetails: { message: "We couldn't confirm you're a person.", status: 400, data: { reason: "botCheckFailed" } } }, 400);
    expect(await sendBugReport(PAYLOAD, false)).toMatchObject({ ok: false, botCheck: true, limit: false });
  });

  it("says when the server could not be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    expect(await sendBugReport(PAYLOAD, true)).toMatchObject({ ok: false, message: expect.stringContaining("Couldn't reach") });
  });

  it("says the pictures are too big when the server refuses the body's size", async () => {
    answer("Payload Too Large", 413);
    expect(await sendBugReport(PAYLOAD, true)).toMatchObject({ ok: false, message: expect.stringContaining("too big") });
  });
});
