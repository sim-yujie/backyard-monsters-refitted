import { describe, expect, it } from "vitest";
import { inviteCard, inviteIndex, invitePriceText, inviteState, inviteTag } from "./invite";
import { threadItems, threadList } from "./mailbox";
import type { MailItem } from "./mailbox";
import type { MailMessage } from "@/api/mail";

/** An invitation to move, and what the mailbox says about it (#205). */

const NOW = 1_800_000_000;
const DAY = 86_400;
const CELL = { col: 241, row: 208 };

const item = (type: string): MailItem => ({
  mine: false,
  notice: false,
  label: null,
  type,
  text: "",
  time: 0,
  cell: null,
  invite: null,
});

describe("where an invitation stands", () => {
  it("reads the server's states, and a waiting one past its lapse as lapsed", () => {
    expect(inviteState(null, NOW)).toBeNull();
    expect(inviteState({ status: "requested", until: NOW + DAY }, NOW)).toBe("pending");
    expect(inviteState({ status: "requested", until: NOW }, NOW)).toBe("lapsed");
    expect(inviteState({ status: "requested", until: null }, NOW)).toBe("pending");
    expect(inviteState({ status: "accepted", until: NOW - DAY }, NOW)).toBe("accepted");
    expect(inviteState({ status: "rejected", until: null }, NOW)).toBe("declined");
    expect(inviteState({ status: "revoked", until: null }, NOW)).toBe("withdrawn");
    expect(inviteState({ status: "expired", until: null }, NOW)).toBe("lapsed");
    expect(inviteState({ status: "void", until: null }, NOW)).toBe("void");
    expect(inviteState({ status: "odd", until: null }, NOW)).toBeNull();
  });

  it("belongs to the thread's last invitation", () => {
    expect(inviteIndex([item("migraterequest"), item("message"), item("migraterequest"), item("message")])).toBe(2);
    expect(inviteIndex([item("message")])).toBe(-1);
  });

  it("tags the thread in the list", () => {
    expect(inviteTag("pending")).toEqual({ label: "Move invitation", tone: "info" });
    expect(inviteTag("accepted")).toEqual({ label: "Move accepted", tone: "good" });
    expect(inviteTag("void")).toEqual({ label: "Move invitation void", tone: "muted" });
  });
});

describe("the invitation's card", () => {
  it("to the one invited, while it waits: what it costs, what happens, when to answer by, and the answers", () => {
    const card = inviteCard("pending", NOW + 6 * DAY, false, "Bramblefoot", CELL, NOW);
    expect(card).toMatchObject({ label: "Waiting", tone: "info", canAnswer: true, canWithdraw: false });
    expect(card.detail).toContain("Bramblefoot invites you to move your main yard onto their outpost at (241, 208)");
    expect(card.detail).toContain("10,000,000 of each resource or 1,200 Shiny");
    expect(card.detail).toContain("Your outposts stay yours");
    expect(card.detail).toContain("(6 days left)");
  });

  it("to the one who invited, while it waits: that the outpost goes, and Withdraw", () => {
    const card = inviteCard("pending", NOW + DAY, true, "Bramblefoot", CELL, NOW);
    expect(card).toMatchObject({ canAnswer: false, canWithdraw: true });
    expect(card.detail).toContain("Waiting for Bramblefoot to answer.");
    expect(card.detail).toContain("your outpost at (241, 208) and everything on it is replaced by their yard");
  });

  it.each([
    ["accepted", false, "Accepted", "You moved your main yard to (241, 208)."],
    ["accepted", true, "Accepted", "Bramblefoot moved their main yard onto your outpost at (241, 208)."],
    ["declined", true, "Declined", "Bramblefoot declined. The outpost stays yours."],
    ["declined", false, "Declined", "You declined the invitation."],
    ["withdrawn", false, "Withdrawn", "Bramblefoot withdrew the invitation."],
    ["withdrawn", true, "Withdrawn", "You withdrew the invitation."],
    ["lapsed", false, "Lapsed", "so the invitation lapsed."],
    ["void", false, "Void", "The outpost at (241, 208) changed hands, so the invitation is void."],
  ] as const)("once %s (the sender: %s) it reads %s, with no buttons", (state, mine, label, words) => {
    const card = inviteCard(state, NOW - DAY, mine, "Bramblefoot", CELL, NOW);
    expect(card.label).toBe(label);
    expect(card.detail).toContain(words);
    expect(card.canAnswer || card.canWithdraw).toBe(false);
  });

  it("names the two prices", () => {
    expect(invitePriceText("resources")).toBe("10,000,000 of each resource");
    expect(invitePriceText("shiny")).toBe("1,200 Shiny");
  });
});

describe("the invitation as the routes give it", () => {
  const request: MailMessage = {
    threadid: 4,
    updatetime: NOW,
    userid: 77,
    targetid: 2505,
    messagetype: "migraterequest",
    subject: "Let's Join Forces",
    message: "Move your main yard next to mine.",
    coords: [241, 208],
    baseid: "2000241208",
    migratestate: "requested",
    migrateexpire: NOW + 7 * DAY,
  };

  it("the thread list carries the thread's invitation", () => {
    expect(threadList([request], {})[0]?.invite).toEqual({ status: "requested", until: NOW + 7 * DAY, cell: CELL });
    expect(threadList([{ ...request, migratestate: null }], {})[0]?.invite).toBeNull();
  });

  it("the thread carries it on its message, and no notice's Show on map", () => {
    const [one] = threadItems([request], 2505);
    expect(one).toMatchObject({ label: "Invitation to move", cell: null, invite: { status: "requested", cell: CELL } });
    expect(threadItems([{ ...request, messagetype: "migraterevoke" }], 2505)[0]).toMatchObject({
      label: "Invitation withdrawn",
      invite: null,
    });
  });
});
