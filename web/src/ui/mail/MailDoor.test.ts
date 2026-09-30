// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { MailApi, MailMessage } from "@/api/mail";
import { MailButton, unreadText } from "./MailButton";
import { MailDoor } from "./MailDoor";
import { YardDock } from "@/ui/yard/YardDock";

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
