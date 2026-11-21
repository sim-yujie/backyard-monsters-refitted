import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SERVER_TROUBLE_TEXT, post, postJson, send, setAuthToken } from "./http";

/** The request `send` handed to fetch, flattened to what the assertions need. */
interface Captured {
  url: string;
  method: string;
  contentType: string | null;
  body: string | undefined;
}

let captured: Captured[] = [];

const okResponse = () =>
  new Response(JSON.stringify({ error: 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  captured = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    captured.push({
      url,
      method: init.method ?? "GET",
      contentType: headers.get("Content-Type"),
      body: typeof init.body === "string" ? init.body : undefined,
    });
    return Promise.resolve(okResponse());
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(null);
});

describe("post", () => {
  it("still sends a form-encoded body", async () => {
    await post("/api/:apiVersion/player/getinfo", { email: "a@b.com", password: "pw" });

    expect(captured[0]?.contentType).toBe("application/x-www-form-urlencoded;charset=UTF-8");
    expect(captured[0]?.body).toBe("email=a%40b.com&password=pw");
  });

  it("leaves structure to the caller, stringified into one field", async () => {
    await post("/api/:apiVersion/yardplanner/layouts/10", {
      name: "Main",
      data: JSON.stringify({ version: 2 }),
    });

    expect(captured[0]?.body).toBe("name=Main&data=%7B%22version%22%3A2%7D");
  });
});

describe("postJson", () => {
  it("sends application/json with the object as sent", async () => {
    const payload = { version: 2, expansion: 0, nodes: [{ id: 1, t: 4, x: 10, y: 12 }] };

    await postJson("/api/:apiVersion/yardplanner/apply", { data: payload, startUpgrades: 0 });

    expect(captured[0]?.contentType).toBe("application/json");
    expect(JSON.parse(captured[0]?.body ?? "")).toEqual({ data: payload, startUpgrades: 0 });
  });

  it("carries the Bearer token like every other call", async () => {
    setAuthToken("token-123");
    const seen: string[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("Authorization") ?? "");
      return Promise.resolve(okResponse());
    });

    await postJson("/api/:apiVersion/yardplanner/layouts", {});

    expect(seen[0]).toBe("Bearer token-123");
  });

  it("reports a failure envelope the same way as post", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "That layout could not be read." }), {
          status: 200,
        }),
      ),
    );

    await expect(postJson("/api/:apiVersion/yardplanner/apply", { data: {} })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe("send", () => {
  it("uses the json option on any method", async () => {
    await send("PUT", "/api/:apiVersion/yardplanner/layouts/10", {
      json: { name: "Main", data: { version: 2, expansion: 0, nodes: [] } },
    });

    expect(captured[0]?.method).toBe("PUT");
    expect(captured[0]?.contentType).toBe("application/json");
  });

  it("prefers form when a call passes both, so no existing caller changes encoding", async () => {
    await send("POST", "/api/:apiVersion/player/getinfo", {
      form: { email: "a@b.com" },
      json: { email: "c@d.com" },
    });

    expect(captured[0]?.contentType).toBe("application/x-www-form-urlencoded;charset=UTF-8");
    expect(captured[0]?.body).toBe("email=a%40b.com");
  });

  it("sends no body and no Content-Type when neither is given", async () => {
    await send("GET", "/api/:apiVersion/yardplanner/layouts", { query: { slot: 1 } });

    expect(captured[0]?.contentType).toBeNull();
    expect(captured[0]?.body).toBeUndefined();
    expect(captured[0]?.url).toContain("?slot=1");
  });

  it("sends an empty JSON object as a real body", async () => {
    await send("POST", "/api/:apiVersion/yardplanner/layouts", { json: {} });

    expect(captured[0]?.contentType).toBe("application/json");
    expect(captured[0]?.body).toBe("{}");
  });
});

describe("a failed answer's words (beta 9)", () => {
  const failWith = (body: string, status: number) => {
    vi.stubGlobal("fetch", () => {
      const response = new Response(body, { status });
      Object.defineProperty(response, "url", { value: "http://localhost:5361/worldmapv2/autoattack" });
      return Promise.resolve(response);
    });
  };
  const caught = async (): Promise<ApiError> => {
    try {
      await post("/worldmapv2/autoattack", {});
    } catch (error) {
      return error as ApiError;
    }
    throw new Error("did not fail");
  };

  it("never shows the address to the player when the server says nothing (server down)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    failWith("", 500);
    const error = await caught();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(SERVER_TROUBLE_TEXT);
    expect(error.message).not.toMatch(/http|worldmapv2|Request to/);
    expect(error.status).toBe(500);
    // The address stays for the console and error reports.
    expect(error.url).toBe("http://localhost:5361/worldmapv2/autoattack");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("http://localhost:5361/worldmapv2/autoattack"));
    warn.mockRestore();
  });

  it("never shows a proxy's error page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    failWith("<html><body><h1>502 Bad Gateway</h1></body></html>", 502);
    expect((await caught()).message).toBe(SERVER_TROUBLE_TEXT);
    warn.mockRestore();
  });

  it("keeps the server's own words: a short plain answer, or the envelope's", async () => {
    failWith("Not enough putty.", 400);
    expect((await caught()).message).toBe("Not enough putty.");
    failWith(JSON.stringify({ error: "That camp is gone." }), 200);
    expect((await caught()).message).toBe("That camp is gone.");
  });
});
