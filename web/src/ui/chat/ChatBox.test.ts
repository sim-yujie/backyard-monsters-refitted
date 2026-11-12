// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatApi, ChatLineWire } from "@/api/chat";
import { ApiError } from "@/api/http";
import {
  ChatSession,
  MAX_ENTRIES,
  RATE_LIMITED_TEXT,
  type ChatSocket,
} from "@/game/chat/chatSession";
import { ChatBox } from "./ChatBox";
import { FriendRelations } from "@/game/friends/friendRelations";
import { FriendsStore } from "@/game/friends/friendsStore";
import { fixtureApi, fixtureFriend, fixtureList, fixtureRequest } from "@/game/friends/friendsFixture";
import { ADD_FRIEND_TEXT } from "@/ui/friends/AddFriendButton";
import { openProfile } from "@/ui/profile/ProfileDialog";

vi.mock("@/ui/profile/ProfileDialog", () => ({ openProfile: vi.fn() }));

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
let friends: ReturnType<typeof makeFriends>;

const makeFriends = (answers: Parameters<typeof fixtureApi>[0] = {}) => {
  const { api, calls } = fixtureApi(answers);
  const store = new FriendsStore({ api });
  const relations = new FriendRelations({ api, store, now: () => 0 });
  return { api, calls, store, relations };
};

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
    friends: { api: friends.api, relations: friends.relations },
  });
};

const lineTexts = () =>
  [...box.element.querySelectorAll(".chat-line")].map((line) => line.textContent);
const nameButton = (name: string) =>
  [...box.element.querySelectorAll<HTMLButtonElement>("button.chat-line__name")].find(
    (button) => button.textContent === name,
  )!;
const strip = () => box.element.querySelector<HTMLElement>(".chat-box__player")!;
/** A strip button by its word: the icon buttons' aria-label, or a text button's text. */
const stripButton = (label: string) =>
  [...strip().querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent) === label,
  )!;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
  api = { report: vi.fn(async () => {}), yardOf: vi.fn() };
  onViewYard = vi.fn(async () => {});
  friends = makeFriends();
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

  it("marks the game team's lines with GM and a moderator's with Mod, GM winning", () => {
    mount([
      { ...wire(7, "Please keep chat friendly.", 1, "[40] Owner"), gm: true },
      { ...wire(30, "Thanks!", 2, "[25] helper"), mod: true },
      wire(77, "hi", 3),
      { ...wire(8, "both", 4, "[40] Owner2"), gm: true, mod: true },
    ]);
    const [gm, mod, plain, both] = [...box.element.querySelectorAll<HTMLElement>(".chat-line")];

    expect(gm!.classList.contains("chat-line--gm")).toBe(true);
    expect(gm!.querySelector(".chat-line__gm")?.textContent).toBe("GM");
    expect(gm!.querySelector(".chat-line__mod")).toBeNull();

    expect(mod!.classList.contains("chat-line--mod")).toBe(true);
    expect(mod!.classList.contains("chat-line--gm")).toBe(false);
    const badge = mod!.querySelector<HTMLElement>(".chat-line__mod")!;
    expect(badge.textContent).toBe("Mod");
    expect(badge.title).toBe("Moderator");
    // The badge comes first, then the name and the words.
    expect(mod!.firstElementChild).toBe(badge);
    expect(mod!.textContent).toBe("Mod[25] helperThanks!");

    expect(plain!.classList.contains("chat-line--mod")).toBe(false);
    expect(plain!.querySelector(".chat-line__mod, .chat-line__gm")).toBeNull();

    expect(both!.classList.contains("chat-line--gm")).toBe(true);
    expect(both!.classList.contains("chat-line--mod")).toBe(false);
    expect(both!.querySelector(".chat-line__mod")).toBeNull();
  });

  it("marks a moderator's new line as it comes in", () => {
    mount([]);
    socket.hear({ type: "message", channel: CHANNEL, ...wire(30, "hello all", 5, "[25] helper"), mod: true });
    const line = box.element.querySelector<HTMLElement>(".chat-line")!;
    expect(line.classList.contains("chat-line--mod")).toBe(true);
    expect(line.querySelector(".chat-line__mod")?.textContent).toBe("Mod");
  });

  it("adds a new line on its own, leaving the lines already drawn alone", () => {
    mount([wire(77, "hello", 1), wire(78, "hi", 2)]);
    const first = box.element.querySelector(".chat-line");
    socket.hear({ type: "message", channel: CHANNEL, ...wire(79, "new", 3) });
    expect(lineTexts()).toEqual(["[12] p77hello", "[12] p78hi", "[12] p79new"]);
    expect(box.element.querySelector(".chat-line")).toBe(first);
  });

  it("drops the oldest line as a full room's history takes a new one", () => {
    const full = Array.from({ length: MAX_ENTRIES }, (_, index) => wire(77, `line ${index}`, index));
    mount(full);
    const second = box.element.querySelectorAll(".chat-line")[1];
    socket.hear({ type: "message", channel: CHANNEL, ...wire(78, "newest", 999) });
    const lines = box.element.querySelectorAll(".chat-line");
    expect(lines).toHaveLength(MAX_ENTRIES);
    expect(lines[0]).toBe(second);
    expect(lineTexts().at(-1)).toBe("[12] p78newest");
  });

  it("keeps a muted player's new line out, and gives an open box's new names Tab", () => {
    mount([wire(77, "noise", 1)]);
    box.setOpen(true);
    nameButton("[12] p77").click();
    stripButton("Mute").click();
    socket.hear({ type: "message", channel: CHANNEL, ...wire(77, "more noise", 2) });
    socket.hear({ type: "message", channel: CHANNEL, ...wire(78, "fine", 3) });
    expect(lineTexts()).toEqual(["[12] p78fine"]);
    expect(nameButton("[12] p78").tabIndex).toBe(0);
    box.setOpen(false);
    expect(nameButton("[12] p78").tabIndex).toBe(-1);
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

  it("the name in the strip opens the player's profile", () => {
    mount([wire(77, "hello", 1)]);
    box.setOpen(true);
    nameButton("[12] p77").click();
    stripButton("[12] p77's profile").click();
    expect(vi.mocked(openProfile)).toHaveBeenCalledWith(expect.objectContaining({ userid: 77 }));
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

  describe("icon-first strip and Add friend (owner, 8 Nov 2026)", () => {
    const friendButton = () => strip().querySelector<HTMLButtonElement>(".add-friend__button")!;
    const openStrip = async (userId = 77) => {
      nameButton(`[12] p${userId}`).click();
      await flush();
    };

    it("shows Add friend, Mute, View yard and Report as painted icons with their word as tooltip and name", async () => {
      mount([wire(77, "hello", 1)]);
      box.setOpen(true);
      await openStrip();
      const buttons = [...strip().querySelectorAll<HTMLButtonElement>(".chat-box__action--icon")];
      expect(buttons.map((button) => button.querySelector(".chat-box__action-label")?.textContent)).toEqual([
        ADD_FRIEND_TEXT.add,
        "Mute",
        "View yard",
        "Report",
      ]);
      for (const button of buttons) {
        expect(button.querySelector("img.game-icon")).not.toBeNull();
        expect(button.getAttribute("aria-label")).toBeTruthy();
        expect(button.title).toBe(button.getAttribute("aria-label"));
      }
      expect(buttons.map((button) => button.querySelector("img")!.dataset["icon"])).toEqual([
        "addfriend",
        "mute",
        "townhall",
        "report",
      ]);
      expect(friendButton().title).toBe(ADD_FRIEND_TEXT.addTitle("[12] p77"));
    });

    it("a stranger: Add friend sends the request, says so, and shows Sent when the strip opens again", async () => {
      mount([wire(77, "hello", 1)]);
      box.setOpen(true);
      await openStrip();
      expect(friendButton().dataset["relation"]).toBe("none");
      friendButton().click();
      await flush();
      expect(friends.calls).toContainEqual(["request", { userid: 77 }]);
      expect(strip().textContent).toContain(ADD_FRIEND_TEXT.sent("[12] p77"));
      stripButton("OK").click();
      await openStrip();
      expect(friendButton().dataset["relation"]).toBe("requested");
      expect(friendButton().disabled).toBe(true);
      expect(friendButton().getAttribute("aria-label")).toBe(ADD_FRIEND_TEXT.requested);
      expect(friendButton().querySelector("img")!.dataset["icon"]).toBe("time");
    });

    it("a request already waiting shows Sent, disabled", async () => {
      friends = makeFriends({ requests: { incoming: [], outgoing: [fixtureRequest(1, 77)] } });
      mount([wire(77, "hello", 1)]);
      box.setOpen(true);
      await openStrip();
      await flush();
      expect(friendButton().dataset["relation"]).toBe("requested");
      expect(friendButton().disabled).toBe(true);
      expect(friendButton().querySelector(".chat-box__action-label")?.textContent).toBe(
        ADD_FRIEND_TEXT.shortRequested,
      );
    });

    it("a friend shows the friend marker as Friend, disabled, and sends nothing", async () => {
      friends = makeFriends({ list: fixtureList([fixtureFriend(77)]) });
      await friends.store.refresh();
      mount([wire(77, "hello", 1)]);
      box.setOpen(true);
      await openStrip();
      expect(friendButton().dataset["relation"]).toBe("friend");
      expect(friendButton().disabled).toBe(true);
      expect(friendButton().querySelector(".friend-badge")).not.toBeNull();
      expect(friendButton().getAttribute("aria-label")).toBe(ADD_FRIEND_TEXT.friend);
      friendButton().click();
      await flush();
      expect(friends.calls.some(([call]) => call === "request")).toBe(false);
    });

    it("is not offered on the player's own lines", async () => {
      mount([wire(2505, "mine", 1, "[27] agenttester")]);
      box.setOpen(true);
      box.element.querySelector<HTMLButtonElement>("button.chat-line__name")?.click();
      await flush();
      expect(strip().hidden).toBe(true);
      expect(strip().querySelector(".add-friend__button")).toBeNull();
    });
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
