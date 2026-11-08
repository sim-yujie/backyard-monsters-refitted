import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./http";
import { photoUrl, reportPhoto, uploadPhoto } from "./profile";

afterEach(() => {
  vi.unstubAllGlobals();
});

const answer = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("profile api", () => {
  it("sends the photo as a JSON body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer({ error: 0, profile: { userid: 1 } });
    });
    await uploadPhoto("data:image/jpeg;base64,AAAA");
    expect(calls[0]?.url).toMatch(/\/bm\/profile\/photo$/);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ photo: "data:image/jpeg;base64,AAAA" });
  });

  it("turns a refusal into an ApiError with the server's words", async () => {
    vi.stubGlobal("fetch", () =>
      answer({ error: "You can change your photo once a day.", reason: "tooSoon" }, 409),
    );
    const caught = await uploadPhoto("data:image/jpeg;base64,AAAA").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toBe("You can change your photo once a day.");
    expect((caught as ApiError).isAuthFailure).toBe(false);
  });

  it("reports by user id and reads `already`", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      return answer({ error: 0, reported: true, already: true });
    });
    expect(await reportPhoto(77)).toBe(true);
    expect(calls[0]).toMatch(/\/bm\/profile\/77\/report$/);
  });

  it("builds a versioned photo address", () => {
    expect(photoUrl(5, 3)).toMatch(/\/profile\/photos\/5\?v=3$/);
  });
});
