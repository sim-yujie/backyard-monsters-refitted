// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AllianceTradeApi, TradeRequest, TradeStorage, TradeView } from "@/api/allianceTrade";
import { arriveFor, askCap, carryCap, fitToRoom, giveCheck, landing, sendCap, sentFor } from "@/game/alliance/tradeRules";
import { TRADE_TEXT, TradeTab, tradeForName, type TradeHost } from "./allianceTradeUi";

/**
 * The Trade tab and its sheets (design v5 §12b; owner 10 Nov 2026: Give is
 * 1:1 with 10% lost, no amount choices; a request says which building or
 * monster it is for) against a stand-in for the routes.
 */

const ok = <T extends object>(value: T) => Promise.resolve({ ok: true as const, ...value });
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const storage = (held: number, cap = 20_000_000): TradeStorage => ({ held: { r1: held, r2: held, r3: held, r4: held }, cap });

const request = (extra: Partial<TradeRequest> = {}): TradeRequest => ({
  id: 7,
  userid: 2,
  username: "PebbleKing",
  role: "member",
  amounts: { r3: 1_500_000 },
  for: { kind: "building", type: 14, level: 7 },
  created_at: 0,
  expires_at: 1_000_000 + 3_600,
  status: "open",
  given_by: null,
  storage: storage(1_000_000),
  ...extra,
});

const view = (extra: Partial<TradeView> = {}): TradeView => ({
  today: { sendsLeft: 1, receivesLeft: 1, asksLeft: 3, newDayIn: 6 * 3600 },
  rules: { loss: 0.1, capShare: 0.1, requestSeconds: 86_400 },
  me: storage(5_000_000),
  choices: { buildings: [{ type: 14, level: 7 }, { type: 21, level: 4 }], monsters: ["C1", "C2"] },
  myRequest: null,
  requests: [request()],
  recent: [{ from: "Mira", to: "Thornback", arrived: { r4: 800_000 }, at: 1_000_000 - 7_200 }],
  mate: null,
  ...extra,
});

const done = { sent: {}, arrived: { r3: 2_000_000 }, lostFull: {}, resources: { r1: 0, r2: 0, r3: 0, r4: 0 }, to: { userid: 2, username: "PebbleKing" } };

const fakeApi = (overrides: Partial<AllianceTradeApi> = {}): AllianceTradeApi => ({
  view: vi.fn(() => ok({ view: view() })),
  ask: vi.fn(() => ok({})),
  cancel: vi.fn(() => ok({})),
  give: vi.fn(() => ok({ done })),
  send: vi.fn(() => ok({ done })),
  ...overrides,
});

const mount = async (api: AllianceTradeApi) => {
  const root = document.createElement("div");
  document.body.append(root);
  const host: TradeHost & { said: (string | null)[] } = {
    said: [],
    redraw: () => root.replaceChildren(...tab.render()),
    say: (text) => host.said.push(text),
    now: () => 1_000_000,
    traded: vi.fn(),
  };
  const tab = new TradeTab(host, api);
  await tab.load();
  return { tab, host, root };
};

const buttonNamed = (words: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === words);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("trade sums (web preview = server)", () => {
  it("10% lost, sent for an arrival, caps, room", () => {
    expect(arriveFor(2_222_223)).toBe(2_000_000);
    expect(sentFor(2_000_000)).toBe(2_222_223);
    expect(carryCap(20_000_000, 50_000_000)).toBe(2_000_000);
    // An ask is what a mate gives: its 90% must fit the room.
    expect(askCap(storage(19_500_000), "r1")).toBe(555_556);
    expect(arriveFor(555_556)).toBe(500_000);
    expect(askCap(storage(0), "r1")).toBe(2_000_000);
    expect(askCap(storage(21_000_000), "r1")).toBe(0);
    expect(sendCap(storage(500_000), storage(0), "r2")).toBe(500_000);
    expect(landing(1_000_000, storage(19_500_000), "r3")).toEqual({ arrive: 900_000, lands: 500_000, lost: 400_000 });
    const fit = fitToRoom(storage(19_500_000), "r3");
    expect(arriveFor(fit)).toBe(500_000);
    expect(arriveFor(fit + 1)).toBeGreaterThan(500_000);
    expect(fitToRoom(storage(20_000_000), "r3")).toBe(0);
  });

  it("give is all of it or nothing: what stops it", () => {
    expect(giveCheck({ r3: 1_500_000 }, storage(5_000_000), storage(0))).toEqual({ short: [], overCap: [] });
    expect(giveCheck({ r3: 1_500_000 }, storage(1_000_000), storage(0))).toEqual({ short: ["r3"], overCap: [] });
    expect(giveCheck({ r3: 1_500_000 }, storage(5_000_000, 10_000_000), storage(0))).toEqual({ short: [], overCap: ["r3"] });
  });
});

describe("TradeTab", () => {
  it("shows today, the ask button, mates asking with what for and Give, and recent trades", async () => {
    await mount(fakeApi());
    const text = document.body.textContent ?? "";
    expect(text).toContain(TRADE_TEXT.ask);
    expect(text).toContain("PebbleKing");
    expect(text).toContain("1.5M");
    expect(text).toContain(tradeForName({ kind: "building", type: 14, level: 7 }));
    expect(tradeForName({ kind: "building", type: 14, level: 7 })).toMatch(/Town Hall L7/);
    expect(document.querySelector(".trade-request .trade-for__pic")).not.toBeNull();
    expect(text).toContain(TRADE_TEXT.gave("Mira", "Thornback", "800K Goo"));
    expect(buttonNamed(TRADE_TEXT.give)?.disabled).toBe(false);
  });

  it("Give: one action, 1:1; the flow shows what leaves and what arrives (less 10%)", async () => {
    const api = fakeApi();
    const { host } = await mount(api);
    buttonNamed(TRADE_TEXT.give)!.click();
    const text = document.body.textContent ?? "";
    // 1,500,000 leaves, 1,350,000 arrives.
    expect(text).toContain("1,500,000");
    expect(text).toContain("1,350,000");
    expect(text).toContain(TRADE_TEXT.lossLong);
    expect(text).toContain(tradeForName({ kind: "building", type: 14, level: 7 }));
    expect(document.querySelectorAll(".trade-bar")).toHaveLength(2);
    // No amount choices any more.
    expect(document.querySelector(".trade-choices, .trade-amounts")).toBeNull();
    document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.click();
    await flush();
    expect(api.give).toHaveBeenCalledWith(7);
    expect(host.traded).toHaveBeenCalled();
    expect(host.said.at(-1)).toBe(TRADE_TEXT.sent("PebbleKing", "2M Putty"));
    expect(document.querySelector(".trade-sheet")).toBeNull();
  });

  it("Give: a giver short of what was asked sees what they have, and Give is off", async () => {
    const api = fakeApi({ view: vi.fn(() => ok({ view: view({ me: storage(800_000) }) })) });
    await mount(api);
    buttonNamed(TRADE_TEXT.give)!.click();
    expect(document.body.textContent).toContain(TRADE_TEXT.youHave("800,000"));
    expect(document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.disabled).toBe(true);
  });

  it("Give: past the carry cap between the yards, Give is off with the cap shown", async () => {
    const api = fakeApi({ view: vi.fn(() => ok({ view: view({ me: storage(5_000_000, 10_000_000) }) })) });
    await mount(api);
    buttonNamed(TRADE_TEXT.give)!.click();
    expect(document.body.textContent).toContain(TRADE_TEXT.overCap("1,000,000"));
    expect(document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.disabled).toBe(true);
  });

  it("Ask: pick a resource, Most fits the free room after the 10%, pick the building it is for, post", async () => {
    const api = fakeApi({ view: vi.fn(() => ok({ view: view({ me: storage(19_500_000) }) })) });
    const { host } = await mount(api);
    buttonNamed(TRADE_TEXT.ask)!.click();
    document.querySelector<HTMLButtonElement>('.trade-tile[data-key="r4"]')!.click();
    buttonNamed(TRADE_TEXT.most)!.click();
    // The preview: a mate gives 555,556, you get 500,000.
    expect(document.body.textContent).toContain("555,556");
    expect(document.body.textContent).toContain("500,000");
    const items = document.querySelectorAll<HTMLButtonElement>(".trade-for-pick__item");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe("L7");
    items[0]!.click();
    expect(document.querySelector(".trade-for-pick__item")!.getAttribute("aria-checked")).toBe("true");
    document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.click();
    await flush();
    expect(api.ask).toHaveBeenCalledWith({ r4: 555_556 }, { kind: "building", type: 14, level: 7 });
    expect(host.said.at(-1)).toBe(TRADE_TEXT.posted);
  });

  it("Ask: the Monster tab lists the player's monsters; none picked posts without one", async () => {
    const api = fakeApi();
    await mount(api);
    buttonNamed(TRADE_TEXT.ask)!.click();
    buttonNamed(TRADE_TEXT.forMonster)!.click();
    const items = document.querySelectorAll<HTMLButtonElement>(".trade-for-pick__item");
    expect([...items].map((node) => node.title)).toEqual([tradeForName({ kind: "monster", id: "C1" }), tradeForName({ kind: "monster", id: "C2" })]);
    items[1]!.click();
    expect(document.querySelectorAll(".trade-for-pick__item")[1]!.getAttribute("aria-checked")).toBe("true");
    document.querySelectorAll<HTMLButtonElement>(".trade-for-pick__item")[1]!.click(); // tap again: cleared
    document.querySelector<HTMLButtonElement>('.trade-tile[data-key="r1"]')!.click();
    document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.click();
    await flush();
    expect(api.ask).toHaveBeenCalledWith({ r1: 1_000_000 }, null);
  });

  it("Send: past free storage is lost, Fit to room lowers it", async () => {
    const mate = { userid: 2, username: "PebbleKing", storage: storage(19_500_000) };
    const api = fakeApi({ view: vi.fn(() => ok({ view: view({ mate }) })) });
    const { tab } = await mount(api);
    tab.openSend(2, "PebbleKing");
    await flush();
    document.querySelector<HTMLButtonElement>('.trade-tile[data-key="r3"]')!.click();
    buttonNamed("1M")!.click();
    expect(document.body.textContent).toContain(TRADE_TEXT.lostFull("400,000"));
    buttonNamed(TRADE_TEXT.fit)!.click();
    expect(document.body.textContent).not.toContain("lost: storage full");
    document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.click();
    await flush();
    expect(api.send).toHaveBeenCalledWith(2, { r3: fitToRoom(storage(19_500_000), "r3") });
  });

  it("a refusal shows its words and keeps the sheet", async () => {
    const api = fakeApi({ give: vi.fn(() => Promise.resolve({ ok: false as const, reason: "sentToday", message: "You already sent a trade today.", availableAt: null })) });
    const { host } = await mount(api);
    buttonNamed(TRADE_TEXT.give)!.click();
    document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.click();
    await flush();
    expect(host.said.at(-1)).toBe("You already sent a trade today.");
    expect(document.querySelector(".trade-sheet")).not.toBeNull();
  });

  it("chat's Give opens the sheet on that request", async () => {
    const { tab } = await mount(fakeApi());
    tab.openGive(7);
    await flush();
    expect(document.querySelector(".trade-sheet--give")).not.toBeNull();
  });

  it("no sends left: Give is off", async () => {
    await mount(fakeApi({ view: vi.fn(() => ok({ view: view({ today: { sendsLeft: 0, receivesLeft: 1, asksLeft: 3, newDayIn: 100 } }) })) }));
    expect(buttonNamed(TRADE_TEXT.give)?.disabled).toBe(true);
  });
});
