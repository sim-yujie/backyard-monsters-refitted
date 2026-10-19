// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/http";
import { REFUSAL_TEXT } from "@/api/friends";
import { FriendRelations, RELATIONS_TTL_MS } from "@/game/friends/friendRelations";
import { fixtureApi, fixtureFriend, fixtureList, fixtureRequest } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { ADD_FRIEND_TEXT, addFriendButton } from "./AddFriendButton";

/** Add friend outside the Friends screen (issue #378): the map popups and attack notices. */

const refused = (reason: string): ApiError =>
  new ApiError("refused", { status: 409, details: { message: "refused", status: 409, data: { reason } } });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (answers: Parameters<typeof fixtureApi>[0] = {}, now = () => 0) => {
  const { api, calls } = fixtureApi(answers);
  const store = new FriendsStore({ api });
  const relations = new FriendRelations({ api, store, now });
  const make = (userid: number, extra: { username?: string; friend?: boolean } = {}) => {
    const root = addFriendButton({ userid, api, relations, ...extra });
    document.body.append(root);
    return root;
  };
  return { api, calls, store, relations, make };
};

const press = (root: HTMLElement): void => root.querySelector<HTMLButtonElement>(".add-friend__button")!.click();
const note = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>(".add-friend__note")!;
const chip = (root: HTMLElement): string | null => root.querySelector(".add-friend__relation")?.textContent ?? null;

afterEach(() => document.body.replaceChildren());

describe("addFriendButton", () => {
  it("offers Add friend to a stranger and sends the request", async () => {
    const { make, calls } = setup();
    const root = make(7, { username: "Bramble" });
    await settle();
    expect(root.querySelector(".add-friend__button")?.textContent).toBe(ADD_FRIEND_TEXT.add);
    press(root);
    await settle();
    expect(calls).toContainEqual(["request", { userid: 7 }]);
    expect(chip(root)).toBe(ADD_FRIEND_TEXT.requested);
    expect(note(root).textContent).toBe(ADD_FRIEND_TEXT.sent("Bramble"));
  });

  it("shows Friends, with no button, for a friend the caller knows of or the list has", async () => {
    const { make, store } = setup({ list: fixtureList([fixtureFriend(8)]) });
    expect(chip(make(5, { friend: true }))).toBe(ADD_FRIEND_TEXT.friend);
    await store.refresh();
    const root = make(8);
    expect(chip(root)).toBe(ADD_FRIEND_TEXT.friend);
    expect(root.querySelector(".add-friend__button")).toBeNull();
  });

  it("reads the waiting requests: Request sent to one asked, Accept to one who asked", async () => {
    const { make, calls } = setup({
      requests: { incoming: [fixtureRequest(1, 11)], outgoing: [fixtureRequest(2, 12), fixtureRequest(3, 13, { status: "declined" })] },
    });
    const asked = make(11);
    const requested = make(12);
    const declined = make(13);
    await settle();
    expect(asked.querySelector(".add-friend__button")?.textContent).toBe(ADD_FRIEND_TEXT.accept);
    expect(chip(requested)).toBe(ADD_FRIEND_TEXT.requested);
    expect(declined.querySelector(".add-friend__button")?.textContent).toBe(ADD_FRIEND_TEXT.add);
    // Three buttons, one fetch.
    expect(calls.filter(([method]) => method === "requests")).toHaveLength(1);
  });

  it("Accept makes them friends, and the store hears it", async () => {
    const friend = fixtureFriend(11, { username: "Moss" });
    const { make, store } = setup({
      requests: { incoming: [fixtureRequest(1, 11)], outgoing: [] },
      request: { request: null, friend },
      // The refresh after it, as the server would answer.
      list: fixtureList([friend]),
    });
    const root = make(11, { username: "Moss" });
    await settle();
    press(root);
    await settle();
    expect(chip(root)).toBe(ADD_FRIEND_TEXT.friend);
    expect(note(root).textContent).toBe(ADD_FRIEND_TEXT.accepted("Moss"));
    expect(store.isFriend(11)).toBe(true);
  });

  it("says a refusal in the Friends screen's words, and nothing more", async () => {
    const { make } = setup({ request: refused("cannotSend") });
    const root = make(7);
    await settle();
    press(root);
    await settle();
    expect(note(root).textContent).toBe(REFUSAL_TEXT.cannotSend);
    expect(note(root).classList.contains("add-friend__note--error")).toBe(true);
    // Still offered: the refusal says why, the button stays as it was.
    expect(root.querySelector(".add-friend__button")?.textContent).toBe(ADD_FRIEND_TEXT.add);
  });

  it("turns to the relation a refusal names", async () => {
    const { make } = setup({ request: refused("alreadyRequested") });
    const root = make(7);
    await settle();
    press(root);
    await settle();
    expect(chip(root)).toBe(ADD_FRIEND_TEXT.requested);
  });

  it("works without a name, as on an attack notice", async () => {
    const { make } = setup();
    const root = make(7);
    await settle();
    press(root);
    await settle();
    expect(note(root).textContent).toBe(ADD_FRIEND_TEXT.sent());
  });

  it("a button made after a press agrees with it, without asking again", async () => {
    const { make, calls } = setup();
    const first = make(7);
    await settle();
    press(first);
    await settle();
    expect(chip(make(7))).toBe(ADD_FRIEND_TEXT.requested);
    expect(calls.filter(([method]) => method === "requests")).toHaveLength(1);
  });

  it("asks again for the requests once they are a while old", async () => {
    let now = 0;
    const { make, calls } = setup({}, () => now);
    make(7);
    await settle();
    now = RELATIONS_TTL_MS + 1;
    make(8);
    await settle();
    expect(calls.filter(([method]) => method === "requests")).toHaveLength(2);
  });
});
