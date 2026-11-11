// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { CheatEntry, CheatPlayer } from "./api";
import { FlaggedSection, fieldWord, yardName } from "./flagged";

/**
 * The Flagged list: one row per player, newest first, with refused fight and
 * economy saves as counted chips, what did not match in plain words, the
 * yards by their owner's name (bots marked), and every entry loaded when a
 * row opens. Read-only: it only ever sends GETs.
 */

interface Call {
  method: string;
  path: string;
}

let calls: Call[] = [];
let answers: Record<string, [number, unknown]> = {};

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const bluetenit = (over: Partial<CheatPlayer> = {}): CheatPlayer => ({
  userid: 552,
  username: "Bluetenit",
  banned: false,
  gone: false,
  violations: 3,
  attackViolations: 0,
  counts: { fight: { refused: 3, flagged: 0 }, economy: { refused: 0, flagged: 0 }, attack: 0, other: 0 },
  fields: [
    { name: "buildinghealthdata", count: 3 },
    { name: "attackloot", count: 2 },
    { name: "damage", count: 2 },
    { name: "attackerchampion", count: 1 },
  ],
  yards: [
    { baseid: "201", type: "main", owner: { userid: 201, username: "yardlord", bot: true }, count: 1 },
    { baseid: "202", type: "main", owner: { userid: 202, username: "DarkGecko", bot: true }, count: 1 },
    { baseid: "999", type: null, owner: null, count: 1 },
  ],
  first: ago(600),
  last: ago(5),
  entries: 3,
  banReason: null,
  ...over,
});

const saver: CheatPlayer = bluetenit({
  userid: 77,
  username: "Saver",
  counts: { fight: { refused: 0, flagged: 0 }, economy: { refused: 1, flagged: 2 }, attack: 1, other: 0 },
  fields: [{ name: "overCap", count: 3 }],
  yards: [{ baseid: "1300", type: "main", owner: { userid: 77, username: "Saver", bot: false }, count: 3 }],
  banned: true,
  last: ago(90),
});

const entry = (over: Partial<CheatEntry> = {}): CheatEntry => ({
  time: ago(5),
  kind: "fight",
  outcome: "refused",
  fields: ["damage", "buildinghealthdata", "attackloot"],
  baseid: "201",
  message: "Attack save on base 201 rejected (reject): disagrees with the replay on damage, buildinghealthdata, attackloot",
  yard: { baseid: "201", type: "main", owner: { userid: 201, username: "yardlord", bot: true } },
  ...over,
});

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 9 }));
  calls = [];
  answers = {
    "GET /admin/flagged": [200, { error: 0, players: [bluetenit(), saver] }],
    "GET /admin/flagged/552": [
      200,
      {
        error: 0,
        player: bluetenit(),
        history: [
          entry(),
          entry({
            time: ago(400),
            outcome: "flagged",
            fields: ["attackerchampion"],
            baseid: "999",
            yard: { baseid: "999", type: null, owner: null },
            message: "Attack save on base 999 flagged (log): disagrees with the replay on attackerchampion",
          }),
        ],
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url, "http://localhost");
      const method = init.method ?? "GET";
      calls.push({ method, path: parsed.pathname });
      const key = Object.keys(answers)
        .filter((k) => {
          const [m, end] = k.split(" ");
          return m === method && parsed.pathname.endsWith(end!);
        })
        .sort((a, b) => b.length - a.length)[0];
      if (key === undefined) return new Response("Not Found", { status: 404 });
      const [status, body] = answers[key]!;
      return Response.json(body, { status });
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
  const opened: number[] = [];
  const attackLogs: number[] = [];
  const view = new FlaggedSection({
    say: () => undefined,
    openPlayer: (userid) => opened.push(userid),
    openAttacks: (userid) => attackLogs.push(userid),
  });
  document.body.append(view.element);
  await view.refresh();
  await settle();
  return { view, opened, attackLogs };
};

describe("fieldWord and yardName", () => {
  it("puts the fight's fields in plain words and splits an economy rule", () => {
    expect(fieldWord("buildinghealthdata")).toBe("Building health");
    expect(fieldWord("attackloot")).toBe("Loot");
    expect(fieldWord("attackerchampion")).toBe("Champion HP");
    expect(fieldWord("overCap")).toBe("Over cap");
    expect(fieldWord("basevalueMismatch")).toBe("Basevalue mismatch");
  });

  it("names a yard by its owner, or by its base id when it is gone", () => {
    expect(yardName({ baseid: "201", type: "main", owner: { userid: 201, username: "yardlord", bot: true } })).toBe("yardlord");
    expect(yardName({ baseid: "999", type: null, owner: null })).toBe("base 999");
  });
});

describe("the Flagged list", () => {
  it("shows one row per player in the server's order, with the totals", async () => {
    const { view } = await mount();
    const rows = [...view.element.querySelectorAll<HTMLElement>(".flagged-row")];
    expect(rows.map((row) => row.dataset["player"])).toEqual(["552", "77"]);
    const figures = [...view.element.querySelectorAll(".figure-value")].map((el) => el.textContent);
    // 2 players; 3 refused fights + 1 refused economy save.
    expect(figures).toEqual(["2", "4"]);
  });

  it("counts refused saves per check, with what did not match and whose yards", async () => {
    const { view } = await mount();
    const [first, second] = [...view.element.querySelectorAll<HTMLElement>(".flagged-row")];
    const fight = first!.querySelector<HTMLElement>('.flagged-count[data-kind="fight"]')!;
    expect(fight.textContent).toBe("Fight ×3");
    expect(fight.classList.contains("chip-bad")).toBe(true);
    expect(first!.querySelector('.flagged-count[data-kind="economy"]')).toBeNull();
    const fields = [...first!.querySelectorAll(".flagged-field")].map((el) => el.textContent);
    expect(fields).toEqual(["Building health ×3", "Loot ×2", "Damage % ×2", "Champion HP"]);
    expect(first!.querySelector(".flagged-yards")!.textContent).toBe("yardlord (bot) · DarkGecko (bot) · base 999");

    expect(second!.querySelector('.flagged-count[data-kind="economy"]')!.textContent).toBe("Economy ×3");
    expect(second!.querySelector('.flagged-count[data-kind="attack"]')!.textContent).toBe("Tampered attack ×1");
    expect(second!.textContent).toContain("Banned");
    expect(second!.querySelector(".flagged-yards")!.textContent).toBe("Saver ×3");
  });

  it("loads every entry when a row opens, once", async () => {
    const { view } = await mount();
    const row = view.element.querySelector<HTMLDetailsElement>('.flagged-row[data-player="552"]')!;
    row.open = true;
    row.dispatchEvent(new Event("toggle"));
    await settle();
    const entries = [...row.querySelectorAll<HTMLElement>(".flagged-entry")];
    expect(entries).toHaveLength(2);
    expect(entries[0]!.textContent).toContain("Fight · Refused");
    expect(entries[0]!.textContent).toContain("yardlord");
    expect(entries[0]!.textContent).toContain("Bot");
    expect(entries[0]!.textContent).toContain("disagrees with the replay on damage");
    expect(entries[1]!.textContent).toContain("Fight · Logged");
    expect(entries[1]!.textContent).toContain("base 999");
    expect(entries[1]!.querySelector(".chip-warn")).not.toBeNull();

    row.open = false;
    row.dispatchEvent(new Event("toggle"));
    row.open = true;
    row.dispatchEvent(new Event("toggle"));
    await settle();
    expect(calls.filter((call) => call.path.endsWith("/admin/flagged/552"))).toHaveLength(1);
  });

  it("opens Find a player and the Attack log for the player", async () => {
    const { view, opened, attackLogs } = await mount();
    const row = view.element.querySelector<HTMLElement>('.flagged-row[data-player="552"]')!;
    const buttons = [...row.querySelectorAll<HTMLButtonElement>(".flagged-actions button")];
    buttons.find((b) => b.textContent === "Find a player")!.click();
    buttons.find((b) => b.textContent === "Attack log")!.click();
    expect(opened).toEqual([552]);
    expect(attackLogs).toEqual([552]);
  });

  it("says when nobody is flagged, and when the list cannot load", async () => {
    answers["GET /admin/flagged"] = [200, { error: 0, players: [] }];
    const { view } = await mount();
    expect(view.element.textContent).toContain("Nobody has been flagged.");

    answers["GET /admin/flagged"] = [500, { error: "boom" }];
    const other = new FlaggedSection({ say: () => undefined, openPlayer: () => undefined, openAttacks: () => undefined });
    await other.refresh();
    expect(other.element.querySelector(".form-error")!.textContent).toContain("Could not load the flagged players");
  });

  it("only ever reads", async () => {
    const { view } = await mount();
    const row = view.element.querySelector<HTMLDetailsElement>(".flagged-row")!;
    row.open = true;
    row.dispatchEvent(new Event("toggle"));
    await settle();
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });
});
