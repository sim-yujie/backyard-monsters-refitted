import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatestMail, MailStatus } from "@/api/mail";
import { MailWatch, mailAlert, newAlertMemory, type MailChat, type PageVisibility } from "./mailWatch";

/**
 * Live mail (owner, beta 7): which message pops up, and when the game asks
 * the server: pushed over chat, else every 45 s while the tab is shown.
 */

const latest = (id: string, time: number, extra: Partial<LatestMail> = {}): LatestMail => ({
  id,
  threadid: 10,
  from: 30,
  name: "Alpha",
  subject: "Hi",
  preview: "Hello there",
  time,
  mod: false,
  notice: false,
  ...extra,
});

const status = (mail: LatestMail | null, unread = mail ? 1 : 0): MailStatus => ({ unread, latest: mail, mod: false });

describe("mailAlert", () => {
  it("does not pop up mail already waiting at the first answer", () => {
    const memory = newAlertMemory();
    expect(mailAlert(memory, status(latest("a", 100)))).toBeNull();
    expect(memory.primed).toBe(true);
    expect(mailAlert(memory, status(latest("a", 100)))).toBeNull();
  });

  it("pops up a new message once", () => {
    const memory = newAlertMemory();
    mailAlert(memory, status(null));
    expect(mailAlert(memory, status(latest("b", 200)))?.id).toBe("b");
    expect(mailAlert(memory, status(latest("b", 200)))).toBeNull();
  });

  it("ignores an older message that comes to the top after the newer was read", () => {
    const memory = newAlertMemory();
    mailAlert(memory, status(latest("a", 100)));
    expect(mailAlert(memory, status(latest("c", 300)))?.id).toBe("c");
    expect(mailAlert(memory, status(latest("b", 200)))).toBeNull();
  });
});

class FakeChat implements MailChat {
  online = false;
  private listeners = new Set<() => void>();
  onMail(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  nudge(): void {
    for (const listener of this.listeners) listener();
  }
  get listening(): number {
    return this.listeners.size;
  }
}

class FakePage implements PageVisibility {
  hidden = false;
  private listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }
  set(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
}

describe("MailWatch", () => {
  let chat: FakeChat;
  let page: FakePage;
  let answer: MailStatus;
  let asked: number;
  let seen: { status: MailStatus; alert: LatestMail | null }[];

  beforeEach(() => {
    vi.useFakeTimers();
    chat = new FakeChat();
    page = new FakePage();
    answer = status(null);
    asked = 0;
    seen = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const watch = () =>
    new MailWatch({
      status: async () => {
        asked++;
        return answer;
      },
      chat,
      page,
      memory: newAlertMemory(),
      pollMs: 45_000,
      nudgeDelayMs: 800,
      now: () => Date.now(),
      onStatus: (status, alert) => seen.push({ status, alert }),
    });

  it("asks at once on start, and polls every 45 s while chat is off line and the tab shown", async () => {
    const w = watch();
    w.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(1);
    answer = status(latest("n", 500), 1);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(asked).toBe(2);
    expect(seen.at(-1)?.alert?.id).toBe("n");
    expect(seen.at(-1)?.status.unread).toBe(1);
    w.stop();
  });

  it("does not poll while chat is on line, or while the tab is hidden", async () => {
    const w = watch();
    chat.online = true;
    w.start();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(asked).toBe(1);
    chat.online = false;
    page.hidden = true;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(asked).toBe(1);
    w.stop();
  });

  it("asks a moment after chat says mail", async () => {
    const w = watch();
    chat.online = true;
    w.start();
    await vi.advanceTimersByTimeAsync(0);
    answer = status(latest("m", 600, { mod: true }), 1);
    chat.nudge();
    await vi.advanceTimersByTimeAsync(799);
    expect(asked).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toBe(2);
    expect(seen.at(-1)?.alert).toMatchObject({ id: "m", mod: true });
    w.stop();
  });

  it("holds a nudge heard while hidden until the tab is shown", async () => {
    const w = watch();
    chat.online = true;
    w.start();
    await vi.advanceTimersByTimeAsync(0);
    page.set(true);
    chat.nudge();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(asked).toBe(1);
    page.set(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(2);
    w.stop();
  });

  it("asks on show when a poll is overdue, not when one was recent", async () => {
    const w = watch();
    w.start();
    await vi.advanceTimersByTimeAsync(0);
    page.set(true);
    page.set(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(1);
    page.set(true);
    await vi.advanceTimersByTimeAsync(60_000);
    page.set(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(2);
    w.stop();
  });

  it("stops listening and asking once stopped", async () => {
    const w = watch();
    w.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.listening).toBe(1);
    w.stop();
    expect(chat.listening).toBe(0);
    chat.nudge();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(asked).toBe(1);
  });
});
