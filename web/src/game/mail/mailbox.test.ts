import { describe, expect, it } from "vitest";
import type { MailMessage } from "@/api/mail";
import {
  contactsOf,
  counterText,
  MESSAGE_LIMIT,
  NO_SUBJECT,
  noticeCell,
  previewOf,
  sendable,
  sentText,
  SYSTEM_SENDER_NAME,
  threadItems,
  threadList,
  unreadThreads,
  YARD_ATTACKED,
} from "./mailbox";

/** What the mailbox screen shows, worked out from the mail routes' answers (#193). */

const NOW = 1_800_000_000;

const message = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  threadid: 1,
  updatetime: NOW - 600,
  userid: 77,
  targetid: 2505,
  messagetype: "message",
  unread: 0,
  subject: "Hello",
  message: "Hi there",
  messagecount: 2,
  ...overrides,
});

const targets = { "77": { first_name: "Bramblefoot" }, "88": { first_name: "Acorn" }, "0": { first_name: "Backyard Monsters" } };

describe("threadList", () => {
  it("names the other party, newest first, the game's notices marked", () => {
    const list = threadList(
      [
        message({ threadid: 1, updatetime: NOW - 600 }),
        message({ threadid: 2, userid: 0, messagetype: "outpostattacked", subject: "Outpost attacked", unread: 1, updatetime: NOW - 60 }),
        message({ threadid: 3, userid: 88, updatetime: NOW - 600 }),
      ],
      targets,
    );
    expect(list.map((one) => one.threadid)).toEqual([2, 3, 1]);
    expect(list[0]).toMatchObject({ otherName: SYSTEM_SENDER_NAME, notice: true, unread: true });
    expect(list[1]).toMatchObject({ otherName: "Acorn", notice: false, unread: false });
    expect(unreadThreads(list)).toBe(1);
  });

  it("gives an unnamed player a name and an empty subject a stand-in", () => {
    const [one] = threadList([message({ userid: 99, subject: "" })], {});
    expect(one).toMatchObject({ otherName: "Player 99", subject: NO_SUBJECT });
  });
});

describe("previewOf", () => {
  it("is the first line that says something, cut to the list's width", () => {
    expect(previewOf("\n  Hello there\nsecond")).toBe("Hello there");
    const long = previewOf("x".repeat(200));
    expect(long.length).toBe(90);
    expect(long.endsWith("…")).toBe(true);
    expect(previewOf(null)).toBe("");
  });
});

describe("threadItems", () => {
  it("tells the player's messages from the other side's, labels truce messages, and places notices", () => {
    const items = threadItems(
      [
        message({ userid: 2505, message: "mine" }),
        message({ userid: 77, messagetype: "trucerequest", message: "truce?" }),
        message({ userid: 0, messagetype: "outposttaken", message: "taken", coords: [241, 208] }),
      ],
      2505,
    );
    expect(items.map((one) => [one.mine, one.notice, one.label])).toEqual([
      [true, false, null],
      [false, false, "Truce request"],
      [false, true, null],
    ]);
    expect(items[2]?.cell).toEqual({ col: 241, row: 208 });
    expect(items[0]?.cell).toBeNull();
  });

  it("gives a Map Room 1 yard's defence notice no cell, so no Show on map (#242)", () => {
    const [item] = threadItems(
      [message({ userid: 0, messagetype: YARD_ATTACKED, message: "Kai_Builds attacked your yard", coords: [0, 0] })],
      2505,
    );
    expect(item).toMatchObject({ notice: true, label: null, type: "yardattacked", cell: null });
  });

  it("gives a notice without whole coordinates no cell", () => {
    expect(noticeCell({ coords: null })).toBeNull();
    expect(noticeCell({ coords: [1.5, 2] })).toBeNull();
  });
});

describe("contactsOf", () => {
  it("lists the people written with, by name, and never the game", () => {
    expect(contactsOf(targets)).toEqual([
      { userid: 88, name: "Acorn" },
      { userid: 77, name: "Bramblefoot" },
    ]);
  });
});

describe("words", () => {
  it("says when, as the list does", () => {
    expect(sentText(NOW - 10, NOW)).toBe("just now");
    expect(sentText(NOW - 300, NOW)).toBe("5 min ago");
    expect(sentText(NOW - 3 * 3600, NOW)).toBe("3 h ago");
    expect(sentText(NOW - 3 * 86_400, NOW)).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  it("sends a trimmed, non-empty message within the limit", () => {
    expect(sendable("  hi  ")).toBe("hi");
    expect(sendable("   ")).toBeNull();
    expect(sendable("x".repeat(MESSAGE_LIMIT + 10))?.length).toBe(MESSAGE_LIMIT);
    expect(counterText("abc")).toBe(`3 / ${MESSAGE_LIMIT}`);
  });
});
