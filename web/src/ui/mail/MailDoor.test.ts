// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { LatestMail, MailApi, MailMessage, MailStatus } from "@/api/mail";
import { newAlertMemory, type MailChat } from "@/game/mail/mailWatch";
import { MailButton, unreadText } from "./MailButton";
import { MailDoor } from "./MailDoor";
import { YardDock } from "@/ui/yard/YardDock";
import { friendsStore } from "@/game/friends/friendsStore";
import { fixtureFriend } from "@/game/friends/friendsFixture";

/** The Mail button's badge, and the door that decides what it says (#193). */

const badge = (button: MailButton) => button.element.querySelector<HTMLElement>(".mail-badge")!;

describe("MailButton", () => {
  it("shows the count only when there is one, capped, and says it to a screen reader", () => {
    const button = new MailButton({ style: "dock", onOpen: vi.fn() });
    expect(badge(button).hidden).toBe(true);
    expect(button.element.getAttribute("aria-label")).toBe("Mail");

    button.setCount(3);
    expect(badge(button).hidden).toBe(false);
    expect(badge(button).textContent).toBe("3");
    expect(button.element.getAttribute("aria-label")).toBe("Mail. 3 unread messages");

    button.setCount(250);
    expect(badge(button).textContent).toBe("99+");
    expect(unreadText(1)).toBe("1 unread message");
  });

  it("dresses as a dock button on the yard and a tool button on the map, and opens on a press", () => {
    const onOpen = vi.fn();
    const dock = new MailButton({ style: "dock", onOpen });
    const tool = new MailButton({ style: "tool", onOpen });
    expect(dock.element.classList.contains("yard-dock__button")).toBe(true);
    expect(dock.element.dataset["dock"]).toBe("mail");
    expect(tool.element.classList.contains("mr2-tool")).toBe(true);
    tool.element.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("MailDoor", () => {
  const unread = (threadid: number): MailMessage => ({
    threadid,
    updatetime: 1,
    userid: 77,
    targetid: 2505,
    messagetype: "message",
    unread: 1,
    subject: "s",
    message: "m",
  });

  const api = (threads: MailMessage[]): MailApi => ({
    threads: vi.fn(async () => threads),
    targets: vi.fn(async () => ({})),
    thread: vi.fn(async () => []),
    send: vi.fn(),
    requestTruce: vi.fn(),
    block: vi.fn(),
    acceptInvite: vi.fn(),
    declineInvite: vi.fn(),
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  it("starts from the save's count, takes the mailbox's once it has looked, and a new save's after", async () => {
    const container = document.createElement("div");
    const door = new MailDoor({ style: "dock", container, api: api([unread(1)]) });
    door.setSaveUnread(4);
    expect(door.button.unread).toBe(4);

    await door.open();
    await settle();
    expect(door.isOpen).toBe(true);
    expect(door.button.unread).toBe(1);

    // The same save again says nothing new; a recounted one takes over.
    door.setSaveUnread(4);
    expect(door.button.unread).toBe(1);
    door.setSaveUnread(0);
    expect(door.button.unread).toBe(0);
  });

  it("lets the scene make room before the mailbox opens, and writes to a player it names", async () => {
    const container = document.createElement("div");
    const onOpen = vi.fn();
    const door = new MailDoor({ style: "tool", container, onOpen, api: api([]) });
    await door.openCompose({ userid: 123, name: "Thistle" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".mail-compose__fixed")?.textContent).toBe("To Thistle");
    door.close();
    expect(door.isOpen).toBe(false);
  });

  it("offers the shared friends list's friends as recipients of a new message", async () => {
    const refresh = vi.spyOn(friendsStore, "refresh").mockResolvedValue(undefined);
    const listed = vi.spyOn(friendsStore, "friends", "get").mockReturnValue([fixtureFriend(3119, { username: "Dmtwo" })]);
    const container = document.createElement("div");
    const door = new MailDoor({ style: "dock", container, api: api([]) });
    await door.open();
    await settle();
    container.querySelector<HTMLButtonElement>(".mail-list__new")!.click();
    const to = container.querySelector<HTMLSelectElement>(".mail-compose__to")!;
    expect([...to.options].map((option) => [option.value, option.textContent])).toEqual([["3119", "Dmtwo"]]);
    expect(refresh).toHaveBeenCalled();
    refresh.mockRestore();
    listed.mockRestore();
    door.destroy();
  });
});

describe("the yard dock's place for Mail", () => {
  it("puts the Mail button right after Monsters", () => {
    const dock = new YardDock({ onMap: vi.fn(), onLayout: vi.fn(), onBuild: vi.fn() });
    const mail = new MailButton({ style: "dock", onOpen: vi.fn() });
    dock.placeBesideMonsters(mail.element);
    const names = [...dock.element.querySelectorAll<HTMLElement>("[data-dock]")].map((one) => one.dataset["dock"]);
    expect(names.indexOf("mail")).toBe(names.indexOf("monsters") + 1);
    dock.destroy();
  });
});

describe("MailDoor, live (owner, beta 7)", () => {
  const thread = (threadid: number, extra: Partial<MailMessage> = {}): MailMessage => ({
    threadid,
    updatetime: 1,
    userid: 30,
    targetid: 2503,
    messagetype: "message",
    unread: 1,
    subject: "From a moderator",
    message: "Hello",
    ...extra,
  });

  const latest = (id: string, threadid: number, time: number): LatestMail => ({
    id,
    threadid,
    from: 30,
    name: "Alpha",
    subject: "From a moderator",
    preview: "Hello",
    time,
    mod: true,
    notice: false,
  });

  const liveApi = (answers: MailStatus[], threads: MailMessage[] = []) => {
    let at = 0;
    const api: MailApi = {
      threads: vi.fn(async () => threads),
      targets: vi.fn(async () => ({})),
      thread: vi.fn(async () => []),
      send: vi.fn(),
      requestTruce: vi.fn(),
      block: vi.fn(),
      acceptInvite: vi.fn(),
      declineInvite: vi.fn(),
      status: vi.fn(async () => answers[Math.min(at++, answers.length - 1)]!),
    };
    return api;
  };

  class Chat implements MailChat {
    online = true;
    listener: (() => void) | null = null;
    onMail(listener: () => void): () => void {
      this.listener = listener;
      return () => (this.listener = null);
    }
  }

  const settleTimers = async (ms = 0): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  it("counts unread on the badge at once, and pops up a message that arrives later", async () => {
    vi.useFakeTimers();
    const chat = new Chat();
    const api = liveApi([
      { unread: 2, latest: latest("old", 1, 100), mod: false },
      { unread: 3, latest: latest("new", 7, 200), mod: false },
    ]);
    const container = document.createElement("div");
    const door = new MailDoor({
      style: "dock",
      container,
      api,
      live: { chat, memory: newAlertMemory(), nudgeDelayMs: 10 },
    });
    await settleTimers();
    expect(door.button.unread).toBe(2);
    expect(door.liveToast?.isShown).toBe(false);

    chat.listener?.();
    await settleTimers(10);
    expect(door.button.unread).toBe(3);
    expect(door.liveToast?.isShown).toBe(true);
    expect(container.querySelector(".mail-toast__who")?.textContent).toBe("ModAlpha");
    door.destroy();
    expect(chat.listener).toBeNull();
    vi.useRealTimers();
  });

  it("opens the message's thread from the pop-up", async () => {
    vi.useFakeTimers();
    const chat = new Chat();
    const api = liveApi(
      [
        { unread: 0, latest: null, mod: false },
        { unread: 1, latest: latest("new", 7, 200), mod: false },
      ],
      [thread(7)],
    );
    const container = document.createElement("div");
    const door = new MailDoor({ style: "dock", container, api, live: { chat, memory: newAlertMemory(), nudgeDelayMs: 10 } });
    await settleTimers();
    chat.listener?.();
    await settleTimers(10);
    container.querySelector<HTMLButtonElement>(".mail-toast__open")!.click();
    await settleTimers();
    expect(door.isOpen).toBe(true);
    expect(api.thread).toHaveBeenCalled();
    expect(door.liveToast?.isShown).toBe(false);
    door.destroy();
    vi.useRealTimers();
  });

  it("fetches the open mailbox's list again instead of popping up", async () => {
    vi.useFakeTimers();
    const chat = new Chat();
    const api = liveApi([
      { unread: 0, latest: null, mod: false },
      { unread: 1, latest: latest("new", 7, 200), mod: false },
    ]);
    const container = document.createElement("div");
    const door = new MailDoor({ style: "dock", container, api, live: { chat, memory: newAlertMemory(), nudgeDelayMs: 10 } });
    await settleTimers();
    await door.open();
    await settleTimers();
    const before = vi.mocked(api.threads).mock.calls.length;
    chat.listener?.();
    await settleTimers(10);
    expect(vi.mocked(api.threads).mock.calls.length).toBe(before + 1);
    expect(door.liveToast?.isShown).toBe(false);
    door.destroy();
    vi.useRealTimers();
  });

  it("does not watch without live, or with an API that cannot tell", () => {
    const container = document.createElement("div");
    const plain = new MailDoor({ style: "dock", container, api: liveApi([{ unread: 0, latest: null, mod: false }]) });
    expect(plain.liveWatch).toBeNull();
    expect(container.querySelector(".mail-toast")).toBeNull();
    plain.destroy();
  });
});
