import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "@/game/combat/rules/MANIFEST.json";
import { runAutoAttack } from "./autoAttack";
import { ApiError } from "./http";
import { startDescentAttack, startPlayerAttack, startTribeAttack } from "./inferno";
import { isNewVersionRefusal, onNewVersionRefusal, RULES_STAMP, startStamped } from "./rulesStamp";

/**
 * The battle-rules stamp (owner's fix 1, Desk 8, 23 Nov 2026): every attack
 * start sends this page's rules version, and the server's "New version"
 * refusal reaches the card wherever the start came from.
 */

const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (answer: Record<string, unknown> = { error: 0 }): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body)) });
      return Promise.resolve(
        new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

const refusal = (reason: string): ApiError =>
  new ApiError("New version — reload the page.", {
    status: 409,
    details: { status: 409, message: "New version — reload the page.", data: { reason } },
  });

describe("the stamp", () => {
  it("is the combat rules MANIFEST's version, not the game version", () => {
    expect(RULES_STAMP).toBe(manifest.version);
    expect(RULES_STAMP).toMatch(/^[0-9a-f]{16}$/);
  });

  it("goes with every Inferno attack start and with Repeat attack", async () => {
    stubFetch();
    await startDescentAttack("201");
    await startTribeAttack("3001");
    await startPlayerAttack("1200");
    await runAutoAttack("21970243208");
    await runAutoAttack("21970243208", "moves-key");
    expect(sent.map((call) => call.body.get("rules"))).toEqual(Array(5).fill(RULES_STAMP));
    expect(sent[4]!.body.get("moves")).toBe("moves-key");
  });
});

describe("the server's New version refusal", () => {
  it("is told apart from every other refusal", () => {
    expect(isNewVersionRefusal(refusal("newVersion"))).toBe(true);
    expect(isNewVersionRefusal(refusal("outOfRange"))).toBe(false);
    expect(isNewVersionRefusal(new Error("New version"))).toBe(false);
  });

  it("calls the listeners once, then rethrows; another refusal calls none", async () => {
    const heard = vi.fn();
    const stop = onNewVersionRefusal(heard);
    await expect(startStamped(Promise.reject(refusal("newVersion")))).rejects.toThrow("New version");
    await expect(startStamped(Promise.reject(refusal("protected")))).rejects.toThrow();
    await expect(startStamped(Promise.resolve(7))).resolves.toBe(7);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    await expect(startStamped(Promise.reject(refusal("newVersion")))).rejects.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("reaches the listener from a real start the server refused", async () => {
    stubFetch({
      error: "New version — reload the page.",
      errorDetails: { status: 409, message: "New version — reload the page.", data: { reason: "newVersion" } },
    });
    const heard = vi.fn();
    const stop = onNewVersionRefusal(heard);
    await expect(startDescentAttack("201")).rejects.toBeInstanceOf(ApiError);
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
