// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Every API request names this page's build as `pb` (beta 10, owner's pick
 * B+), so the server's request log can count tabs still on an old page after
 * a release (`server/src/middleware/pageBuild.ts`).
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.head.innerHTML = "";
});

const urlsSent = async (): Promise<string[]> => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ error: 0 }), { headers: { "Content-Type": "application/json" } });
  });
  const { get, post } = await import("./http");
  await post("/api/:apiVersion/bm/presence", { a: "1" });
  await get("/api/:apiVersion/bm/thing", { q: "x y" });
  return urls;
};

describe("the page build on requests", () => {
  it("rides on every request of a built page, after any query of its own", async () => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/static/index-D4xk2_-9.js";
    document.head.append(script);

    const [posted, got] = await urlsSent();
    expect(new URL(posted!, "https://x").searchParams.get("pb")).toBe("D4xk2_-9");
    expect(new URL(got!, "https://x").searchParams.get("pb")).toBe("D4xk2_-9");
    expect(new URL(got!, "https://x").searchParams.get("q")).toBe("x y");
  });

  it("is left off in a development page, which has no built bundle", async () => {
    const urls = await urlsSent();
    for (const url of urls) expect(url).not.toContain("pb=");
  });
});
