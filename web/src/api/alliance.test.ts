import { afterEach, describe, expect, it, vi } from "vitest";
import { allianceApi, refusalOf } from "./alliance";
import { ApiError, NetworkError } from "./http";

/** The alliance routes (beta 7 phase 1): refusals are answers, never throws. */

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

const calls: Call[] = [];

const stubFetch = (answer: unknown, status = 200): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body === undefined ? "" : String(init.body) });
      return Promise.resolve(new Response(JSON.stringify(answer), { status }));
    }),
  );
};

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("refusalOf", () => {
  it("keeps the server's reason, sentence and wait", () => {
    const caught = new ApiError("Build an Observatory first.", {
      status: 403,
      details: { message: "Build an Observatory first.", status: 403, data: { reason: "noObservatory" } },
    });
    expect(refusalOf(caught)).toEqual({ ok: false, reason: "noObservatory", message: "Build an Observatory first.", availableAt: null });

    const wait = new ApiError("Wait before joining again.", {
      status: 409,
      details: { message: "Wait", status: 409, data: { reason: "rejoinCooldown", available_at: 1_800_000_000 } },
    });
    expect(refusalOf(wait)).toMatchObject({ reason: "rejoinCooldown", availableAt: 1_800_000_000 });
  });

  it("names a refusal without a reason by its status, and 429 as too fast", () => {
    expect(refusalOf(new ApiError("Nope", { status: 500 }))).toMatchObject({ reason: "status500", message: "Nope" });
    const fast = refusalOf(new ApiError("slow down", { status: 429 }));
    expect(fast.reason).toBe("tooFast");
    expect(fast.message).toMatch(/Too many tries/);
  });

  it("says the server could not be reached on a network failure", () => {
    expect(refusalOf(new NetworkError("down", null))).toMatchObject({ reason: "network", message: expect.stringMatching(/reach/) });
    expect(refusalOf(new Error("odd"))).toMatchObject({ reason: "unknown" });
  });
});

describe("allianceApi", () => {
  it("reads myalliance with no alliance and the re-join wait", async () => {
    stubFetch({ error: 0, alliance: null, rejoin_available_at: 1_800_000_000 });
    const answer = await allianceApi.mine();
    expect(calls[0]!.url).toContain("/alliance/myalliance");
    expect(answer).toEqual({ ok: true, alliance: null, rejoinAt: 1_800_000_000 });
  });

  it("searches with the words and page, and keeps the page size", async () => {
    stubFetch({ error: 0, alliances: [], pageSize: 20, totalResults: 3 });
    const answer = await allianceApi.search("goo", 1);
    expect(calls[0]!.url).toContain("/alliance/searchalliances");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toContain("goo");
    expect(answer).toEqual({ ok: true, alliances: [], pageSize: 20, totalResults: 3, myCountry: null });
  });

  it("sends the marketplace filters, and reads the player's country", async () => {
    stubFetch({ error: 0, alliances: [], pageSize: 10, totalResults: 0, my_country: "PH" });
    const answer = await allianceApi.search("", 0, { type: "midas", language: "PH", open: true });
    const body = new URLSearchParams(calls[0]!.body as string);
    expect([body.get("type"), body.get("language"), body.get("open")]).toEqual(["midas", "PH", "true"]);
    expect(answer.ok && answer.myCountry).toBe("PH");
  });

  it("sends the ad with Edit, an unset language or time zone as empty", async () => {
    stubFetch({ error: 0 });
    await allianceApi.edit({ image: 2, description: "Hi", join_mode: "invite", language: null, time_zone: null, min_level: 40 });
    const body = new URLSearchParams(calls[0]!.body as string);
    expect([body.get("join_mode"), body.get("language"), body.get("time_zone"), body.get("min_level")]).toEqual(["invite", "", "", "40"]);
  });

  it("says when Join took the player straight in", async () => {
    stubFetch({ error: 0, joined: true });
    const answer = await allianceApi.requestJoin(5);
    expect(answer).toEqual({ ok: true, joined: true });
  });

  it("answers an invite as accepted or declined", async () => {
    stubFetch({ error: 0 });
    await allianceApi.answerInvite(12, true);
    await allianceApi.answerInvite(13, false);
    expect(calls[0]!.url).toContain("/alliance/changeinvitestatus");
    expect(calls[0]!.body).toContain("accepted");
    expect(calls[1]!.body).toContain("declined");
  });

  it("lifts a member's online out of the server's status", async () => {
    stubFetch({
      error: 0,
      members: [
        { user_id: 1, display_name: "A", status: { online: true, damage_protection: false } },
        { user_id: 2, display_name: "B", status: { online: false, damage_protection: true } },
      ],
    });
    const answer = await allianceApi.members();
    expect(answer.ok && answer.members.map((member) => member.online)).toEqual([true, false]);
  });

  it("turns a refused route into an answer, not a throw", async () => {
    stubFetch(
      { error: "That alliance is full.", errorDetails: { message: "That alliance is full.", status: 409, data: { reason: "allianceFull" } } },
      409,
    );
    const answer = await allianceApi.requestJoin(4);
    expect(answer).toMatchObject({ ok: false, reason: "allianceFull", message: "That alliance is full." });
  });
});
