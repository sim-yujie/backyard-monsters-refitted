import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "./http";
import {
  cancelUpgrade,
  instantUpgrade,
  shopBuy,
  speedUp,
  startUpgrade,
  yardRefusal,
  yardState,
} from "./yard";

/** What the server was sent, and a canned answer or refusal. */
const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (status: number, payload: Record<string, unknown>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("yard routes", () => {
  it("posts each action to its path with plain form fields", async () => {
    stubFetch(200, { error: 0, savetime: 1, currenttime: 1, completed: [], report: null });
    await yardState();
    await startUpgrade(12);
    await cancelUpgrade(12);
    await instantUpgrade(12);
    await speedUp(12, "SP2");
    await shopBuy("BST");

    expect(sent.map((call) => call.url.replace(/^.*\/bm\/yard/, ""))).toEqual([
      "/state",
      "/upgrade",
      "/upgrade/cancel",
      "/upgrade/instant",
      "/speedup",
      "/shop/buy",
    ]);
    expect(sent[1]!.body.get("id")).toBe("12");
    expect(sent[4]!.body.get("item")).toBe("SP2");
    expect(sent[5]!.body.get("item")).toBe("BST");
  });

  it("throws a refusal that yardRefusal reads back into reason and detail", async () => {
    stubFetch(409, {
      error: "All 2 workers are busy.",
      reason: "workers",
      workers: { total: 2, busy: 2 },
    });
    const caught = await startUpgrade(12).catch((error: unknown) => error);
    expect(yardRefusal(caught)).toEqual({
      reason: "workers",
      message: "All 2 workers are busy.",
      detail: { workers: { total: 2, busy: 2 } },
      status: 409,
    });
  });
});

describe("yardRefusal", () => {
  it("names a network failure, an auth failure and anything else", () => {
    expect(yardRefusal(new NetworkError("down", null)).reason).toBe("network");
    expect(yardRefusal(new ApiError("Unauthorized", { status: 401 })).reason).toBe("auth");
    expect(yardRefusal(new ApiError("Server Error", { status: 500, body: "x" }))).toEqual({
      reason: "error",
      message: "Server Error",
      detail: {},
      status: 500,
    });
    expect(yardRefusal(new Error("odd")).reason).toBe("error");
  });
});
