// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatApi } from "@/api/chat";
import { ChatSession } from "@/game/chat/chatSession";
import { setWorldChatOn } from "@/game/chat/worldChatSetting";
import { WorldChatBox } from "./WorldChatBox";

let container: HTMLElement;

const mount = (): WorldChatBox => {
  const session = new ChatSession(() => {
    throw new Error("no socket in this test");
  });
  return new WorldChatBox({
    session,
    api: {} as ChatApi,
    container,
    onViewYard: vi.fn(),
  });
};

/** The container's children, by class or as a comment: what sits where. */
const layout = () =>
  [...container.childNodes].map((node) =>
    node instanceof HTMLElement ? node.className.split(" ")[0] : node.nodeName,
  );

beforeEach(() => {
  localStorage.clear();
  setWorldChatOn(true);
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  setWorldChatOn(true);
  document.body.replaceChildren();
});

describe("WorldChatBox", () => {
  it("shows the chat box while World chat is on", () => {
    const chat = mount();
    expect(chat.current).not.toBeNull();
    expect(container.querySelector(".chat-box")).not.toBeNull();
  });

  it("shows nothing at all when World chat is off", () => {
    setWorldChatOn(false);
    const chat = mount();
    expect(chat.current).toBeNull();
    expect(container.querySelector(".chat-box")).toBeNull();
  });

  it("takes the box away when switched off and brings it back in its place when on", () => {
    const before = document.createElement("div");
    before.className = "hud";
    container.append(before);
    const chat = mount();
    const after = document.createElement("div");
    after.className = "notices";
    container.append(after);
    expect(layout()).toEqual(["hud", "#comment", "chat-box", "notices"]);

    setWorldChatOn(false);
    expect(container.querySelector(".chat-box")).toBeNull();

    setWorldChatOn(true);
    expect(layout()).toEqual(["hud", "#comment", "chat-box", "notices"]);
    expect(chat.current).not.toBeNull();
  });

  it("a box brought back while the planner has the screen stays out of the way", () => {
    const chat = mount();
    chat.setHidden(true);
    setWorldChatOn(false);
    setWorldChatOn(true);
    expect(container.querySelector<HTMLElement>(".chat-box")!.hidden).toBe(true);
    chat.setHidden(false);
    expect(container.querySelector<HTMLElement>(".chat-box")!.hidden).toBe(false);
  });

  it("stops following the switch once destroyed", () => {
    const chat = mount();
    chat.destroy();
    expect(container.childNodes).toHaveLength(0);
    setWorldChatOn(false);
    setWorldChatOn(true);
    expect(container.childNodes).toHaveLength(0);
  });
});
