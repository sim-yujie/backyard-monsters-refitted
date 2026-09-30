import { afterEach, describe, expect, it, vi } from "vitest";
import { mailApi } from "./mail";

/** The mail routes as the mailbox calls them (#193). */

interface Call {
  url: string;
  method: string;
  body: URLSearchParams;
}

const calls: Call[] = [];

const stubFetch = (answer: unknown, status = 200): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: new URLSearchParams(String(init.body ?? "")) });
      return Promise.resolve(new Response(JSON.stringify(answer), { status }));
    }),
  );
};

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("mailApi", () => {
  it("reads the thread list and the names from their GET routes", async () => {
    stubFetch({ error: 0, threads: { "7": { threadid: 7, subject: "a" }, "9": { threadid: 9, subject: "b" } } });
    expect((await mailApi.threads()).map((one) => one.threadid)).toEqual([7, 9]);
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0]?.url).toMatch(/\/player\/getmessagethreads$/);

    stubFetch({ targets: { "77": { first_name: "Bramblefoot" } } });
    expect(await mailApi.targets()).toEqual({ "77": { first_name: "Bramblefoot" } });
  });

  it("reads a thread in the server's order, by position", async () => {
    stubFetch({ error: 0, thread: { "1": { message: "second" }, "0": { message: "first" }, "10": { message: "last" } } });
    const thread = await mailApi.thread(12);
    expect(thread.map((one) => one.message)).toEqual(["first", "second", "last"]);
    expect(calls[0]?.body.get("threadid")).toBe("12");
  });

  it("sends a message with every field the route asks for", async () => {
    stubFetch({ error: 0, messageid: 0, threadid: 41 });
    const result = await mailApi.send({ threadid: 0, targetid: 77, subject: "Hi", message: "Hello" });
    expect(result).toEqual({ ok: true, threadid: 41 });
    const body = calls[0]!.body;
    expect(Object.fromEntries(body)).toEqual({
      threadid: "0",
      targetid: "77",
      subject: "Hi",
      message: "Hello",
      type: "message",
      targetbaseid: "0",
    });
  });

  it("reads the server's soft refusal, and says so plainly when it has none", async () => {
    stubFetch({ error: 1, message: "Cannot send message to this user" });
    expect(await mailApi.send({ threadid: 3, targetid: 77, subject: "s", message: "m" })).toEqual({
      ok: false,
      reason: "Cannot send message to this user",
    });
    stubFetch({ error: 1 });
    const plain = await mailApi.send({ threadid: 3, targetid: 0, subject: "s", message: "m" });
    expect(plain.ok).toBe(false);
  });

  it("says the server could not be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    expect(await mailApi.send({ threadid: 3, targetid: 77, subject: "s", message: "m" })).toEqual({
      ok: false,
      reason: "Could not reach the server. Try again.",
    });
  });

  it("blocks through the report route", async () => {
    stubFetch({ error: 0 });
    await mailApi.block(5);
    expect(calls[0]?.url).toMatch(/\/player\/reportmessagethread$/);
    expect(Object.fromEntries(calls[0]!.body)).toEqual({ threadid: "5", reason: "block" });
  });

  it("sends an invitation to move with its outpost (#205)", async () => {
    stubFetch({ error: 0, messageid: 0, threadid: 8 });
    await mailApi.send({ threadid: 0, targetid: 77, subject: "s", message: "m", type: "migraterequest", baseid: "2000241208" });
    expect(Object.fromEntries(calls[0]!.body)).toMatchObject({ type: "migraterequest", baseid: "2000241208" });
  });

  it("accepts an invitation with the price button pressed, and answers the new cell (#205)", async () => {
    stubFetch({ error: 0, coords: [241, 208] });
    expect(await mailApi.acceptInvite(8, "shiny")).toEqual({ ok: true, coords: [241, 208] });
    expect(calls[0]?.url).toMatch(/\/base\/migratetofriend$/);
    expect(Object.fromEntries(calls[0]!.body)).toEqual({ threadid: "8", shiny: "1" });

    stubFetch({ error: 1, message: "You don't have enough resources to relocate.", reason: "notEnoughResources" });
    expect(await mailApi.acceptInvite(8, "resources")).toEqual({
      ok: false,
      reason: "You don't have enough resources to relocate.",
    });
    expect(calls[1]?.body.get("shiny")).toBe("0");
  });

  it("declines an invitation, and reads a refusal the server words (#205)", async () => {
    stubFetch({ error: 0 });
    expect(await mailApi.declineInvite(8)).toEqual({ ok: true, coords: null });
    expect(calls[0]?.url).toMatch(/\/base\/rejectmigratetofriend$/);

    stubFetch({ error: "This invitation can no longer be answered." }, 409);
    const refused = await mailApi.declineInvite(8);
    expect(refused.ok).toBe(false);
  });
});
