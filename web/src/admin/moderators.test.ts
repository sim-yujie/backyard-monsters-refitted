// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { ModeratorView } from "./api";
import { ModeratorsView } from "./moderators";

/**
 * The Moderators section: the list, adding by name or account number (the
 * server's refusal shown under the box), and Remove.
 */

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
let answers: Record<string, [number, unknown]> = {};

const helper: ModeratorView = {
  userid: 2503,
  username: "yardtester",
  addedBy: 9,
  addedByName: "Owner",
  addedAt: "2026-11-07T09:00:00.000Z",
};
const another: ModeratorView = { ...helper, userid: 30, username: "Alpha" };

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  calls = [];
  answers = { "GET /admin/moderators": [200, { error: 0, moderators: [helper] }] };
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

const mount = async () => {
  const said: string[] = [];
  const view = new ModeratorsView({ say: (message) => said.push(message) });
  document.body.append(view.element);
  await view.refresh();
  return { view, said };
};

const names = (view: ModeratorsView) =>
  [...view.element.querySelectorAll(".moderator-row .row-title")].map((title) => title.textContent);

const submit = async (view: ModeratorsView, text: string) => {
  view.element.querySelector<HTMLInputElement>("#moderator-player")!.value = text;
  view.element.querySelector<HTMLFormElement>("form")!.requestSubmit();
  await settle();
};

describe("the Moderators section", () => {
  it("lists the moderators with a Mod chip, who added them and their account number", async () => {
    const { view } = await mount();
    expect(names(view)).toEqual(["Modyardtester"]);
    expect(view.element.querySelector(".moderator-row .row-meta")?.textContent).toMatch(/^#2503 · added .* · by Owner$/);
  });

  it("says so when there are none", async () => {
    answers["GET /admin/moderators"] = [200, { error: 0, moderators: [] }];
    const { view } = await mount();
    expect(view.element.querySelector(".moderator-list")?.textContent).toBe("No moderators yet.");
  });

  it("adds a player typed in the box and keeps the list in name order", async () => {
    answers["POST /admin/moderators"] = [200, { error: 0, moderator: another }];
    const { view, said } = await mount();
    await submit(view, "  alpha ");
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: { player: "alpha" } });
    expect(calls.at(-1)!.path).toMatch(/\/admin\/moderators$/);
    expect(names(view)).toEqual(["ModAlpha", "Modyardtester"]);
    expect(view.element.querySelector<HTMLInputElement>("#moderator-player")!.value).toBe("");
    expect(said).toEqual(["Alpha is now a moderator"]);
  });

  it("shows the server's words when a name is unknown, and keeps what was typed", async () => {
    answers["POST /admin/moderators"] = [
      400,
      { error: "There is no player with that name or account number.", reason: "noPlayer" },
    ];
    const { view } = await mount();
    await submit(view, "nobody");
    const problem = view.element.querySelector<HTMLElement>("#moderator-problem")!;
    expect(problem.hidden).toBe(false);
    expect(problem.textContent).toBe("There is no player with that name or account number.");
    expect(view.element.querySelector<HTMLInputElement>("#moderator-player")!.value).toBe("nobody");
    expect(names(view)).toEqual(["Modyardtester"]);
  });

  it("asks for a name before sending an empty box", async () => {
    const { view } = await mount();
    await submit(view, "   ");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(view.element.querySelector("#moderator-problem")?.textContent).toBe("Type a player's name or account number.");
  });

  it("Remove takes a moderator off the list", async () => {
    answers["POST /admin/moderators/2503/remove"] = [200, { error: 0, removed: 2503 }];
    const { view, said } = await mount();
    view.element.querySelector<HTMLButtonElement>(".moderator-row button")!.click();
    await settle();
    expect(calls.at(-1)!.method).toBe("POST");
    expect(calls.at(-1)!.path).toMatch(/\/admin\/moderators\/2503\/remove$/);
    expect(view.element.querySelector(".moderator-list")?.textContent).toBe("No moderators yet.");
    expect(said).toEqual(["yardtester is no longer a moderator"]);
  });
});
