// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatApi, ChatLineWire } from "@/api/chat";
import { ChatSession, type ChatSocket } from "@/game/chat/chatSession";
import { ChatBox, GLOBAL_LABEL } from "./ChatBox";

/**
 * The chat box's room tabs (owner 3 Nov 2026): Global and the player's
 * country room side by side in the open box, Global's English line, and a
 * report from the country room naming that room.
 */

const GLOBAL = "chat:mr2-global";
const PH = "chat:country:PH";

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

const wire = (userId: number, body: string, ts = 1): ChatLineWire => ({
  userId,
  displayName: `[12] p${userId}`,
  body,
  ts,
});

let socket: ReturnType<typeof fakeSocket>;
let session: ChatSession;
let api: { report: ReturnType<typeof vi.fn>; yardOf: ReturnType<typeof vi.fn> };
let box: ChatBox;

const mount = (country: boolean) => {
  session = new ChatSession(() => (socket = fakeSocket()));
  session.configure({
    url: "ws://x",
    userId: 2503,
    token: "t",
    channel: GLOBAL,
    countryChannel: country ? PH : null,
    country: country ? "PH" : null,
  });
  socket.onopen?.();
  socket.hear({ type: "auth_ok", userId: 2503, displayName: "[30] yardtester" });
  socket.hear({ type: "joined", channel: GLOBAL, history: [wire(5, "hello all")] });
  if (country) socket.hear({ type: "joined", channel: PH, history: [wire(6, "kumusta", 77)] });
  box = new ChatBox({ session, api: api as unknown as ChatApi, container: document.body, onViewYard: vi.fn() });
};

const tabs = () => [...box.element.querySelectorAll<HTMLButtonElement>(".chat-box__room")];
const rooms = () => box.element.querySelector<HTMLElement>(".chat-box__rooms")!;
const rule = () => box.element.querySelector<HTMLElement>(".chat-box__rule")!;
const lineTexts = () => [...box.element.querySelectorAll(".chat-line")].map((line) => line.textContent);

beforeEach(() => {
  api = { report: vi.fn().mockResolvedValue(true), yardOf: vi.fn() };
});

afterEach(() => {
  box.destroy();
});

describe("with a country room", () => {
  it("shows Global and the country as tabs in the open box, Global chosen", () => {
    mount(true);
    expect(rooms().hidden).toBe(true);
    box.setOpen(true);
    expect(rooms().hidden).toBe(false);
    expect(tabs().map((tab) => tab.textContent)).toEqual([GLOBAL_LABEL, "Philippines"]);
    const flag = tabs()[1]!.querySelector("img")!;
    expect(flag.getAttribute("src")).toBe("/flags/ph.svg");
    expect(flag.alt).toBe("PH");
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(lineTexts()).toEqual(["[12] p5hello all"]);
  });

  it("says over Global that it is in English, pointing to the country chat", () => {
    mount(true);
    box.setOpen(true);
    expect(rule().hidden).toBe(false);
    expect(rule().textContent).toBe("Global chat is in English. Use your country chat for your own language.");
  });

  it("switches to the country room's lines on its tab, without the English line", () => {
    mount(true);
    box.setOpen(true);
    tabs()[1]!.click();
    expect(lineTexts()).toEqual(["[12] p6kumusta"]);
    expect(rule().hidden).toBe(true);
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    const input = box.element.querySelector<HTMLInputElement>(".chat-box__input")!;
    expect(input.placeholder).toBe("Say something to Philippines…");
  });

  it("marks the country tab when a line comes in there while Global is shown", () => {
    mount(true);
    box.setOpen(true);
    socket.hear({ type: "message", channel: PH, ...wire(6, "musta") });
    expect(tabs()[1]!.classList.contains("chat-box__room--unread")).toBe(true);
    tabs()[1]!.click();
    expect(tabs()[1]!.classList.contains("chat-box__room--unread")).toBe(false);
  });

  it("sends a line to the room shown", () => {
    mount(true);
    box.setOpen(true);
    tabs()[1]!.click();
    const input = box.element.querySelector<HTMLInputElement>(".chat-box__input")!;
    input.value = "kumusta po";
    box.element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(socket.sent.at(-1)).toEqual({ type: "say", channel: PH, message: "kumusta po" });
  });

  it("reports a country room's line as from that room", async () => {
    mount(true);
    box.setOpen(true);
    tabs()[1]!.click();
    box.element.querySelector<HTMLButtonElement>("button.chat-line__name")!.click();
    [...box.element.querySelectorAll<HTMLButtonElement>(".chat-box__player button")]
      .find((button) => button.textContent === "Report")!
      .click();
    [...box.element.querySelectorAll<HTMLButtonElement>(".chat-box__player button")]
      .find((button) => button.textContent === "Report")!
      .click();
    await Promise.resolve();
    expect(api.report).toHaveBeenCalledWith({ userId: 6, channel: PH, body: "kumusta", ts: 77 });
  });

  it("loses the tab when the country changes to one without a room", () => {
    mount(true);
    box.setOpen(true);
    tabs()[1]!.click();
    session.setCountryRoom(null, "SG");
    expect(rooms().hidden).toBe(true);
    expect(tabs()).toHaveLength(0);
    expect(lineTexts()).toEqual(["[12] p5hello all"]);
    expect(rule().textContent).toBe("Global chat is in English.");
  });
});

describe("without a country room", () => {
  it("has no tabs, and Global's English line alone", () => {
    mount(false);
    box.setOpen(true);
    expect(rooms().hidden).toBe(true);
    expect(rule().hidden).toBe(false);
    expect(rule().textContent).toBe("Global chat is in English.");
  });

  it("keeps the folded box as it was: no tabs and no English line", () => {
    mount(false);
    expect(rooms().hidden).toBe(true);
    expect(rule().hidden).toBe(true);
  });
});
