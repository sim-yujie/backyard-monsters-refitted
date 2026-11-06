import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSignUpOptions, logout } from "./auth";
import { getAuthToken, setAuthToken } from "./http";

/** What the sign-up form may offer (issue #217), over a stubbed fetch. */

const answer = (status: number, body: unknown) => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  return urls;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSignUpOptions", () => {
  it("asks the sign-up options route and passes on the test yard offer", async () => {
    const urls = answer(200, { sandboxStart: true });
    expect(await fetchSignUpOptions()).toEqual({ sandboxStart: true });
    expect(urls[0]).toMatch(/\/api\/[^/]+\/player\/signupoptions$/);
  });

  it("takes anything but a plain true as no offer", async () => {
    answer(200, { sandboxStart: "true" });
    expect(await fetchSignUpOptions()).toEqual({ sandboxStart: false });
  });

  it("counts a refusal, such as an older server without the route, as no offer", async () => {
    answer(404, { error: "Not Found" });
    expect(await fetchSignUpOptions()).toEqual({ sandboxStart: false });
  });

  it("counts an unreachable server as no offer", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    expect(await fetchSignUpOptions()).toEqual({ sandboxStart: false });
  });
});

describe("logout (security audit 2026-10-29, L4)", () => {
  it("asks the server to end the session with its token, and forgets it here", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ error: 0 }), { status: 200 }));
    });
    setAuthToken("the-token");

    logout();

    expect(getAuthToken()).toBeNull();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toMatch(/\/api\/[^/]+\/player\/logout$/);
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("Authorization")).toBe("Bearer the-token");
  });

  it("signs out here even when the server cannot be reached", () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    setAuthToken("the-token");

    expect(() => logout()).not.toThrow();
    expect(getAuthToken()).toBeNull();
  });

  it("sends nothing when there is no session", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    setAuthToken(null);

    logout();

    expect(fetch).not.toHaveBeenCalled();
  });
});
