// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { ModStepView } from "./api";
import { ModStepsView, stepWords } from "./modSteps";

/**
 * Moderators' bans and mutes under the Moderators list: each row says who,
 * what, why and what became of it; Undo and Make permanent show only while
 * a step is on, ask first, and are the dashboard's own player steps.
 */

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
let answers: Record<string, [number, unknown]> = {};

const banOn: ModStepView = {
  id: 41,
  userid: 900,
  username: "Spammer",
  moderatorId: 30,
  moderatorName: "ModBob",
  kind: "ban",
  reason: "Advertising another server",
  length: 3,
  until: "2026-11-27T12:00:00.000Z",
  at: "2026-11-24T12:00:00.000Z",
  state: "on",
  laterByName: null,
  laterAt: null,
};
const muteOn: ModStepView = { ...banOn, id: 40, userid: 901, username: "Loud", kind: "mute", length: 24, reason: "Insults" };
const undone: ModStepView = { ...banOn, id: 39, userid: 902, username: "Old", state: "undone", laterByName: "Owner", laterAt: "2026-11-24T13:00:00.000Z" };

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  calls = [];
  answers = {
    "GET /admin/modsteps": [200, { error: 0, steps: [banOn, muteOn, undone], nextOffset: null }],
    "POST /players/900/unban": [200, { error: 0, player: {} }],
    "POST /players/900/ban": [200, { error: 0, player: {} }],
    "POST /players/901/unmute": [200, { error: 0, player: {} }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url, "http://localhost");
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, path: parsed.pathname, body });
      const key = Object.keys(answers).find((k) => {
        const [m, end] = k.split(" ");
        return m === method && parsed.pathname.endsWith(end!);
      });
      if (key === undefined) return new Response("Not Found", { status: 404 });
      const [status, answer] = answers[key]!;
      return Response.json(answer, { status });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const mount = async (confirm: (q: string) => boolean = () => true) => {
  const said: string[] = [];
  const asked: string[] = [];
  const view = new ModStepsView({
    say: (message) => said.push(message),
    confirm: (q) => (asked.push(q), confirm(q)),
  });
  document.body.append(view.element);
  await view.refresh();
  return { view, said, asked };
};

const rows = (view: ModStepsView) => [...view.element.querySelectorAll<HTMLElement>(".mod-step-row")];
const buttons = (row: HTMLElement) => [...row.querySelectorAll("button")].map((b) => b.textContent);

describe("moderators' bans and mutes", () => {
  it("lists each step with who, what, why and its state", async () => {
    const { view } = await mount();
    const [ban, mute, old] = rows(view);
    expect(ban!.textContent).toContain("Spammer");
    expect(ban!.textContent).toContain("Banned 3 days");
    expect(ban!.textContent).toContain("Reason: Advertising another server");
    expect(ban!.textContent).toContain("by ModBob");
    expect(mute!.textContent).toContain("Chat muted 1 day");
    expect(old!.textContent).toContain("Undone");
    expect(old!.textContent).toContain("by Owner");
    expect(ban!.querySelector("a")!.getAttribute("href")).toBe("#moderation?player=900");
  });

  it("offers Undo and Make permanent on a ban that is on, Undo only on a mute, nothing on a finished one", async () => {
    const { view } = await mount();
    const [ban, mute, old] = rows(view);
    expect(buttons(ban!)).toEqual(["Undo", "Make permanent"]);
    expect(buttons(mute!)).toEqual(["Undo"]);
    expect(buttons(old!)).toEqual([]);
  });

  it("Undo lifts the ban after asking; Make permanent bans for good with the same reason", async () => {
    const { view, said, asked } = await mount();
    rows(view)[0]!.querySelectorAll("button")[0]!.click();
    await settle();
    expect(asked[0]).toBe("Lift Spammer's ban now?");
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: expect.stringMatching(/\/players\/900\/unban$/) });
    expect(said).toContain("Spammer's ban is lifted");

    calls = [];
    rows(view)[0]!.querySelectorAll("button")[1]!.click();
    await settle();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toMatch(/\/players\/900\/ban$/);
    expect(post.body).toEqual({ reason: "Advertising another server", days: null });
  });

  it("does nothing when the owner says no", async () => {
    const { view } = await mount(() => false);
    rows(view)[1]!.querySelector("button")!.click();
    await settle();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("says when there are none", async () => {
    answers["GET /admin/modsteps"] = [200, { error: 0, steps: [], nextOffset: null }];
    const { view } = await mount();
    expect(view.element.textContent).toContain("No bans or mutes by moderators yet.");
    expect(view.element.textContent).not.toContain("Show older");
  });

  it("Show older only while there are older steps, and it adds them", async () => {
    answers["GET /admin/modsteps"] = [200, { error: 0, steps: [banOn], nextOffset: 30 }];
    const { view } = await mount();
    const more = [...view.element.querySelectorAll("button")].find((b) => b.textContent === "Show older")!;
    answers["GET /admin/modsteps"] = [200, { error: 0, steps: [undone], nextOffset: null }];
    more.click();
    await settle();
    expect(rows(view)).toHaveLength(2);
    expect(view.element.textContent).not.toContain("Show older");
  });

  it("words for lengths", () => {
    expect(stepWords({ ...muteOn, length: 1 })).toBe("Chat muted 1 hour");
    expect(stepWords({ ...muteOn, length: 168 })).toBe("Chat muted 7 days");
    expect(stepWords({ ...banOn, length: 1 })).toBe("Banned 1 day");
  });
});
