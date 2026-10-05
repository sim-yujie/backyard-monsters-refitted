// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatApi, ChatLineWire } from "@/api/chat";
import { ApiError } from "@/api/http";
import { ChatSession, RATE_LIMITED_TEXT, type ChatSocket } from "@/game/chat/chatSession";
import { ChatBox } from "./ChatBox";

const CHANNEL = "chat:mr2-global";

/** A socket that records what the client sent and lets the test speak for the server. */
const fakeSocket = () => {
  const socket: ChatSocket & { sent: Record<string, unknown>[]; hear(message: object): void } =
    {
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

const wire = (
  userId: number,
  body: string,
  ts: number,
  displayName = `[12] p${userId}`,
): ChatLineWire => ({
  userId,
  displayName,
  body,
  ts,
});

let socket: ReturnType<typeof fakeSocket>;
let session: ChatSession;
let api: { report: ReturnType<typeof vi.fn>; yardOf: ReturnType<typeof vi.fn> };
let onViewYard: ReturnType<typeof vi.fn>;
let box: ChatBox;

const mount = (history: ChatLineWire[]) => {
  session = new ChatSession(() => (socket = fakeSocket()));
  session.configure({ url: "ws://x", userId: 2505, token: "t", channel: CHANNEL });
  socket.onopen?.();
  socket.hear({ type: "auth_ok", userId: 2505, displayName: "[27] agenttester" });
  socket.hear({ type: "joined", channel: CHANNEL, history });
  box = new ChatBox({
    session,
    api: api as unknown as ChatApi,
    container: document.body,
    onViewYard,
  });
};

const lineTexts = () =>
  [...box.element.querySelectorAll(".chat-line")].map((line) => line.textContent);
const nameButton = (name: string) =>
  [...box.element.querySelectorAll<HTMLButtonElement>("button.chat-line__name")].find(
    (button) => button.textContent === name,
  )!;
const strip = () => box.element.querySelector<HTMLElement>(".chat-box__player")!;
const stripButton = (label: string) =>
  [...strip().querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
  api = { report: vi.fn(async () => {}), yardOf: vi.fn() };
  onViewYard = vi.fn(async () => {});
});

describe("ChatBox", () => {
  it("shows the room's lines with the server's [level] names, and marks the player's own", () => {
    mount([wire(77, "hello", 1), wire(2505, "hi back", 2, "[27] agenttester")]);
    expect(lineTexts()).toEqual(["[12] p77hello", "[27] agenttesterhi back"]);
    const own = box.element.querySelectorAll(".chat-line")[1]!;
    expect(own.classList.contains("chat-line--own")).toBe(true);
    // Your own name offers nothing to do.
    expect(own.querySelector("button")).toBeNull();
  });

  it("starts folded, and the tab opens it to the input", () => {
    mount([]);
    expect(box.isOpen).toBe(false);
    expect(box.element.classList.contains("chat-box--open")).toBe(false);
    box.element.querySelector<HTMLButtonElement>(".chat-box__tab")!.click();
    expect(box.isOpen).toBe(true);
    expect(document.activeElement).toBe(box.element.querySelector(".chat-box__input"));
  });

  it("folded, a name does nothing (the yard under it keeps its clicks)", () => {
    mount([wire(77, "hello", 1)]);
    nameButton("[12] p77").click();
    expect(strip().hidden).toBe(true);
  });

  it("sends what is typed and clears the input", () => {
    mount([]);
    box.setOpen(true);
    const input = box.element.querySelector<HTMLInputElement>(".chat-box__input")!;
    input.value = "hello world";
    box.element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(socket.sent.at(-1)).toEqual({
      type: "say",
      channel: CHANNEL,
      message: "hello world",
    });
    expect(input.value).toBe("");
  });

  it("a rate limit says so kindly and puts the words back", () => {
    mount([]);
    box.setOpen(true);
    const input = box.element.querySelector<HTMLInputElement>(".chat-box__input")!;
    input.value = "too fast";
    box.element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    socket.hear({ type: "error", code: "rate_limited" });
    expect(lineTexts().at(-1)).toBe(RATE_LIMITED_TEXT);
    expect(input.value).toBe("too fast");
  });

  it("a name opens the player's strip; Mute hides their lines, and Unmute brings them back", () => {
    mount([wire(77, "noise", 1), wire(78, "fine", 2)]);
    box.setOpen(true);
    nameButton("[12] p77").click();
    expect(strip().hidden).toBe(false);
    expect(strip().textContent).toContain("[12] p77");

    stripButton("Mute").click();
    expect(socket.sent.at(-1)).toEqual({ type: "ignore", targetId: "77" });
    expect(lineTexts()).toEqual(["[12] p78fine"]);

    session.unmute(77);
    expect(lineTexts()).toHaveLength(2);
  });

  it("Report asks first, then sends who said the line, where and when", async () => {
    mount([wire(77, "rude words", 1_700_000_000_123)]);
    box.setOpen(true);
    nameButton("[12] p77").click();
    stripButton("Report").click();
    expect(strip().textContent).toContain("Report this message from [12] p77?");
    expect(api.report).not.toHaveBeenCalled();

    stripButton("Report").click();
    await flush();
    expect(api.report).toHaveBeenCalledWith({
      userId: 77,
      channel: CHANNEL,
      body: "rude words",
      ts: 1_700_000_000_123,
    });
    expect(strip().textContent).toContain("Thanks. The moderators will take a look.");
  });

  it("a refused report shows the server's words", async () => {
    api.report.mockRejectedValue(
      new ApiError("x", { status: 429, code: "You have sent a lot of reports." }),
    );
    mount([wire(77, "rude words", 1)]);
    box.setOpen(true);
    nameButton("[12] p77").click();
    stripButton("Report").click();
    stripButton("Report").click();
    await flush();
    expect(strip().textContent).toContain("You have sent a lot of reports.");
  });

  it("View yard hands the player to the scene, and says so when it fails", async () => {
    mount([wire(77, "hello", 1)]);
    box.setOpen(true);
    nameButton("[12] p77").click();
    stripButton("View yard").click();
    expect(onViewYard).toHaveBeenCalledWith(77);

    onViewYard.mockRejectedValue(new Error("No yard"));
    stripButton("View yard").click();
    await flush();
    expect(strip().textContent).toContain("That player's yard could not be opened.");
  });

  it("while reconnecting it says so quietly and the input waits", () => {
    mount([wire(77, "hello", 1)]);
    box.setOpen(true);
    socket.onclose?.({ code: 1006 });
    const status = box.element.querySelector<HTMLElement>(".chat-box__status")!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain("Reconnecting");
    expect(box.element.querySelector<HTMLInputElement>(".chat-box__input")!.disabled).toBe(
      true,
    );
    // The lines heard so far stay.
    expect(lineTexts()).toEqual(["[12] p77hello"]);
  });

  it("steps aside while hidden, and destroy lets go of the session", () => {
    mount([]);
    box.setHidden(true);
    expect(box.element.hidden).toBe(true);
    box.destroy();
    expect(document.body.contains(box.element)).toBe(false);
    socket.hear({ type: "message", channel: CHANNEL, ...wire(77, "after", 3) });
    expect(box.element.querySelectorAll(".chat-line")).toHaveLength(0);
  });
});
