// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InviteAnswer, InvitePayment, MailApi, MailMessage, MailTarget, Outgoing, SendResult } from "@/api/mail";
import { MailboxScreen, type MailboxScreenOptions } from "./MailboxScreen";

/**
 * The mailbox screen (#193) over a fake mail API: the list, a thread, a
 * notice, a reply, a new message and Block, each against what the routes
 * would answer.
 */

const ME = 2505;
const NOW = 1_800_000_000;

const message = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  threadid: 1,
  updatetime: NOW - 600,
  userid: 77,
  targetid: ME,
  messagetype: "message",
  unread: 0,
  subject: "Hello",
  message: "Hi there",
  messagecount: 1,
  ...overrides,
});

interface FakeApi extends MailApi {
  sent: Outgoing[];
  blocked: number[];
  proposed: { baseid: string; message: string }[];
  /** Invitations answered (#205): accepted with a payment, or declined. */
  answered: { threadid: number; payment: InvitePayment | "declined" }[];
  sendResult: SendResult;
  answerResult: InviteAnswer;
  lists: MailMessage[][];
}

const fakeApi = (
  lists: MailMessage[][],
  threads: Record<number, MailMessage[]>,
  targets: Record<string, MailTarget> = { "77": { first_name: "Bramblefoot" }, "88": { first_name: "Acorn" } },
): FakeApi => {
  const api: FakeApi = {
    sent: [],
    blocked: [],
    proposed: [],
    answered: [],
    sendResult: { ok: true, threadid: 1 },
    answerResult: { ok: true, coords: [241, 208] },
    lists,
    // Each fetch answers the next list, the last one for ever after.
    threads: vi.fn(async () => (api.lists.length > 1 ? api.lists.shift()! : api.lists[0]!)),
    targets: vi.fn(async () => targets),
    thread: vi.fn(async (threadid: number) => threads[threadid] ?? []),
    send: vi.fn(async (outgoing: Outgoing) => {
      api.sent.push(outgoing);
      return api.sendResult;
    }),
    requestTruce: vi.fn(async (baseid: string, text: string) => {
      api.proposed.push({ baseid, message: text });
      return api.sendResult;
    }),
    block: vi.fn(async (threadid: number) => {
      api.blocked.push(threadid);
    }),
    acceptInvite: vi.fn(async (threadid: number, payment: InvitePayment) => {
      api.answered.push({ threadid, payment });
      return api.answerResult;
    }),
    declineInvite: vi.fn(async (threadid: number) => {
      api.answered.push({ threadid, payment: "declined" });
      return api.answerResult;
    }),
  };
  return api;
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const openScreen = async (api: MailApi, overrides: Partial<MailboxScreenOptions> = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const onUnreadChange = vi.fn();
  const screen = new MailboxScreen({ api, myId: () => ME, now: () => NOW, onUnreadChange, ...overrides }).mount(host);
  await screen.open();
  await settle();
  return { screen, host, onUnreadChange };
};

const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>(".mail-row")];
const click = (node: Element | null | undefined) => (node as HTMLElement).click();
const type = (field: HTMLTextAreaElement | HTMLInputElement, value: string) => {
  field.value = value;
  field.dispatchEvent(new Event("input"));
};

const notice = message({
  threadid: 2,
  userid: 0,
  messagetype: "outpostattacked",
  subject: "Your outpost was attacked",
  message: "Acorn attacked your outpost at (241, 208).",
  unread: 1,
  updatetime: NOW - 60,
  coords: [241, 208],
});

describe("the mailbox screen", () => {
  it("lists the threads newest first, marks the unread, and reports how many are", async () => {
    const api = fakeApi([[message(), notice]], {});
    const { host, onUnreadChange } = await openScreen(api);

    expect(rows(host).map((row) => row.dataset["thread"])).toEqual(["2", "1"]);
    expect(rows(host)[0]?.classList.contains("mail-row--unread")).toBe(true);
    expect(rows(host)[0]?.classList.contains("mail-row--notice")).toBe(true);
    expect(rows(host)[0]?.textContent).toContain("Backyard Monsters");
    expect(rows(host)[1]?.textContent).toContain("Bramblefoot");
    expect(onUnreadChange).toHaveBeenLastCalledWith(1);
  });

  it("reads a notice: no reply, Show on map, and the thread no longer unread", async () => {
    const onShowOnMap = vi.fn();
    const api = fakeApi([[message(), notice]], { 2: [notice] });
    const { host, onUnreadChange } = await openScreen(api, { onShowOnMap });

    click(rows(host)[0]);
    await settle();
    expect(api.thread).toHaveBeenCalledWith(2);
    expect(host.querySelector(".mail-writer")).toBeNull();
    expect(host.querySelector(".mail-block")).toBeNull();
    expect(host.querySelector(".mail-message--notice")?.textContent).toContain("attacked your outpost");
    click(host.querySelector(".mail-message__map"));
    expect(onShowOnMap).toHaveBeenCalledWith({ col: 241, row: 208 });
    expect(rows(host)[0]?.classList.contains("mail-row--unread")).toBe(false);
    expect(onUnreadChange).toHaveBeenLastCalledWith(0);
  });

  it("reads a Map Room 1 yard's defence notice: no reply, no Show on map (#242)", async () => {
    const defended = message({
      threadid: 3,
      userid: 0,
      messagetype: "yardattacked",
      subject: "Kai_Builds attacked your yard",
      message: "It was left 40% damaged, and nothing was looted.",
      unread: 1,
      updatetime: NOW - 30,
      coords: [0, 0],
    });
    const api = fakeApi([[defended]], { 3: [defended] });
    const { host } = await openScreen(api, { onShowOnMap: vi.fn() });

    click(rows(host)[0]);
    await settle();
    expect(host.querySelector(".mail-message--notice")?.textContent).toContain("40% damaged");
    expect(host.querySelector(".mail-writer")).toBeNull();
    expect(host.querySelector(".mail-message__map")).toBeNull();
  });

  it("replies in a player's thread, on its subject, and shows the server's refusal", async () => {
    const thread = [message({ userid: 77, message: "hi" }), message({ userid: ME, targetid: 77, message: "hello" })];
    const api = fakeApi([[message()]], { 1: thread });
    const { host } = await openScreen(api);
    click(rows(host)[0]);
    await settle();

    expect([...host.querySelectorAll(".mail-message")].map((one) => one.className)).toEqual([
      "mail-message mail-message--theirs",
      "mail-message mail-message--mine",
    ]);
    const text = host.querySelector<HTMLTextAreaElement>(".mail-writer__text")!;
    const send = host.querySelector<HTMLButtonElement>(".mail-writer__send")!;
    expect(send.disabled).toBe(true);
    type(text, "  How are you?  ");
    expect(host.querySelector(".mail-writer__counter")?.textContent).toBe("16 / 580");
    click(send);
    await settle();
    expect(api.sent).toEqual([{ threadid: 1, targetid: 77, subject: "Hello", message: "How are you?" }]);

    api.sendResult = { ok: false, reason: "Cannot send message to this user" };
    const again = host.querySelector<HTMLTextAreaElement>(".mail-writer__text")!;
    type(again, "Still there?");
    click(host.querySelector(".mail-writer__send"));
    await settle();
    const refusal = host.querySelector<HTMLElement>(".mail-writer__refusal")!;
    expect(refusal.hidden).toBe(false);
    expect(refusal.textContent).toBe("Cannot send message to this user");
    expect(host.querySelector<HTMLTextAreaElement>(".mail-writer__text")?.value).toBe("Still there?");
  });

  it("writes a new message to a past contact, with the stand-in subject when none is given", async () => {
    const sent = message({ threadid: 5, userid: 88, subject: "(no subject)", message: "Hey" });
    const api = fakeApi([[message()], [message(), sent]], { 5: [sent] });
    api.sendResult = { ok: true, threadid: 5 };
    const { host } = await openScreen(api);

    click(host.querySelector(".mail-list__new"));
    await settle();
    const to = host.querySelector<HTMLSelectElement>(".mail-compose__to")!;
    expect([...to.options].map((option) => option.textContent)).toEqual(["Acorn", "Bramblefoot"]);
    to.value = "88";
    type(host.querySelector<HTMLTextAreaElement>(".mail-writer__text")!, "Hey");
    click(host.querySelector(".mail-writer__send"));
    await settle();
    await settle();
    expect(api.sent).toEqual([{ threadid: 0, targetid: 88, subject: "(no subject)", message: "Hey" }]);
    expect(host.querySelector(".mail-pane__name")?.textContent).toBe("Acorn");
  });

  it("writes to the player the map named", async () => {
    const api = fakeApi([[message()]], {});
    const { screen, host } = await openScreen(api);
    await screen.openCompose({ userid: 123, name: "Thistle" });
    expect(host.querySelector(".mail-compose__fixed")?.textContent).toBe("To Thistle");
    expect(host.querySelector(".mail-compose__to")).toBeNull();
    type(host.querySelector<HTMLInputElement>(".mail-compose__subject")!, "Truce?");
    type(host.querySelector<HTMLTextAreaElement>(".mail-writer__text")!, "Shall we?");
    click(host.querySelector(".mail-writer__send"));
    await settle();
    expect(api.sent[0]).toEqual({ threadid: 0, targetid: 123, subject: "Truce?", message: "Shall we?" });
  });

  it("says who to write to when there is no one yet", async () => {
    const api = fakeApi([[]], {}, {});
    const { host } = await openScreen(api);
    expect(host.querySelector(".mail-list__empty")?.textContent).toBe("No messages yet.");
    click(host.querySelector(".mail-list__new"));
    await settle();
    expect(host.querySelector(".mail-pane__empty")?.textContent).toContain("press Message");
  });

  it("blocks a player only on the second press", async () => {
    const api = fakeApi([[message()], []], { 1: [message()] });
    const { host } = await openScreen(api);
    click(rows(host)[0]);
    await settle();

    click(host.querySelector(".mail-block__ask"));
    expect(api.blocked).toEqual([]);
    expect(host.querySelector<HTMLElement>(".mail-block__confirm")?.hidden).toBe(false);
    click(host.querySelector(".mail-block__no"));
    expect(host.querySelector<HTMLElement>(".mail-block__confirm")?.hidden).toBe(true);

    click(host.querySelector(".mail-block__ask"));
    click(host.querySelector(".mail-block__yes"));
    await settle();
    expect(api.blocked).toEqual([1]);
    expect(host.querySelector(".mail-status")?.textContent).toBe("Bramblefoot is blocked.");
    expect(rows(host)).toHaveLength(0);
  });

  it("drops a note such as 'blocked' once another thread opens", async () => {
    const other = message({ threadid: 3, userid: 88 });
    const api = fakeApi([[message(), other], [other]], { 1: [message()], 3: [other] });
    const { host } = await openScreen(api);
    click(rows(host)[1]);
    await settle();
    click(host.querySelector(".mail-block__ask"));
    click(host.querySelector(".mail-block__yes"));
    await settle();
    const status = host.querySelector<HTMLElement>(".mail-status")!;
    expect(status.hidden).toBe(false);
    click(rows(host)[0]);
    await settle();
    expect(status.hidden).toBe(true);
  });

  it("says when the mail could not load, and tries again on request", async () => {
    const api = fakeApi([[message()]], {});
    (api.threads as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
    const { host } = await openScreen(api);
    const status = host.querySelector<HTMLElement>(".mail-status")!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain("Could not load your mail");
    click(host.querySelector(".mail-status__retry"));
    await settle();
    expect(status.hidden).toBe(true);
    expect(rows(host)).toHaveLength(1);
  });

  it("closes on Escape, and says whether it had the focus", async () => {
    const onClose = vi.fn();
    const api = fakeApi([[message()]], {});
    const { screen } = await openScreen(api, { onClose });
    screen.element.querySelector<HTMLElement>(".mail-screen__close")!.focus();
    screen.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(screen.isOpen).toBe(false);
    expect(screen.element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledWith(true);
  });
});

describe("truces in the mailbox (#203)", () => {
  const DAY = 86_400;
  const request = (overrides: Partial<MailMessage> = {}) =>
    message({ messagetype: "trucerequest", subject: "Truce Request from Bramblefoot", message: "Peace?", ...overrides });
  const listed = (trucestate: string, truceexpire: number | null) => request({ trucestate, truceexpire });
  const card = (host: HTMLElement) => host.querySelector<HTMLElement>(".mail-request");
  const stateOf = (host: HTMLElement) => card(host)?.querySelector(".mail-request__state")?.textContent;
  const actions = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>(".mail-request__action")];
  const openFirst = async (host: HTMLElement) => {
    click(rows(host)[0]);
    await settle();
  };

  it("an incoming request: tagged in the list, a card with Accept and Reject, and no second proposal", async () => {
    const api = fakeApi([[listed("requested", NOW + 6 * DAY)]], { 1: [request()] });
    const { host } = await openScreen(api);

    expect(rows(host)[0]?.querySelector(".mail-row__truce")?.textContent).toBe("Truce requested");
    await openFirst(host);
    expect(stateOf(host)).toBe("Waiting");
    expect(card(host)?.textContent).toContain("Answer by");
    expect(card(host)?.textContent).toContain("(6 days left)");
    expect(actions(host).map((one) => one.textContent)).toEqual(["Accept", "Reject"]);
    expect(host.querySelector(".mail-message__label")).toBeNull();
    expect(host.querySelector(".mail-pane__truce")).toBeNull();
  });

  it("Accept sends the acceptance, tells the map, and the card then says the truce is on", async () => {
    const onTruceAccepted = vi.fn();
    const answer = message({ userid: ME, targetid: 77, messagetype: "truceaccept", message: "I accept your truce." });
    const api = fakeApi([[listed("requested", NOW + 6 * DAY)], [listed("accepted", NOW + 7 * DAY)]], {
      1: [request(), answer],
    });
    const { host } = await openScreen(api, { onTruceAccepted });
    await openFirst(host);

    click(actions(host)[0]);
    await settle();
    await settle();

    expect(api.sent).toEqual([
      {
        threadid: 1,
        targetid: 77,
        subject: "Truce Request from Bramblefoot",
        message: "I accept your truce.",
        type: "truceaccept",
      },
    ]);
    expect(onTruceAccepted).toHaveBeenCalledTimes(1);
    expect(stateOf(host)).toBe("Active");
    expect(card(host)?.classList.contains("mail-request--good")).toBe(true);
    expect(actions(host)).toHaveLength(0);
    expect(host.querySelector(".mail-status")?.textContent).toContain("You have a truce with Bramblefoot");
    expect(rows(host)[0]?.querySelector(".mail-row__truce")?.textContent).toBe("Truce active");
  });

  it("Reject sends what the reply box holds, and a refusal shows on the card with the buttons back", async () => {
    const api = fakeApi([[listed("requested", NOW + DAY)]], { 1: [request()] });
    api.sendResult = { ok: false, reason: "This truce request can no longer be answered." };
    const { host } = await openScreen(api);
    await openFirst(host);

    type(host.querySelector<HTMLTextAreaElement>(".mail-writer__text")!, "Not today.");
    click(actions(host)[1]);
    await settle();

    expect(api.sent[0]).toMatchObject({ type: "trucereject", message: "Not today." });
    const refusal = host.querySelector<HTMLElement>(".mail-request__refusal")!;
    expect(refusal.hidden).toBe(false);
    expect(refusal.textContent).toBe("This truce request can no longer be answered.");
    expect(actions(host).every((one) => !one.disabled)).toBe(true);
  });

  it("the player's own request waits, with no buttons", async () => {
    const api = fakeApi([[listed("requested", NOW + 5 * DAY)]], { 1: [request({ userid: ME, targetid: 77 })] });
    const { host } = await openScreen(api);
    await openFirst(host);

    expect(card(host)?.textContent).toContain("Waiting for Bramblefoot to answer.");
    expect(actions(host)).toHaveLength(0);
  });

  it.each([
    ["requested", NOW - 60, "Lapsed", "so the request lapsed"],
    ["accepted", NOW - 60, "Ended", "The truce ended on"],
    ["rejected", null, "Rejected", "You rejected the truce."],
  ])("a %s truce that is over reads as %s, and a new one may be proposed", async (state, until, label, words) => {
    const api = fakeApi([[listed(state, until)]], { 1: [request()] });
    const { host } = await openScreen(api);
    await openFirst(host);

    expect(stateOf(host)).toBe(label);
    expect(card(host)?.textContent).toContain(words);
    expect(actions(host)).toHaveLength(0);
    expect(host.querySelector(".mail-pane__truce")).not.toBeNull();
  });

  it("after they reject the player's request, no new proposal for 2 days, and the card says when", async () => {
    const api = fakeApi([[listed("rejected", NOW + 2 * DAY)]], { 1: [request({ userid: ME, targetid: 77 })] });
    const { host } = await openScreen(api);
    await openFirst(host);

    expect(stateOf(host)).toBe("Rejected");
    expect(card(host)?.textContent).toContain("Bramblefoot rejected the truce. You can ask again in 2 days, on");
    expect(host.querySelector(".mail-pane__truce")).toBeNull();
  });

  it("proposes a truce in a thread, starting from Flash's words", async () => {
    const api = fakeApi([[message()]], { 1: [message()] });
    const { host } = await openScreen(api);
    await openFirst(host);

    click(host.querySelector(".mail-pane__truce"));
    expect(host.querySelector(".mail-pane__name")?.textContent).toBe("Propose a truce to Bramblefoot");
    const words = "Accept my truce and we can end all this needless bloodshed.";
    expect(host.querySelector<HTMLTextAreaElement>(".mail-writer__text")?.value).toBe(words);
    click(host.querySelector(".mail-writer__send"));
    await settle();
    await settle();

    expect(api.sent).toEqual([{ threadid: 1, targetid: 77, subject: "Hello", message: words, type: "trucerequest" }]);
    expect(host.querySelector(".mail-status")?.textContent).toBe("Truce request sent to Bramblefoot.");
  });

  it("proposes a truce from the map on the yard's base, and shows a refusal under the box", async () => {
    const api = fakeApi([[message()]], {});
    api.sendResult = { ok: false, reason: "You already have a truce, or a truce request waiting, with this player." };
    const { screen, host } = await openScreen(api);
    await screen.openTruce({ userid: 77, name: "Bramblefoot", baseid: "2000245210" });

    type(host.querySelector<HTMLTextAreaElement>(".mail-writer__text")!, "Let us be friends.");
    click(host.querySelector(".mail-writer__send"));
    await settle();

    expect(api.proposed).toEqual([{ baseid: "2000245210", message: "Let us be friends." }]);
    expect(api.sent).toEqual([]);
    expect(host.querySelector(".mail-writer__refusal")?.textContent).toContain("already have a truce");
    expect(host.querySelector(".mail-truce__cancel")).toBeNull();
  });
});

describe("invitations to move in the mailbox (#205)", () => {
  const DAY = 86_400;
  const invitation = (overrides: Partial<MailMessage> = {}) =>
    message({
      messagetype: "migraterequest",
      subject: "Let's Join Forces",
      message: "Move your main yard next to mine and we can work together to dominate the world map!",
      coords: [241, 208],
      baseid: "2000241208",
      migratestate: "requested",
      migrateexpire: NOW + 6 * DAY,
      ...overrides,
    });
  const card = (host: HTMLElement) => host.querySelector<HTMLElement>(".mail-request");
  const stateOf = (host: HTMLElement) => card(host)?.querySelector(".mail-request__state")?.textContent;
  const actions = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>(".mail-request__action")];
  const labels = (host: HTMLElement) => actions(host).map((one) => one.textContent);
  const openFirst = async (host: HTMLElement) => {
    click(rows(host)[0]);
    await settle();
  };

  it("the one invited: tagged in the list, a card with Accept, Decline and View on map", async () => {
    const onShowOnMap = vi.fn();
    const api = fakeApi([[invitation()]], { 1: [invitation()] });
    const { host } = await openScreen(api, { onShowOnMap });

    expect(rows(host)[0]?.querySelector(".mail-row__truce")?.textContent).toBe("Move invitation");
    await openFirst(host);
    expect(stateOf(host)).toBe("Waiting");
    expect(card(host)?.textContent).toContain("10,000,000 of each resource or 1,200 Shiny");
    expect(labels(host)).toEqual(["Accept", "Decline", "View on map"]);
    expect(host.querySelector(".mail-message__label")).toBeNull();

    click(actions(host)[2]);
    await settle();
    expect(onShowOnMap).toHaveBeenCalledWith({ col: 241, row: 208 });
  });

  it("Accept asks how to pay; paying moves the yard, tells the map, and the card says it is done", async () => {
    const onInviteAccepted = vi.fn();
    const byThread = { 1: [invitation()] };
    const api = fakeApi([[invitation()], [invitation({ migratestate: "accepted" })]], byThread);
    const { host } = await openScreen(api, { onInviteAccepted });
    await openFirst(host);
    byThread[1] = [invitation({ migratestate: "accepted" })];

    click(actions(host)[0]);
    await settle();
    expect(stateOf(host)).toBe("Choose how to pay");
    expect(labels(host)).toEqual(["Pay 10,000,000 of each resource", "Pay 1,200 Shiny", "Back"]);
    expect(api.answered).toEqual([]);

    click(actions(host)[1]);
    await settle();
    await settle();

    expect(api.answered).toEqual([{ threadid: 1, payment: "shiny" }]);
    expect(onInviteAccepted).toHaveBeenCalledWith([241, 208]);
    expect(stateOf(host)).toBe("Accepted");
    expect(actions(host)).toHaveLength(0);
    expect(host.querySelector(".mail-status")?.textContent).toBe("Your main yard has moved to (241, 208).");
  });

  it("a refusal shows on the price choice, which stays to be tried again; Back returns to the invitation", async () => {
    const api = fakeApi([[invitation()]], { 1: [invitation()] });
    api.answerResult = { ok: false, reason: "You must first leave your Alliance to accept this invitation." };
    const { host } = await openScreen(api);
    await openFirst(host);

    click(actions(host)[0]);
    await settle();
    click(actions(host)[0]);
    await settle();

    expect(api.answered).toEqual([{ threadid: 1, payment: "resources" }]);
    expect(host.querySelector(".mail-request__refusal")?.textContent).toBe(
      "You must first leave your Alliance to accept this invitation.",
    );
    expect(actions(host).every((one) => !one.disabled)).toBe(true);

    click(actions(host)[2]);
    await settle();
    expect(labels(host)).toEqual(["Accept", "Decline"]);
  });

  it("Decline declines, and the card then says so", async () => {
    const byThread = { 1: [invitation()] };
    const api = fakeApi([[invitation()], [invitation({ migratestate: "rejected" })]], byThread);
    const { host } = await openScreen(api);
    await openFirst(host);
    byThread[1] = [invitation({ migratestate: "rejected" })];

    click(actions(host)[1]);
    await settle();
    await settle();

    expect(api.answered).toEqual([{ threadid: 1, payment: "declined" }]);
    expect(stateOf(host)).toBe("Declined");
    expect(host.querySelector(".mail-status")?.textContent).toBe("You declined Bramblefoot's invitation.");
  });

  it("the one who invited: Withdraw, with Flash's words unless the box holds some", async () => {
    const onInviteChanged = vi.fn();
    // The list names the other party; the thread, the sender.
    const mine = invitation({ userid: ME, targetid: 77 });
    const api = fakeApi([[invitation()]], { 1: [mine] });
    const { host } = await openScreen(api, { onInviteChanged });
    await openFirst(host);

    expect(card(host)?.textContent).toContain("Waiting for Bramblefoot to answer.");
    expect(labels(host)).toEqual(["Withdraw"]);
    click(actions(host)[0]);
    await settle();
    await settle();

    expect(api.sent).toEqual([
      { threadid: 1, targetid: 77, subject: "Let's Join Forces", message: "Never mind.", type: "migraterevoke" },
    ]);
    expect(onInviteChanged).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["revoked", "Withdrawn"],
    ["expired", "Lapsed"],
    ["void", "Void"],
  ])("a %s invitation reads %s, with no buttons", async (migratestate, label) => {
    const api = fakeApi([[invitation({ migratestate })]], { 1: [invitation({ migratestate })] });
    const { host } = await openScreen(api);
    await openFirst(host);

    expect(stateOf(host)).toBe(label);
    expect(actions(host)).toHaveLength(0);
  });

  it("invites from the player's own outpost: a past contact, the box ticked, then sent on that outpost", async () => {
    const onInviteChanged = vi.fn();
    const api = fakeApi([[message()]], {});
    api.sendResult = { ok: true, threadid: 9 };
    const { screen, host } = await openScreen(api, { onInviteChanged });
    await screen.openInvite({ to: null, outposts: [{ baseid: "2000241208", cell: { col: 241, row: 208 } }] });

    expect(host.querySelector(".mail-compose__fixed")?.textContent).toBe("Onto your outpost at (241, 208)");
    const words = "Move your main yard next to mine and we can work together to dominate the world map!";
    expect(host.querySelector<HTMLTextAreaElement>(".mail-writer__text")?.value).toBe(words);
    host.querySelector<HTMLSelectElement>(".mail-compose__to")!.value = "88";

    click(host.querySelector(".mail-writer__send"));
    await settle();
    expect(api.sent).toEqual([]);
    expect(host.querySelector(".mail-writer__refusal")?.textContent).toContain("Tick the box first");

    click(host.querySelector(".mail-invite__confirm"));
    click(host.querySelector(".mail-writer__send"));
    await settle();
    await settle();

    expect(api.sent).toEqual([
      {
        threadid: 0,
        targetid: 88,
        subject: "Let's Join Forces",
        message: words,
        type: "migraterequest",
        baseid: "2000241208",
      },
    ]);
    expect(onInviteChanged).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".mail-status")?.textContent).toBe("Invitation sent to Acorn.");
  });

  it("invites the player the map named onto the outpost picked, and shows the server's refusal", async () => {
    const api = fakeApi([[message()]], {});
    api.sendResult = { ok: false, reason: "They are in another world, so they cannot move to your outpost." };
    const { screen, host } = await openScreen(api);
    await screen.openInvite({
      to: { userid: 77, name: "Bramblefoot" },
      outposts: [
        { baseid: "2000241208", cell: { col: 241, row: 208 } },
        { baseid: "2000242208", cell: { col: 242, row: 208 } },
      ],
    });

    expect(host.querySelector(".mail-pane__name")?.textContent).toBe("Invite Bramblefoot to move");
    host.querySelector<HTMLSelectElement>(".mail-invite__outpost")!.value = "2000242208";
    click(host.querySelector(".mail-invite__confirm"));
    click(host.querySelector(".mail-writer__send"));
    await settle();

    expect(api.sent[0]).toMatchObject({ targetid: 77, baseid: "2000242208", type: "migraterequest" });
    expect(host.querySelector(".mail-writer__refusal")?.textContent).toBe(
      "They are in another world, so they cannot move to your outpost.",
    );
  });
});
