// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { ModActBody, ModList, ModPlayer, ModQueueRow, ModReportsApi } from "@/api/modReports";
import { ReportsWindow } from "./ReportsWindow";
import { closesWords, muteLength, outcomeWords, roomLabel, rowWords, scopeWords } from "./reportsText";

/** The moderators' Reports window (owner, 12 Nov 2026, option B). */

const T0 = Date.parse("2026-11-12T09:40:00Z");

const row = (over: Partial<ModQueueRow> = {}): ModQueueRow => ({
  userid: 501,
  username: "Rude Player",
  muted: false,
  banned: false,
  caseId: 7,
  messages: 2,
  reportedMessages: 1,
  reports: 2,
  uniqueReporters: 2,
  filterOnlyLines: 1,
  slurs: 0,
  flagsUpTo: 40,
  oldestAt: new Date(T0).toISOString(),
  latestAt: new Date(T0 + 60_000).toISOString(),
  preview: { text: "you are all trash", source: "report" },
  ...over,
});

const list = (players: ModQueueRow[] = [row()]): ModList => ({
  ok: true,
  filter: "all",
  players,
  closed: [],
  nextOffset: null,
  counts: { all: players.length, reports: players.length, filter: 0, closed: 4 },
});

const player = (open: ModQueueRow | null = row()): ModPlayer => ({
  userid: 501,
  username: "Rude Player",
  lastSeenAt: new Date(T0).toISOString(),
  muteUntil: null,
  banned: false,
  open,
  lines: open
    ? [
        {
          ts: T0 + 60_000,
          channel: "chat:mr2-global",
          message: "what a <b>darn</b> base",
          report: null,
          filter: { id: 40, severity: "swear", rule: "word", words: ["darn"], shown: "what a **** base" },
        },
        {
          ts: T0,
          channel: "chat:alliance:12",
          message: "you are all trash",
          report: {
            reporters: ["Reporter A", "Reporter B"],
            verified: true,
            around: [
              { userid: 900, name: "Reporter A", text: "hi all", at: T0 - 60_000 },
              { userid: 501, name: "Rude Player", text: "you are all trash", at: T0, reported: true },
            ],
          },
          filter: null,
        },
      ]
    : [],
  log: [{ action: "warn", reason: "Please keep chat friendly.", until: null, byName: "Mod A", seenAt: null, at: new Date(T0).toISOString() }],
  decisions: [],
});

const fakeApi = (over: Partial<ModReportsApi> = {}): ModReportsApi => ({
  status: vi.fn(() => Promise.resolve({ moderator: true, open: 1 })),
  list: vi.fn(() => Promise.resolve(list())),
  player: vi.fn(() => Promise.resolve(player())),
  around: vi.fn(() => Promise.resolve([{ userid: 501, name: "Rude Player", text: "what a <b>darn</b> base", at: T0 + 60_000, flagged: "swear" as const }])),
  act: vi.fn(() => Promise.resolve({ ok: true as const, closed: { reports: 2, filterLines: 1, filterOnlyLines: 1 }, player: null })),
  ban: vi.fn(() => Promise.resolve({ ok: true as const, until: new Date(T0 + 86_400_000).toISOString(), closed: { reports: 0, filterLines: 0 }, removedLines: 2 })),
  removeLines: vi.fn(() => Promise.resolve({ removed: 1 })),
  ...over,
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const open = async (api: ModReportsApi, onChanged = vi.fn()) => {
  const window = new ReportsWindow({ api, onChanged }).mount(document.body);
  await settle();
  return window;
};

const q = <E extends Element = HTMLElement>(selector: string) => document.querySelector<E & HTMLElement>(selector)!;
const button = (selector: string) => q<HTMLButtonElement>(selector);

afterEach(() => {
  document.body.replaceChildren();
});

describe("the Reports window's words", () => {
  it("says what a step covers and what closed, as the mock-up does", () => {
    expect(rowWords(row())).toBe("2 messages · 2 reports from 2 players · 1 filter catch");
    expect(scopeWords(row())).toBe("Applies to all 2 messages, closes 2 reports and 1 filter catch");
    expect(scopeWords(row({ messages: 1, reports: 1, filterOnlyLines: 0 }))).toBe("Applies to the 1 message, closes 1 report");
    expect(closesWords({ reports: 0, filterOnlyLines: 0 })).toBe("nothing open");
  });

  it("names rooms and outcomes in the owner's words: Close and Mute", () => {
    expect(roomLabel("chat:mr2-global")).toBe("Map Room 2");
    expect(roomLabel("chat:alliance:12")).toBe("Alliance");
    expect(roomLabel("chat:inferno-global")).toBe("Inferno");
    expect(outcomeWords({ outcome: "dismiss", hours: null })).toBe("Closed, no action");
    expect(outcomeWords({ outcome: "mute", hours: 72 })).toBe("Muted for 3 days");
    expect(muteLength(168)).toBe("7 days");
    expect(muteLength(720)).toBe("30 days");
  });
});

describe("ReportsWindow", () => {
  it("lists players with counts on the four filters and opens the first one", async () => {
    const api = fakeApi();
    await open(api);
    expect(api.list).toHaveBeenCalledWith("all");
    const chips = [...document.querySelectorAll<HTMLElement>(".mod-reports__filters .mod-reports__seg")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["All1", "Reports1", "Auto-filter0", "Closed4"]);
    expect(q(".mod-reports__row").textContent).toContain("Rude Player");
    expect(api.player).toHaveBeenCalledWith(501);
    expect(q(".mod-reports__row").getAttribute("aria-current")).toBe("true");
    expect(q(".mod-reports__head h2").textContent).toBe("Rude Player");
  });

  it("shows each line as text, the chat around a report, and asks for the chat around a word-filter line", async () => {
    const api = fakeApi();
    await open(api);
    const lines = document.querySelectorAll(".mod-reports__line");
    expect(lines).toHaveLength(2);
    // Words a player wrote never become markup; the filter's word is marked.
    expect(lines[0]!.querySelector("blockquote b")).toBeNull();
    expect(lines[0]!.querySelector("blockquote mark")!.textContent).toBe("darn");
    expect(lines[0]!.textContent).toContain("Map Room 2");
    expect(lines[1]!.textContent).toContain("Alliance");
    expect(lines[1]!.textContent).toContain("Reported by 2 players: Reporter A, Reporter B");
    const snap = lines[1]!.querySelectorAll(".mod-reports__snap-line");
    expect(snap).toHaveLength(2);
    expect(snap[1]!.classList.contains("is-reported")).toBe(true);
    expect(snap[1]!.classList.contains("is-them")).toBe(true);

    lines[0]!.querySelector<HTMLButtonElement>(".mod-reports__link")!.click();
    await settle();
    expect(api.around).toHaveBeenCalledWith(40);
    expect(lines[0]!.querySelector(".mod-reports__snap-line.is-reported")).not.toBeNull();
    expect(document.querySelector(".mod-reports__ban-note")).toBeNull();
  });

  it("has Close, Warn, Mute and Ban, and Mute offers 1 hour, 1 day, 3 days and 7 days", async () => {
    await open(fakeApi());
    const actions = [...document.querySelectorAll<HTMLButtonElement>(".mod-reports__action-buttons button")];
    expect(actions.map((b) => b.textContent)).toEqual(["Close", "Warn", "Mute", "Ban"]);
    expect(document.body.textContent).not.toMatch(/Dismiss|Restrict/);
    button('[data-act="mute"]').click();
    const lengths = [...document.querySelectorAll<HTMLButtonElement>(".mod-reports__lengths button")];
    expect(lengths.map((b) => b.textContent)).toEqual(["1 hour", "1 day", "3 days", "7 days"]);
    expect(lengths.map((b) => b.dataset["hours"])).toEqual(["1", "24", "72", "168"]);
    expect(lengths[1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("will not warn or mute without a reason, and Cancel goes back", async () => {
    const api = fakeApi();
    await open(api);
    button('[data-act="mute"]').click();
    button("[data-confirm]").click();
    await settle();
    expect(api.act).not.toHaveBeenCalled();
    expect(q(".mod-reports__problem").hidden).toBe(false);
    expect(q(".mod-reports__problem").textContent).toBe("Write a reason: the player sees it.");
    button("[data-cancel]").click();
    expect(document.querySelector(".mod-reports__confirm")).toBeNull();
    expect(document.querySelector('[data-act="mute"]')).not.toBeNull();
  });

  it("mutes for the chosen length with what the window showed, then says what closed", async () => {
    const onChanged = vi.fn();
    const api = fakeApi({ player: vi.fn().mockResolvedValueOnce(player()).mockResolvedValue(player(null)) });
    await open(api, onChanged);
    button('[data-act="mute"]').click();
    button('[data-hours="72"]').click();
    q<HTMLTextAreaElement>(".mod-reports__confirm textarea").value = "Insults in chat";
    button("[data-confirm]").click();
    await settle();
    const body: ModActBody = { action: "mute", reason: "Insults in chat", hours: 72, caseId: 7, reports: 2, flagsUpTo: 40 };
    expect(api.act).toHaveBeenCalledWith(501, body);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(q(".mod-reports__result").textContent).toBe("Rude Player’s chat muted for 3 days. Closed 2 reports and 1 filter catch.");
    // Nothing open any more: only Ban stays.
    expect([...document.querySelectorAll(".mod-reports__action-buttons button")].map((b) => b.textContent)).toEqual(["Ban"]);
  });

  it("warns with the friendly reason filled in, and closes with an optional note", async () => {
    const api = fakeApi();
    await open(api);
    button('[data-act="warn"]').click();
    expect(q<HTMLTextAreaElement>(".mod-reports__confirm textarea").value).toBe("Please keep chat friendly. Next time it's a ban.");
    button("[data-confirm]").click();
    await settle();
    expect(api.act).toHaveBeenLastCalledWith(501, expect.objectContaining({ action: "warn", reason: "Please keep chat friendly. Next time it's a ban." }));

    button('[data-act="close"]').click();
    button("[data-confirm]").click();
    await settle();
    expect(api.act).toHaveBeenLastCalledWith(501, { action: "close", caseId: 7, reports: 2, flagsUpTo: 40 });
  });

  it("says the server's words on a refusal, and looks again when something new came in", async () => {
    const longer = new ApiError("This player's chat is already muted for longer. Warn or Close instead.", {
      status: 409,
      body: { reason: "longerMute" },
    });
    const api = fakeApi({ act: vi.fn().mockRejectedValueOnce(longer) });
    await open(api);
    button('[data-act="mute"]').click();
    q<HTMLTextAreaElement>(".mod-reports__confirm textarea").value = "x";
    button("[data-confirm]").click();
    await settle();
    expect(q(".mod-reports__problem").textContent).toBe("This player's chat is already muted for longer. Warn or Close instead.");
    expect(button("[data-confirm]").disabled).toBe(false);

    const changed = new ApiError("Something new came in for this player. Look again before deciding.", { status: 409, body: { reason: "changed" } });
    (api.act as ReturnType<typeof vi.fn>).mockRejectedValueOnce(changed);
    const before = (api.player as ReturnType<typeof vi.fn>).mock.calls.length;
    button("[data-confirm]").click();
    await settle();
    expect((api.player as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
    expect(q(".mod-reports__result--problem").textContent).toContain("Something new came in");
  });

  it("searches the loaded rows by name or account number", async () => {
    await open(fakeApi({ list: vi.fn(() => Promise.resolve(list([row(), row({ userid: 777, username: "Calm Player" })]))) }));
    const search = q<HTMLInputElement>(".mod-reports__input");
    search.value = "calm";
    search.dispatchEvent(new Event("input"));
    expect([...document.querySelectorAll(".mod-reports__row strong")].map((n) => n.textContent)).toEqual(["Calm Player"]);
    search.value = "#501";
    search.dispatchEvent(new Event("input"));
    expect([...document.querySelectorAll(".mod-reports__row strong")].map((n) => n.textContent)).toEqual(["Rude Player"]);
    search.value = "nobody";
    search.dispatchEvent(new Event("input"));
    expect(q(".mod-reports__list").textContent).toBe("Nobody matches.");
  });

  it("says nothing needs you on an empty list, and Closed loads its own list", async () => {
    const api = fakeApi({ list: vi.fn(() => Promise.resolve(list([]))) });
    await open(api);
    expect(q(".mod-reports__list").textContent).toContain("Nothing needs you");
    expect(q(".mod-reports__detail").textContent).toContain("Pick a player");
    button('[data-filter="closed"]').click();
    await settle();
    expect(api.list).toHaveBeenLastCalledWith("closed");
    expect(q('[data-filter="closed"]').getAttribute("aria-pressed")).toBe("true");
  });

  it("has a Back button to the list for the phone layout", async () => {
    await open(fakeApi());
    expect(q(".mod-reports__workspace").classList.contains("has-player")).toBe(true);
    button(".mod-reports__back").click();
    expect(q(".mod-reports__workspace").classList.contains("has-player")).toBe(false);
  });
});

/** A new player the chat filter caught (owner, 24 Nov 2026, Reports option A). */
const spammer = (over: Partial<ModPlayer> = {}): ModPlayer => ({
  ...player(row({ userid: 610, username: "Spam Kid", reports: 0, uniqueReporters: 0, caseId: null, newHours: 30, filterTags: ["newLink", "invite", "watched", "hidden"] })),
  userid: 610,
  username: "Spam Kid",
  newHours: 30,
  log: [],
  lines: [
    {
      ts: T0 + 120_000,
      channel: "chat:country:PH",
      message: "sali na t.me/abc",
      report: null,
      filter: { id: 51, severity: "filter", rule: "word", words: [], shown: "sali na [link removed]", tags: ["newLink", "invite"], hidden: false, yardAgeHours: 30 },
      lineId: "line51",
      removed: null,
      copies: [{ channel: "chat:country:PH", ts: T0 + 60_000, lineId: "line50" }],
    },
    {
      ts: T0 + 90_000,
      channel: "chat:country:PH",
      message: "Hi sino papasok sa private server",
      report: null,
      filter: { id: 52, severity: "filter", rule: "word", words: ["private server"], shown: "", tags: ["watched", "hidden"], hidden: true, yardAgeHours: 30 },
      lineId: "line52",
      removed: null,
      copies: [],
    },
    {
      ts: T0 + 30_000,
      channel: "chat:country:PH",
      message: "join fb group facebook.com/groups/1",
      report: null,
      filter: { id: 49, severity: "filter", rule: "word", words: ["fb"], shown: "join fb group [link removed]", tags: ["invite", "watched"], hidden: false, yardAgeHours: 30 },
      lineId: "line49",
      removed: { byName: "Mod A", at: new Date(T0 + 40_000).toISOString() },
      copies: [],
    },
  ],
  ...over,
});

/** Types into the confirm step's reason box, as a player would (an input event). */
const write = (text: string) => {
  const box = q<HTMLTextAreaElement>(".mod-reports__confirm textarea");
  box.value = text;
  box.dispatchEvent(new Event("input"));
};

describe("ReportsWindow: the chat filter's lines", () => {
  const spamApi = (over: Partial<ModReportsApi> = {}) =>
    fakeApi({ list: vi.fn(() => Promise.resolve(list([spammer().open!]))), player: vi.fn(() => Promise.resolve(spammer())), ...over });

  it("tags each line, shows the yard age, what others saw, and groups a repeated line", async () => {
    await open(spamApi());
    expect(q(".mod-reports__row").textContent).toContain("30h");
    expect(q(".mod-reports__row").textContent).toContain("New link");
    expect(q(".mod-reports__row").textContent).toContain("Hidden");
    expect(q(".mod-reports__head .mod-reports__new").textContent).toBe("New · 30h");
    const lines = document.querySelectorAll(".mod-reports__line");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.querySelector(".mod-reports__tags")!.textContent).toBe("New linkInvite link");
    expect(lines[0]!.querySelector("blockquote mark")!.textContent).toBe("t.me/abc");
    expect(lines[0]!.textContent).toContain("said 2 times");
    expect(lines[0]!.textContent).toContain("others saw “sali na [link removed]”");
    expect(lines[1]!.querySelector(".mod-reports__tags")!.textContent).toBe("Watched: private serverHidden");
    expect(lines[1]!.textContent).toContain("only Spam Kid saw it");
  });

  it("has Remove on a line still in chat, none on a hidden or removed line", async () => {
    await open(spamApi());
    const lines = document.querySelectorAll(".mod-reports__line");
    expect(lines[0]!.querySelector(".mod-reports__remove")).not.toBeNull();
    expect(lines[1]!.querySelector(".mod-reports__remove")).toBeNull();
    expect(lines[2]!.querySelector(".mod-reports__remove")).toBeNull();
    expect(lines[2]!.classList.contains("is-removed")).toBe(true);
    expect(lines[2]!.textContent).toContain("Removed by Mod A");
  });

  it("Remove takes two taps and removes the line with its repeats", async () => {
    const api = spamApi();
    await open(api);
    expect(q(".mod-reports__remove").textContent).toBe("Remove 2 lines");
    button(".mod-reports__remove").click();
    expect(api.removeLines).not.toHaveBeenCalled();
    expect(q(".mod-reports__remove").textContent).toBe("Tap again");
    expect(document.querySelectorAll(".mod-reports__line")[1]!.textContent).toContain("Not in chat");
    button(".mod-reports__remove").click();
    await settle();
    expect(api.removeLines).toHaveBeenCalledWith(610, [
      { channel: "chat:country:PH", ts: T0 + 120_000, lineId: "line51" },
      { channel: "chat:country:PH", ts: T0 + 60_000, lineId: "line50" },
    ]);
    expect(q(".mod-reports__result").textContent).toBe("2 lines removed from chat for everyone.");
  });

  it("bans for 1, 3 or 7 days with a reason, removing the last hour's lines by default", async () => {
    const onChanged = vi.fn();
    const api = spamApi();
    await open(api, onChanged);
    button('[data-act="ban"]').click();
    expect([...document.querySelectorAll<HTMLButtonElement>(".mod-reports__lengths button")].map((b) => b.textContent)).toEqual(["1 day", "3 days", "7 days"]);
    // Confirm waits for the reason the player sees.
    expect(button("[data-confirm]").disabled).toBe(true);
    button('[data-days="3"]').click();
    write("Advertising another server");
    expect(button("[data-confirm]").disabled).toBe(false);
    button("[data-confirm]").click();
    await settle();
    expect(api.ban).toHaveBeenCalledWith(610, { days: 3, reason: "Advertising another server", removeLines: true });
    expect(onChanged).toHaveBeenCalledOnce();
    expect(q(".mod-reports__result").textContent).toBe("Spam Kid banned for 3 days. 2 chat lines removed.");
  });

  it("a refused ban says why and keeps the form", async () => {
    const api = spamApi({ ban: vi.fn(() => Promise.reject(new ApiError("That player is a moderator.", { status: 403, body: { reason: "moderator" } }))) });
    await open(api);
    button('[data-act="ban"]').click();
    write("x");
    q<HTMLInputElement>("[data-remove-lines]").checked = false;
    button("[data-confirm]").click();
    await settle();
    expect(api.ban).toHaveBeenCalledWith(610, { days: 1, reason: "x", removeLines: false });
    expect(q(".mod-reports__problem").hidden).toBe(false);
    expect(q(".mod-reports__problem").textContent).toBe("That player is a moderator.");
    expect(document.querySelector(".mod-reports__confirm")).not.toBeNull();
  });
});
