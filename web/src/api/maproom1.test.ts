import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./http";
import { loadMapRoom1, mapRoom1Refusal, NOT_MAP_ROOM_1 } from "./maproom1";
import { mapRoom1Fixture } from "@/game/maproom1/mr1Fixture";

const calls: { url: string; method: string | undefined }[] = [];

const stubFetch = (status: number, payload: Record<string, unknown>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, method: init.method });
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
  calls.length = 0;
});

describe("loadMapRoom1", () => {
  it("reads the whole screen in one GET", async () => {
    stubFetch(200, mapRoom1Fixture(1_800_000_000));
    const response = await loadMapRoom1();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toMatch(/\/api\/[^/]+\/bm\/maproom1$/);
    expect(response.tribes).toHaveLength(4);
    expect(response.neighbours?.[0]?.username).toBe("Mossbeard");
  });

  it("raises the server's refusal with its reason", async () => {
    stubFetch(409, {
      error: "Not on Map Room 1",
      errorDetails: { status: 409, data: { reason: "notMapRoom1" } },
    });
    const caught = await loadMapRoom1().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(mapRoom1Refusal(caught)).toBe(NOT_MAP_ROOM_1);
    expect(mapRoom1Refusal(new Error("x"))).toBeNull();
  });
});
