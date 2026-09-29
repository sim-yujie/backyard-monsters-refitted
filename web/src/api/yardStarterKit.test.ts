import { afterEach, describe, expect, it, vi } from "vitest";
import type { YardApi } from "./yard";
import { buyStarterKit, starterKitActions } from "./yardStarterKit";
import type { YardStore } from "@/game/yard/YardStore";

/** `POST /bm/yard/starterkit` (outposts WP9, #188): the wire and the queue. */

const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(
        new Response(JSON.stringify({ error: 0, savetime: 1, currenttime: 1, completed: [], report: null }), {
          status: 200,
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

describe("buyStarterKit", () => {
  it("posts the kit, the payment, an agreed top-up and the outpost", async () => {
    stubFetch();
    await buyStarterKit(1, "resources", 138, "2000242209");
    await buyStarterKit(3, "shiny", undefined, "2000242209");

    expect(sent[0]!.url).toMatch(/\/bm\/yard\/starterkit$/);
    expect(Object.fromEntries(sent[0]!.body)).toEqual({
      kit: "1",
      pay: "resources",
      topUp: "138",
      baseid: "2000242209",
    });
    expect(Object.fromEntries(sent[1]!.body)).toEqual({ kit: "3", pay: "shiny", baseid: "2000242209" });
  });
});

describe("starterKitActions", () => {
  const storeOf = (kind: "main" | "outpost", baseid?: string) => {
    const run = vi.fn(
      (action: {
        check?: (reader: unknown) => unknown;
        send: (api: YardApi, ...yard: [] | [string]) => Promise<unknown>;
      }) => {
        const refusal = action.check?.({ kind });
        if (refusal) return Promise.resolve({ ok: false, refusal });
        void action.send({} as YardApi, ...((baseid ? [baseid] : []) as [] | [string]));
        return Promise.resolve({ ok: true, report: null, completed: [] });
      },
    );
    return { store: { run } as unknown as YardStore, run };
  };

  it("sends through the queue for the outpost the store names", async () => {
    const send = vi.fn(() => Promise.resolve({} as never));
    const { store } = storeOf("outpost", "2000242209");
    await starterKitActions(store, send).buy(2, "resources", 12);
    expect(send).toHaveBeenCalledWith(2, "resources", 12, "2000242209");
  });

  it("refuses on the main yard before sending", async () => {
    const send = vi.fn();
    const { store } = storeOf("main");
    const result = await starterKitActions(store, send).buy(1, "shiny");
    expect(result).toMatchObject({ ok: false, refusal: { reason: "notOutpost" } });
    expect(send).not.toHaveBeenCalled();
  });
});
