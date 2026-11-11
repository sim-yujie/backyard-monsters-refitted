// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatApi, ChatLineWire } from "@/api/chat";
import { ALLIANCE_ROOM, ChatSession, type ChatSocket } from "@/game/chat/chatSession";
import { setAllianceOpener } from "@/game/alliance/allianceView";
import { ALLIANCE_ROOM_TEXT, ChatBox, GLOBAL_LABEL } from "./ChatBox";

/**
 * The chat box's Alliance room (beta 7, design v5 §7c): its tab between
 * Global and the country room with the alliance's own shield, automatic lines
 * as plain notes with a Map button on an under-attack alert, and no Report.
 */

const GLOBAL = "chat:mr2-global";
const PH = "chat:country:PH";
const KEY = "chat:alliance:7";

const fakeSocket = () => {
  const socket: ChatSocket & { sent: Record<string, unknown>[]; hear(message: object): void } = {
    sent: [],
    send(data) {
      this.sent.push(JSON.parse(data) as Record<string, unknown>);
    },
    close() {},
    onopen: null,
    onmessage: null,
    onclose: null,
    hear(message) {
      this.onmessage?.({ data: JSON.stringify(message) });
    },
  };
  return socket;
};

const wire = (userId: number, body: string, extra: Partial<ChatLineWire> = {}): ChatLineWire => ({
  userId,
  displayName: `[12] p${userId}`,
  body,
  ts: 1,
  ...extra,
});

let socket: ReturnType<typeof fakeSocket>;
let session: ChatSession;
let api: { report: ReturnType<typeof vi.fn>; yardOf: ReturnType<typeof vi.fn> };
let onShowOnMap: ReturnType<typeof vi.fn>;
let box: ChatBox;

const mount = (withMap = true) => {
  session = new ChatSession(() => (socket = fakeSocket()));
  session.configure({
    url: "ws://x",
    userId: 2503,
    token: "t",
    channel: GLOBAL,
    countryChannel: PH,
    country: "PH",
    alliance: { id: 7, name: "Goo Gang", image: 12 },
  });
  socket.onopen?.();
  socket.hear({ type: "auth_ok", userId: 2503, displayName: "[30] yardtester" });
  socket.hear({ type: "joined", channel: GLOBAL, history: [wire(5, "hello all")] });
  socket.hear({ type: "joined", channel: KEY, history: [wire(8, "hi gang", { messageType: "message" })] });
  socket.hear({ type: "joined", channel: PH, history: [wire(6, "kumusta")] });
  box = new ChatBox({
    session,
    api: api as unknown as ChatApi,
    container: document.body,
    onViewYard: vi.fn(),
    ...(withMap ? { onShowOnMap } : {}),
  });
  box.setOpen(true);
};

const tabs = () => [...box.element.querySelectorAll<HTMLButtonElement>(".chat-box__room")];
const rule = () => box.element.querySelector<HTMLElement>(".chat-box__rule")!;
const alert = (x = 12, y = 40) =>
  socket.hear({
    type: "message",
    channel: KEY,
    ...wire(0, `Ana's outpost (${x}, ${y}) is under attack by Bob!`, { messageType: "under_attack", cell: { x, y } }),
  });

beforeEach(() => {
  api = { report: vi.fn().mockResolvedValue(true), yardOf: vi.fn() };
  onShowOnMap = vi.fn();
});

afterEach(() => {
  box.destroy();
});

describe("the Alliance tab", () => {
  it("sits between Global and the country, with the alliance's own shield", () => {
    mount();
    expect(tabs().map((tab) => tab.textContent)).toEqual([GLOBAL_LABEL, ALLIANCE_ROOM_TEXT.tab, "Philippines"]);
    const shield = tabs()[1]!.querySelector("img")!;
    expect(shield.getAttribute("src")).toBe("/assets/alliances/12_small.png");
    expect(tabs()[1]!.title).toBe("Goo Gang");
  });

  it("shows the alliance's lines, says to the alliance, and drops the English line", () => {
    mount();
    tabs()[1]!.click();
    expect(session.current.channel).toBe(ALLIANCE_ROOM);
    expect(rule().hidden).toBe(true);
    const input = box.element.querySelector<HTMLInputElement>(".chat-box__input")!;
    expect(input.placeholder).toBe("Say something to Goo Gang…");
    input.value = "on my way";
    box.element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(socket.sent.at(-1)).toEqual({ type: "say", channel: KEY, message: "on my way" });
  });

  it("goes when the server says the player left the alliance", () => {
    mount();
    tabs()[1]!.click();
    socket.hear({ type: "left", channel: KEY });
    expect(tabs().map((tab) => tab.textContent)).toEqual([GLOBAL_LABEL, "Philippines"]);
    expect(rule().hidden).toBe(false);
  });
});

describe("automatic lines", () => {
  it("an under-attack alert is a plain note with a Map button to its cell", () => {
    mount();
    tabs()[1]!.click();
    alert();
    const line = box.element.querySelector<HTMLElement>(".chat-line--alert")!;
    expect(line.classList.contains("chat-line--auto")).toBe(true);
    expect(line.querySelector(".chat-line__name")).toBeNull();
    expect(line.querySelector(".chat-line__body")!.textContent).toBe("Ana's outpost (12, 40) is under attack by Bob!");
    const map = line.querySelector<HTMLButtonElement>(".chat-line__map")!;
    expect(map.textContent).toBe(ALLIANCE_ROOM_TEXT.map);
    expect(map.getAttribute("aria-label")).toBe("Show on map (12, 40)");
    map.click();
    expect(onShowOnMap).toHaveBeenCalledWith({ x: 12, y: 40 });
  });

  it("a join line has no Map button", () => {
    mount();
    tabs()[1]!.click();
    socket.hear({ type: "message", channel: KEY, ...wire(0, "Cy joined.", { messageType: "join" }) });
    const line = [...box.element.querySelectorAll<HTMLElement>(".chat-line--auto")].at(-1)!;
    expect(line.classList.contains("chat-line--alert")).toBe(false);
    expect(line.querySelector(".chat-line__map")).toBeNull();
  });

  it("no Map button where the box has no map to open", () => {
    mount(false);
    tabs()[1]!.click();
    alert();
    expect(box.element.querySelector(".chat-line__map")).toBeNull();
  });

  it("the Map button does nothing in the folded box", () => {
    mount();
    tabs()[1]!.click();
    alert();
    box.setOpen(false);
    box.element.querySelector<HTMLButtonElement>(".chat-line__map")?.click();
    expect(onShowOnMap).not.toHaveBeenCalled();
  });
});

describe("a member's line", () => {
  const actionWords = () =>
    [...box.element.querySelectorAll<HTMLButtonElement>(".chat-box__player button")].map(
      (button) => button.textContent,
    );

  it("offers no Report in the Alliance room", () => {
    mount();
    tabs()[1]!.click();
    box.element.querySelector<HTMLButtonElement>("button.chat-line__name")!.click();
    expect(actionWords()).not.toContain("Report");
  });

  it("still offers Report in Global", () => {
    mount();
    box.element.querySelector<HTMLButtonElement>("button.chat-line__name")!.click();
    expect(actionWords()).toContain("Report");
  });
});

describe("trading in the Alliance room (design v5 §7c)", () => {
  const opened: unknown[][] = [];
  let clear: () => void = () => {};
  beforeEach(() => {
    opened.length = 0;
    clear = setAllianceOpener((...args) => {
      opened.push(args);
    });
  });
  afterEach(() => clear());

  it("a trade request line has Trade, which opens the Trade tab on it", () => {
    mount();
    tabs()[1]!.click();
    socket.hear({
      type: "message",
      channel: KEY,
      ...wire(0, "PebbleKing gives 1K Twigs for 1K Goo.", { messageType: "trade_ask", tradeRequest: 41 }),
    });
    const give = box.element.querySelector<HTMLButtonElement>(".chat-line__give")!;
    expect(give.textContent).toBe(ALLIANCE_ROOM_TEXT.trade);
    give.click();
    expect(opened).toEqual([["trade", { request: 41 }]]);
  });

  it("a mate's name offers Send in the Alliance room only", () => {
    mount();
    box.element.querySelector<HTMLButtonElement>("button.chat-line__name")!.click();
    expect(box.element.querySelector('[data-action="income"]')).toBeNull();
    tabs()[1]!.click();
    box.element.querySelector<HTMLButtonElement>("button.chat-line__name")!.click();
    box.element.querySelector<HTMLButtonElement>('[data-action="income"]')!.click();
    expect(opened[0]?.[0]).toBe("trade");
    expect(opened[0]?.[1]).toMatchObject({ send: {} });
  });
});
