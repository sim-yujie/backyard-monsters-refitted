// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Defence, DefenceReplayResponse, DefencesApi } from "@/api/defences";
import { ApiError } from "@/api/http";
import type { DefenceReplayFixture } from "@/game/defences/defenceFixture";
import { CLIENT_RULES_VERSION, type DefenceWatch } from "@/game/defences/defenceWatch";
import { DEFENCE_GONE_TEXT, DEFENCE_LOAD_FAILED_TEXT } from "@/game/defences/openDefence";
import { DefencesDoor } from "./DefencesDoor";
import { EMPTY_TEXT, LOAD_FAILED_TEXT, damageText, housedText } from "./DefencesScreen";
import fixtureJson from "../../../test/fixtures/defence-replay-mixed-waves.json";

/**
 * The Defences button and screen (#363) over a fake defences API: the list's
 * rows and states, and Watch, which fetches the replay and hands a playable
 * one to the scene, or says on its row why it cannot.
 */

// jsdom's `import.meta.url` is not a file URL, so the fixture comes in as a module.
const fixture = fixtureJson as unknown as DefenceReplayFixture;

const NOW = 1_792_010_000;

const defence = (overrides: Partial<Defence> = {}): Defence => ({
  ...fixture.defence,
  rulesVersion: CLIENT_RULES_VERSION,
  ...overrides,
});

const replayAnswer = (row: Defence): DefenceReplayResponse => ({ error: 0, defence: row, replay: fixture.replay });

const fakeApi = (list: Defence[] | Error, replay: (id: number) => Promise<DefenceReplayResponse> = async (id) => {
  const row = (Array.isArray(list) ? list : []).find((one) => one.id === id);
  if (!row) throw new ApiError("That defence could not be found.", { status: 404 });
  return replayAnswer(row);
}) => ({
  list: vi.fn(async () => {
    if (list instanceof Error) throw list;
    return list;
  }),
  replay: vi.fn(replay),
}) satisfies DefencesApi;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const openDoor = async (api: DefencesApi, onWatch = vi.fn<(run: DefenceWatch) => void>()) => {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const onOpen = vi.fn();
  const door = new DefencesDoor({ container: host, api, onOpen, onWatch, now: () => NOW });
  host.append(door.button.element);
  await door.open();
  await settle();
  return { door, host, onWatch, onOpen };
};

const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".defences-row")];
const click = (node: Element | null | undefined) => (node as HTMLElement).click();

describe("the Defences button", () => {
  it("is hidden until the scene says the player is on Map Room 2, and toggles the screen", async () => {
    const api = fakeApi([]);
    const host = document.createElement("div");
    hosts.push(host);
    const door = new DefencesDoor({ container: host, api, onWatch: vi.fn() });
    expect(door.button.element.hidden).toBe(true);
    expect(door.button.element.textContent).toContain("Defences");
    door.setAvailable(true);
    expect(door.button.element.hidden).toBe(false);

    click(door.button.element);
    await settle();
    expect(door.isOpen).toBe(true);
    expect(api.list).toHaveBeenCalledTimes(1);
    click(door.button.element);
    expect(door.isOpen).toBe(false);

    await door.open();
    door.setAvailable(false);
    expect(door.isOpen).toBe(false);
    expect(door.button.element.hidden).toBe(true);
  });
});

describe("the Defences screen", () => {
  it("lists each attack: who, when, the damage THIS attack did, the loot lost and Watch", async () => {
    const api = fakeApi([
      defence({ id: 2, damageDone: 35, damageAfter: 63, landedAt: NOW - 3 * 3600, loot: { r1: 1234, r4: 50 } }),
      defence({ id: 1, attacker: { name: "Acorn", pic: "/avatars/owl.webp" }, landedAt: NOW - 2 * 86_400, housedLost: 3, left: true, loot: {} }),
    ]);
    const { host, onOpen } = await openDoor(api);
    expect(onOpen).toHaveBeenCalledTimes(1);

    const [first, second] = rows(host);
    expect(first?.dataset["id"]).toBe("2");
    expect(first?.querySelector(".defences-row__name")?.textContent).toBe("Bramble");
    expect(first?.querySelector(".defences-row__time")?.textContent).toBe("3 h ago");
    expect(first?.querySelector(".defences-row__time")?.getAttribute("title")).toBeTruthy();
    // The damage this attack did (after - before), never what the yard was left at.
    expect(first?.querySelector(".defences-row__damage")?.textContent).toBe("did 35% damage");
    expect(first?.textContent).not.toContain("63%");
    const loot = [...(first?.querySelectorAll<HTMLElement>(".defences-row__loot .res-amount") ?? [])];
    expect(loot.map((one) => [one.dataset["resource"], one.textContent])).toEqual([
      ["r1", "1,234"],
      ["r4", "50"],
    ]);
    expect(first?.querySelector(".defences-row__watch")?.textContent).toBe("Watch");

    expect(second?.querySelector(".defences-row__name")?.textContent).toBe("Acorn");
    expect(second?.querySelector(".defences-row__time")?.textContent).toBe("2 days ago");
    expect(second?.querySelector("img")?.getAttribute("src")).toContain("owl-64.webp");
    expect(second?.querySelector(".defences-row__loot")?.textContent).toBe("nothing looted");
    expect(second?.querySelector(".defences-row__housed")?.textContent).toBe("3 housed monsters lost");
    expect(second?.querySelector(".defences-row__left")?.textContent).toBe("they left the attack");
  });

  it("hides Watch, with the owner's words, for an old rules version or a replay not kept", async () => {
    const api = fakeApi([
      defence({ id: 3, rulesVersion: "0000000000000000" }),
      defence({ id: 2, playable: false }),
      defence({ id: 1, hasReplay: false, playable: false }),
    ]);
    const { host } = await openDoor(api);
    const words = rows(host).map((row) => [
      row.querySelector(".defences-row__watch") === null,
      row.querySelector(".defences-row__unavailable")?.textContent,
    ]);
    expect(words).toEqual([
      [true, "Replay not available after a game update"],
      [true, "Replay not available after a game update"],
      [true, "Replay not available"],
    ]);
  });

  it("shows a deleted attacker as the server names them, and still offers Watch", async () => {
    const api = fakeApi([defence({ attacker: { name: "Deleted player", pic: null } })]);
    const { host } = await openDoor(api);
    expect(rows(host)[0]?.querySelector(".defences-row__name")?.textContent).toBe("Deleted player");
    expect(rows(host)[0]?.querySelector("img")?.getAttribute("src")).toMatch(/avatars\/.+-64\.webp$/);
    expect(rows(host)[0]?.querySelector(".defences-row__watch")).not.toBeNull();
  });

  it("says so when nobody has attacked, and when the list cannot load", async () => {
    const empty = await openDoor(fakeApi([]));
    expect(empty.host.querySelector(".defences-list__empty")?.textContent).toBe(EMPTY_TEXT);

    const failed = await openDoor(fakeApi(new Error("offline")));
    expect(failed.host.querySelector(".defences-status")?.textContent).toBe(LOAD_FAILED_TEXT);
    expect(failed.host.querySelector(".defences-list__empty")).toBeNull();
  });

  it("fetches the list again on every open, so a new defence shows", async () => {
    const api = fakeApi([]);
    const { door } = await openDoor(api);
    door.close();
    await door.open();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and on its close button", async () => {
    const { door, host } = await openDoor(fakeApi([]));
    host.querySelector(".defences-screen")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(door.isOpen).toBe(false);
    await door.open();
    click(host.querySelector(".defences-screen__close"));
    expect(door.isOpen).toBe(false);
  });
});

describe("Watch", () => {
  it("fetches that defence's replay and hands the scene a playable run", async () => {
    const row = defence({ id: 41 });
    const api = fakeApi([row]);
    const { host, onWatch } = await openDoor(api);

    click(rows(host)[0]?.querySelector(".defences-row__watch"));
    expect(rows(host)[0]?.querySelector(".defences-row__watch")?.textContent).toBe("Loading…");
    await settle();
    expect(api.replay).toHaveBeenCalledWith(41);
    expect(onWatch).toHaveBeenCalledTimes(1);
    const run = onWatch.mock.calls[0]?.[0];
    expect(run).toMatchObject({ kind: "defence", defence: { id: 41 }, replay: { v: 1, seed: fixture.replay.seed } });
  });

  it("says on the row why a replay cannot be played after all", async () => {
    const cases: [string, (id: number) => Promise<DefenceReplayResponse>][] = [
      ["Replay not available", async () => Promise.reject(new ApiError("Replay not available.", { status: 410 }))],
      [DEFENCE_GONE_TEXT, async () => Promise.reject(new ApiError("That defence could not be found.", { status: 404 }))],
      [DEFENCE_LOAD_FAILED_TEXT, async () => Promise.reject(new Error("offline"))],
      // The server updated its rules since the list was fetched.
      ["Replay not available after a game update", async (id) => replayAnswer(defence({ id, rulesVersion: "0000000000000000" }))],
    ];
    for (const [words, replay] of cases) {
      const { host, onWatch } = await openDoor(fakeApi([defence()], replay));
      click(rows(host)[0]?.querySelector(".defences-row__watch"));
      await settle();
      expect(onWatch).not.toHaveBeenCalled();
      expect(rows(host)[0]?.querySelector(".defences-row__watch")).toBeNull();
      expect(rows(host)[0]?.querySelector(".defences-row__unavailable")?.textContent).toBe(words);
    }
  });

  it("opens a defence by id for an attack notice, with the same checks", async () => {
    const host = document.createElement("div");
    hosts.push(host);
    const onWatch = vi.fn();
    const door = new DefencesDoor({ container: host, api: fakeApi([defence({ id: 41 })]), onWatch });
    expect(await door.watch(41)).toBeNull();
    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(await door.watch(7)).toBe(DEFENCE_GONE_TEXT);
    expect(onWatch).toHaveBeenCalledTimes(1);
  });
});

describe("words", () => {
  it("says the damage done and the housed monsters lost", () => {
    expect(damageText({ damageDone: 34.6 })).toBe("did 35% damage");
    expect(damageText({ damageDone: -2 })).toBe("did 0% damage");
    expect(housedText(0)).toBe("");
    expect(housedText(1)).toBe("1 housed monster lost");
    expect(housedText(12)).toBe("12 housed monsters lost");
  });
});

describe("hidden bots", () => {
  it("never shows anything but the frozen name and picture of an attacker", async () => {
    const { host } = await openDoor(fakeApi([defence()]));
    const html = host.innerHTML;
    expect(html).not.toMatch(/bot|userid|baseid/i);
  });
});
