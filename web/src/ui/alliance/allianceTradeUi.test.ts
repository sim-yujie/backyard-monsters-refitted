// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AllianceTradeApi, TradeRequest, TradeStorage, TradeView } from "@/api/allianceTrade";
import { acceptBlock, arriveFor, carryCap, fitToRoom, postCap, sentFor } from "@/game/alliance/tradeRules";
import { resourceName } from "@/ui/resourceIcon";
import { TRADE_TEXT, TradeTab, type TradeHost } from "./allianceTradeUi";

/**
 * The Trade tab and its sheet (owner 11 Nov 2026: a request is "I give N
 * Twigs, I want N Goo", 1:1; a mate clicks Accept and the swap happens; each
 * side gets 90%; swaps only, no Send, owner 16 Nov 2026) against a stand-in
 * for the routes.
 */

const ok = <T extends object>(value: T) => Promise.resolve({ ok: true as const, ...value });
const refused = (message: string) => Promise.resolve({ ok: false as const, reason: "refused", message, availableAt: null });
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const storage = (held: number, cap = 20_000_000): TradeStorage => ({ held: { r1: held, r2: held, r3: held, r4: held }, cap });

/** PebbleKing gives 1M Twigs (r1) and wants 1M Goo (r3); each side gets 900K. */
const request = (extra: Partial<TradeRequest> = {}): TradeRequest => ({
  id: 7,
  userid: 2,
  username: "PebbleKing",
  role: "member",
  give: "r1",
  want: "r3",
  amount: 1_000_000,
  gets: 900_000,
  created_at: 0,
  expires_at: 1_000_000 + 3_600,
  status: "open",
  taken_by: null,
  storage: storage(1_000_000),
  ready: true,
  ...extra,
});

const today = { swapsLeft: 1, postsLeft: 3, newDayIn: 6 * 3600 };

const view = (extra: Partial<TradeView> = {}): TradeView => ({
  today,
  rules: { loss: 0.1, capShare: 0.1, requestSeconds: 172_800 },
  me: storage(5_000_000),
  myRequest: null,
  requests: [request()],
  recent: [{ from: "Mira", to: "Thornback", arrived: { r4: 800_000 }, at: 1_000_000 - 7_200 }],
  ...extra,
});

const swapDone = { gave: { r3: 1_000_000 }, got: { r1: 900_000 }, resources: { r1: 0, r2: 0, r3: 0, r4: 0 }, with: { userid: 2, username: "PebbleKing" } };

const fakeApi = (overrides: Partial<AllianceTradeApi> = {}): AllianceTradeApi => ({
  view: vi.fn(() => ok({ view: view() })),
  post: vi.fn(() => ok({})),
  cancel: vi.fn(() => ok({})),
  accept: vi.fn(() => ok({ done: swapDone })),
  ...overrides,
});

const withView = (extra: Partial<TradeView>) => fakeApi({ view: vi.fn(() => ok({ view: view(extra) })) });

const mount = async (api: AllianceTradeApi) => {
  const root = document.createElement("div");
  document.body.append(root);
  const host: TradeHost & { said: (string | null)[]; traded: ReturnType<typeof vi.fn> } = {
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
const acceptButton = () => document.querySelector<HTMLButtonElement>('.trade-request[data-request="7"] .trade-accept');
const tile = (side: "give" | "want", key: string) => document.querySelector<HTMLButtonElement>(`.trade-pick[data-side="${side}"] .trade-tile[data-key="${key}"]`)!;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("trade sums (web preview = server)", () => {
  it("10% lost, sent for an arrival, caps, room", () => {
    expect(arriveFor(1_000_000)).toBe(900_000);
    expect(arriveFor(2_222_223)).toBe(2_000_000);
    expect(sentFor(2_000_000)).toBe(2_222_223);
    expect(carryCap(20_000_000, 50_000_000)).toBe(2_000_000);
    expect(fitToRoom(storage(19_500_000), "r1")).toBe(555_556);
  });

  it("a new request's Most: held, 10% of storage, and the 90% fitting the room of what you get", () => {
    expect(postCap(storage(5_000_000), "r1", "r3")).toBe(2_000_000);
    expect(postCap(storage(300_000), "r1", "r3")).toBe(300_000);
    const nearlyFull: TradeStorage = { held: { r1: 5_000_000, r2: 0, r3: 19_500_000, r4: 0 }, cap: 20_000_000 };
    expect(postCap(nearlyFull, "r1", "r3")).toBe(555_556);
    expect(postCap({ held: { r1: 5_000_000, r2: 0, r3: 20_000_000, r4: 0 }, cap: 20_000_000 }, "r1", "r3")).toBe(0);
  });

  it("acceptBlock: each reason Accept is off", () => {
    const me = storage(5_000_000);
    expect(acceptBlock(request(), me, today)).toBeNull();
    expect(acceptBlock(request(), me, { swapsLeft: 0 })).toBe("traded");
    expect(acceptBlock(request({ ready: false }), me, today)).toBe("mateTraded");
    expect(acceptBlock(request(), storage(500_000), today)).toBe("short");
    expect(acceptBlock(request(), null, today)).toBe("short");
    // Over 10% of YOUR storage (5M cap: up to 500K), though the asker's is bigger.
    expect(acceptBlock(request(), storage(5_000_000, 5_000_000), today)).toBe("overCap");
    // Over the cap comes before not enough, as the server checks.
    expect(acceptBlock(request(), storage(400_000, 5_000_000), today)).toBe("overCap");
    // The asker's storage shrank since they posted.
    expect(acceptBlock(request({ storage: storage(0, 5_000_000) }), me, today)).toBe("mateOverCap");
    expect(acceptBlock(request(), { held: { r1: 19_500_000, r2: 0, r3: 5_000_000, r4: 0 }, cap: 20_000_000 }, today)).toBe("full");
    expect(acceptBlock(request({ storage: { held: { r1: 0, r2: 0, r3: 19_500_000, r4: 0 }, cap: 20_000_000 } }), me, today)).toBe("mateFull");
  });
});

describe("Trade tab", () => {
  it("a mate's request reads from your side: −1,000,000 Goo → +900,000 Twigs, and Accept shows +900K", async () => {
    await mount(fakeApi());
    const row = document.querySelector('.trade-request[data-request="7"]')!;
    expect(row.querySelector(".trade-request__name")?.textContent).toBe("PebbleKing");
    const sides = [...row.querySelectorAll<HTMLElement>(".trade-swap__side")];
    expect(sides.map((side) => [side.dataset["key"], side.querySelector(".trade-swap__n")?.textContent])).toEqual([
      ["r3", "−1,000,000"],
      ["r1", "+900,000"],
    ]);
    const accept = acceptButton()!;
    expect(accept.disabled).toBe(false);
    expect(accept.querySelector(".trade-accept__n")?.textContent).toBe("+900K");
    expect(accept.getAttribute("aria-label")).toContain(TRADE_TEXT.swapLabel(`1,000,000 ${resourceName("r3")}`, `900,000 ${resourceName("r1")}`));
    expect(row.querySelector(".trade-request__why")).toBeNull();
  });

  it("Accept swaps: the route gets the request id, the yard is told, and the answer is said", async () => {
    const api = fakeApi();
    const { host } = await mount(api);
    acceptButton()!.click();
    await flush();
    expect(api.accept).toHaveBeenCalledWith(7);
    expect(host.traded).toHaveBeenCalledTimes(1);
    expect(api.view).toHaveBeenCalledTimes(2);
    expect(host.said.at(-1)).toBe(TRADE_TEXT.swapped("PebbleKing", `900K ${resourceName("r1")}`));
  });

  // beta 8 (astra): the button and receipt retain meaningful million digits.
  it.each([[1_350_000, "1.35M"], [2_700_000, "2.7M"], [1_800_000, "1.8M"], [900_000, "900K"]])("shows precise arrival %s", async (gets, text) => {
    const api = fakeApi({
      view: vi.fn(() => ok({ view: view({ requests: [request({ gets })] }) })),
      accept: vi.fn(() => ok({ done: { ...swapDone, got: { r1: gets } } })),
    });
    const { host } = await mount(api);
    expect(acceptButton()!.querySelector(".trade-accept__n")?.textContent).toBe(`+${text}`);
    acceptButton()!.click();
    await flush();
    expect(host.said.at(-1)).toBe(TRADE_TEXT.swapped("PebbleKing", `${text} ${resourceName("r1")}`));
  });

  it("pairs reciprocal recent receipts by time and players before limiting to two swaps", async () => {
    await mount(withView({ recent: [
      { from: "A", to: "B", arrived: { r1: 1_800_000 }, at: 999_988 },
      { from: "C", to: "D", arrived: { r2: 900_000 }, at: 999_988 },
      { from: "B", to: "A", arrived: { r3: 1_350_000 }, at: 999_988 },
      { from: "D", to: "C", arrived: { r4: 900_000 }, at: 999_988 },
      { from: "E", to: "F", arrived: { r1: 500 }, at: 999_980 },
    ] }));
    const lines = [...document.querySelectorAll(".trade-recent__line")];
    expect(lines.map((line) => line.textContent)).toEqual([
      "A got 1.35M · B got 1.8M · 12s ago",
      "C got 900K · D got 900K · 12s ago",
    ]);
    expect(lines[0]!.querySelectorAll(".res-icon")).toHaveLength(2);
  });

  it("keeps an unpaired recent receipt", async () => {
    await mount(fakeApi());
    expect(document.querySelector(".trade-recent__line")?.textContent).toBe(`Mira gave Thornback 800K ${resourceName("r4")} · 2h ago`);
  });

  it("uses the elapsed Today countdown in all daily status lines", async () => {
    const { host } = await mount(withView({ today: { ...today, swapsLeft: 0 } }));
    host.now = () => 1_003_600;
    host.redraw();
    expect(document.querySelector(".trade-today")?.textContent).toContain("5h");
    expect(document.querySelector(".trade-status")?.textContent).toBe(TRADE_TEXT.tradedToday("5h"));
    expect(document.querySelector(".trade-request__why")?.textContent).toBe(TRADE_TEXT.block.traded("5h"));
    expect(document.querySelector(".trade-today__stat")?.textContent).toBe("0swaps left");
  });

  it("a refused Accept shows the server's words and the yard is not told", async () => {
    const api = fakeApi({ accept: vi.fn(() => refused("That request is no longer open.")) });
    const { host } = await mount(api);
    acceptButton()!.click();
    await flush();
    expect(host.said.at(-1)).toBe("That request is no longer open.");
    expect(host.traded).not.toHaveBeenCalled();
    expect(acceptButton()!.disabled).toBe(false);
  });

  it.each([
    ["traded", { today: { ...today, swapsLeft: 0 } }, TRADE_TEXT.block.traded("6h")],
    ["mateTraded", { requests: [request({ ready: false })] }, TRADE_TEXT.block.mateTraded("PebbleKing")],
    ["short", { me: storage(400_000) }, TRADE_TEXT.block.short("1M", resourceName("r3"), "400K")],
    ["overCap", { me: storage(5_000_000, 5_000_000) }, TRADE_TEXT.block.overCap("500K")],
    ["mateOverCap", { requests: [request({ storage: storage(0, 5_000_000) })] }, TRADE_TEXT.block.mateOverCap("PebbleKing")],
    ["mateFull", { requests: [request({ storage: { held: { r1: 0, r2: 0, r3: 19_500_000, r4: 0 }, cap: 20_000_000 } })] }, TRADE_TEXT.block.mateFull("PebbleKing")],
  ] as const)("Accept is off with a reason: %s", async (block, extra, words) => {
    await mount(withView(extra as Partial<TradeView>));
    expect(acceptButton()!.disabled).toBe(true);
    const why = document.querySelector<HTMLElement>(".trade-request__why")!;
    expect(why.dataset["block"]).toBe(block);
    expect(why.textContent).toBe(words);
  });

  it("a taken request leaves Mates' requests at once (owner, 19 Nov): it shows under Recent trades instead", async () => {
    await mount(withView({ requests: [request({ status: "done", taken_by: "Tina" })] }));
    expect(document.querySelector('.trade-request[data-request="7"]')).toBeNull();
    expect(acceptButton()).toBeNull();
    expect(document.querySelector(".trade-requests")?.textContent).toBe(TRADE_TEXT.noRequests);
  });

  it("no recent swaps in 48 h: No trades yet", async () => {
    await mount(withView({ recent: [] }));
    expect(document.querySelector(".trade-recent")?.textContent).toBe(TRADE_TEXT.noRecent);
  });

  it("no requests: one short line", async () => {
    await mount(withView({ requests: [] }));
    expect(document.querySelector(".trade-requests")?.textContent).toBe(TRADE_TEXT.noRequests);
  });

  it("your request: what you give → what you get, held line, and Cancel gives it back", async () => {
    const mine = request({ id: 9, userid: 1, username: "Me", give: "r2", want: "r4", amount: 500_000, gets: 450_000 });
    const api = withView({ myRequest: mine });
    const { host } = await mount(api);
    const row = document.querySelector('.trade-request--mine[data-request="9"]')!;
    expect([...row.querySelectorAll(".trade-swap__side")].map((side) => side.querySelector(".trade-swap__n")?.textContent)).toEqual(["−500,000", "+450,000"]);
    expect(document.body.textContent).toContain(TRADE_TEXT.held);
    expect(document.querySelector(".trade-new")).toBeNull();
    buttonNamed(TRADE_TEXT.cancel)!.click();
    await flush();
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(host.traded).toHaveBeenCalledTimes(1);
  });

  it("your request when you traded today: it waits for tomorrow", async () => {
    await mount(withView({ myRequest: request({ id: 9, ready: false }) }));
    const why = document.querySelector('.trade-request--mine .trade-request__why[data-block="mateTraded"]');
    expect(why?.textContent).toBe(TRADE_TEXT.block.mineWaits("6h"));
  });

  it("New request is replaced by a compact status once today's posts are used, or after a trade today", async () => {
    await mount(withView({ today: { ...today, postsLeft: 0 } }));
    expect(document.querySelector(".trade-new")).toBeNull();
    expect(document.body.textContent).toContain(TRADE_TEXT.postsUsed);
    document.body.replaceChildren();
    await mount(withView({ today: { ...today, swapsLeft: 0 } }));
    expect(document.querySelector(".trade-new")).toBeNull();
    expect(document.body.textContent).toContain(TRADE_TEXT.tradedToday("6h"));
  });

  it("chat's Trade lights that request; a gone one says so", async () => {
    const { tab, host } = await mount(fakeApi());
    tab.openRequest(7);
    await flush();
    expect(document.querySelector('.trade-request[data-request="7"]')!.classList.contains("is-focus")).toBe(true);
    tab.openRequest(99);
    await flush();
    expect(document.querySelector(".is-focus")).toBeNull();
    expect(host.said.at(-1)).toBe(TRADE_TEXT.gone);
  });
});

describe("New request sheet", () => {
  it("pick what you give and what you get, then Post sends give, want and amount", async () => {
    const api = fakeApi();
    const { host } = await mount(api);
    document.querySelector<HTMLButtonElement>(".trade-new")!.click();
    expect(document.querySelector(".trade-sheet--post")).not.toBeNull();
    expect(document.body.textContent).toContain(TRADE_TEXT.pick);
    expect(document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.disabled).toBe(true);
    tile("give", "r1").click();
    // What you give can't also be what you get.
    expect(tile("want", "r1").disabled).toBe(true);
    tile("want", "r3").click();
    expect(tile("give", "r1").getAttribute("aria-pressed")).toBe("true");
    expect(tile("want", "r3").getAttribute("aria-pressed")).toBe("true");
    // The amount starts at 500K; the summary shows what each side gets.
    expect(document.querySelector<HTMLInputElement>(".trade-amount__box")!.value).toBe("500,000");
    const sum = document.querySelector(".trade-post-sum")!;
    expect([...sum.querySelectorAll(".trade-swap__side")].map((side) => side.querySelector(".trade-swap__n")?.textContent)).toEqual(["−500,000", "+450,000"]);
    expect(sum.querySelector(".trade-post-sum__mate")?.textContent).toContain("450,000");
    buttonNamed("1M")!.click();
    document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.click();
    await flush();
    expect(api.post).toHaveBeenCalledWith("r1", "r3", 1_000_000);
    expect(host.said.at(-1)).toBe(TRADE_TEXT.posted);
    expect(host.traded).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".trade-sheet")).toBeNull();
  });

  it("on a small storage, Most is 10% of it and the bigger quick amounts are off", async () => {
    await mount(withView({ me: storage(5_000, 10_000) }));
    document.querySelector<HTMLButtonElement>(".trade-new")!.click();
    tile("give", "r1").click();
    tile("want", "r3").click();
    expect(buttonNamed("500K")!.disabled).toBe(true);
    expect(buttonNamed("1M")!.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>(".trade-amount__box")!.value).toBe("1,000");
    expect(document.querySelector(".trade-amount__max")?.textContent).toBe(TRADE_TEXT.max("1K"));
    expect(buttonNamed(TRADE_TEXT.most)!.disabled).toBe(false);
  });

  it("picking what you get as what you give clears what you get; unpicking clears the amount", async () => {
    await mount(fakeApi());
    document.querySelector<HTMLButtonElement>(".trade-new")!.click();
    tile("give", "r1").click();
    tile("want", "r3").click();
    tile("give", "r3").click();
    expect(tile("give", "r3").getAttribute("aria-pressed")).toBe("true");
    expect(tile("want", "r3").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".trade-amount")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.disabled).toBe(true);
  });

  it("a refused post shows its words and keeps the sheet", async () => {
    const api = fakeApi({ post: vi.fn(() => refused("You already have an open request.")) });
    const { host } = await mount(api);
    document.querySelector<HTMLButtonElement>(".trade-new")!.click();
    tile("give", "r1").click();
    tile("want", "r3").click();
    document.querySelector<HTMLButtonElement>(".trade-sheet__go")!.click();
    await flush();
    expect(host.said.at(-1)).toBe("You already have an open request.");
    expect(document.querySelector(".trade-sheet--post")).not.toBeNull();
  });
});

describe("swaps only (owner, 16 Nov 2026)", () => {
  it("Today shows one swap left, and the tab has no Send anywhere", async () => {
    await mount(fakeApi());
    const stats = [...document.querySelectorAll(".trade-today__stat")].map((node) => node.textContent);
    expect(stats[0]).toBe(`1${TRADE_TEXT.swap} ${TRADE_TEXT.left}`);
    expect(stats).toHaveLength(3);
    expect(buttonNamed("Send")).toBeUndefined();
    expect(document.body.textContent).not.toMatch(/\bSend\b/);
    expect(document.body.textContent).toContain(TRADE_TEXT.hint);
  });

  it("after today's swap the stat is greyed out", async () => {
    await mount(withView({ today: { ...today, swapsLeft: 0 } }));
    expect(document.querySelector(".trade-today__stat")!.classList.contains("is-used")).toBe(true);
  });

  it("your own request, taken by a mate: no row is left, and the yard refreshes once for what arrived", async () => {
    const api = withView({ requests: [], myTaken: [9] });
    const { tab, host } = await mount(api);
    expect(document.querySelector('.trade-request[data-request="9"]')).toBeNull();
    expect(host.traded).toHaveBeenCalledTimes(1);
    await tab.load();
    expect(host.traded).toHaveBeenCalledTimes(1);
  });

  it("no request of yours taken: the yard is not told", async () => {
    const { host } = await mount(withView({ myTaken: [] }));
    expect(host.traded).not.toHaveBeenCalled();
  });

  it("a reload clears an old line such as Request posted", async () => {
    const { tab, host } = await mount(fakeApi());
    host.say(TRADE_TEXT.posted);
    await tab.load();
    expect(host.said.at(-1)).toBeNull();
  });

  it("short amounts round down: 1,996,000 held is 1.99M, never 2M", async () => {
    await mount(withView({ me: { held: { r1: 5_000_000, r2: 5_000_000, r3: 1_996_000, r4: 5_000_000 }, cap: 20_000_000 }, requests: [request({ amount: 2_000_000, gets: 1_800_000 })] }));
    expect(document.querySelector(".trade-request__why")?.textContent).toBe(TRADE_TEXT.block.short("2M", resourceName("r3"), "1.99M"));
  });
});
