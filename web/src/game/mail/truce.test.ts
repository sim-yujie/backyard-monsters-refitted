import { describe, expect, it } from "vitest";
import type { MailItem } from "./mailbox";
import { threadList } from "./mailbox";
import { canPropose, requestIndex, spanText, truceCard, truceState, truceTag, type TruceState } from "./truce";

/** Where a thread's truce stands, and what the mailbox says about it (#203). */

const NOW = 1_800_000_000;
const DAY = 86_400;

const item = (type: string, mine = false): MailItem => ({
  mine,
  notice: false,
  label: null,
  type,
  text: "",
  time: 0,
  cell: null,
});

describe("truceState", () => {
  it.each([
    ["requested", NOW + DAY, "pending"],
    ["requested", NOW, "lapsed"],
    ["requested", null, "pending"],
    ["accepted", NOW + DAY, "active"],
    ["accepted", NOW - 1, "expired"],
    ["rejected", null, "rejected"],
  ] as const)("%s ending at %s is %s", (status, until, state) => {
    expect(truceState({ status, until }, NOW)).toBe(state);
  });

  it("is null for no truce, or a state it does not know", () => {
    expect(truceState(null, NOW)).toBeNull();
    expect(truceState({ status: "migrating", until: null }, NOW)).toBeNull();
  });
});

describe("the rules the screen follows", () => {
  it("a new truce may be proposed unless one waits or runs", () => {
    const states: (TruceState | null)[] = [null, "pending", "active", "expired", "lapsed", "rejected"];
    expect(states.map(canPropose)).toEqual([true, false, false, true, true, true]);
  });

  it("the thread's truce belongs to its last request", () => {
    expect(requestIndex([item("trucerequest"), item("trucereject"), item("trucerequest"), item("message")])).toBe(2);
    expect(requestIndex([item("message")])).toBe(-1);
  });

  it("only the recipient answers, and only while the request waits", () => {
    expect(truceCard("pending", NOW + DAY, false, "Bramble", NOW).canAnswer).toBe(true);
    expect(truceCard("pending", NOW + DAY, true, "Bramble", NOW).canAnswer).toBe(false);
    expect(truceCard("active", NOW + DAY, false, "Bramble", NOW).canAnswer).toBe(false);
  });

  it("says when a running truce ends, and how long is left", () => {
    const card = truceCard("active", NOW + 13 * DAY + 3_600, true, "Bramble", NOW);
    expect(card).toMatchObject({ label: "Active", tone: "good" });
    expect(card.detail).toMatch(
      /^Neither of you can attack the other's yards or outposts until \d+ \w+ \(13 days left\)\.$/,
    );
  });

  it("tags the thread list as Flash's inbox did", () => {
    expect(truceTag("pending")).toEqual({ label: "Truce requested", tone: "info" });
    expect(truceTag("rejected")).toEqual({ label: "Truce rejected", tone: "bad" });
  });

  it("spans read in days, hours or minutes", () => {
    expect([2 * DAY, DAY, 5 * 3_600, 600, 5].map(spanText)).toEqual(["2 days", "1 day", "5 h", "10 min", "1 min"]);
  });
});

describe("threadList keeps each thread's truce", () => {
  const last = {
    threadid: 1,
    updatetime: NOW,
    userid: 77,
    targetid: 2505,
    messagetype: "trucerequest",
    subject: "s",
    message: "m",
  };

  it("with its end, or none", () => {
    const [withTruce, without] = threadList(
      [
        { ...last, trucestate: "accepted", truceexpire: NOW + DAY },
        { ...last, threadid: 2, updatetime: NOW - 1, messagetype: "message", trucestate: null },
      ],
      {},
    );
    expect(withTruce?.truce).toEqual({ status: "accepted", until: NOW + DAY });
    expect(without?.truce).toBeNull();
  });
});
