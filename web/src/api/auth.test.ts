import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSignUpOptions } from "./auth";

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
