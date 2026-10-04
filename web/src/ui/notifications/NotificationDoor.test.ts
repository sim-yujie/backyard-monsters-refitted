// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameNotification, NotificationsApi } from "@/api/notifications";
import type { CompletedJob } from "@/api/types";
import { typeName } from "@/game/yard/planner/summary";
import { NotificationDoor } from "./NotificationDoor";
import { EMPTY_TEXT, LOAD_FAILED_TEXT } from "./NotificationPanel";

/** The bell and its list (#257): the count, the list, marking read, and a building's click. */

const NOW = 1_800_000_000;
const CANNON = 20;

const upgrade = (id: number, level: number): CompletedJob => ({
  kind: "upgrade",
  id,
  t: CANNON,
  at: NOW - 60,
  detail: { from: level - 1, level, points: 1 },
});

const notification = (overrides: Partial<GameNotification> & Pick<GameNotification, "id">): GameNotification => ({
  kind: "jobs",
  baseid: null,
  at: NOW - 300,
  read: false,
  jobs: [upgrade(7, 5)],
  ...overrides,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeApi = (list: GameNotification[]) => {
  const api = {
    list: vi.fn(async () => ({ notifications: list, unread: list.filter((one) => !one.read).length })),
    unread: vi.fn(async () => 0),
    read: vi.fn(async () => 1),
    readAll: vi.fn(async () => 0),
  } satisfies NotificationsApi;
  return api;
};

describe("NotificationDoor", () => {
  let container: HTMLElement;
  let select: ReturnType<typeof vi.fn<(id: number) => void>>;
  let yard: string | null;

  beforeEach(() => {
    document.body.replaceChildren();
    container = document.createElement("div");
    document.body.append(container);
    select = vi.fn<(id: number) => void>();
    yard = null;
  });

  const doorWith = (api: NotificationsApi, onOpen = () => {}) => {
    const door = new NotificationDoor({
      container,
      api,
      onOpen,
      currentYard: () => yard,
      selectBuilding: select,
      now: () => NOW,
    });
    container.append(door.bell.element);
    return door;
  };

  const badge = (door: NotificationDoor) => door.bell.element.querySelector<HTMLElement>(".notif-badge")!;
  const rows = () => [...container.querySelectorAll<HTMLElement>(".notif-row")];

  it("shows the count the yard's answers carry, and none at 0", () => {
    const door = doorWith(fakeApi([]));
    expect(badge(door).hidden).toBe(true);
    door.setSaveCount(3);
    expect(badge(door).hidden).toBe(false);
    expect(badge(door).textContent).toBe("3");
    expect(door.bell.element.getAttribute("aria-label")).toBe("Notifications. 3 unread notifications");
    door.setSaveCount(undefined);
    expect(badge(door).textContent).toBe("3");
    door.setSaveCount(0);
    expect(badge(door).hidden).toBe(true);
  });

  it("opens on a click with the list, newest first, as the server gave it", async () => {
    const onOpen = vi.fn();
    const api = fakeApi([
      notification({ id: 9 }),
      notification({ id: 8, kind: "away", read: true, jobs: [upgrade(3, 2)], at: NOW - 3 * 3600 }),
    ]);
    const door = doorWith(api, onOpen);
    door.bell.element.click();
    await flush();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(door.isOpen).toBe(true);
    expect(rows().map((row) => row.dataset["id"])).toEqual(["9", "8"]);
    expect(rows()[0]!.classList.contains("notif-row--unread")).toBe(true);
    expect(rows()[1]!.classList.contains("notif-row--unread")).toBe(false);
    expect(rows()[0]!.querySelector(".notif-row__text")!.textContent).toBe(`Upgrade finished: ${typeName(CANNON)} 5`);
    expect(rows()[1]!.querySelector(".notif-row__text")!.textContent).toBe(
      `While you were away: upgrade finished: ${typeName(CANNON)} 2`,
    );
    expect(rows()[0]!.querySelector(".notif-row__meta")!.textContent).toBe("5 min ago");
    expect(rows()[1]!.querySelector(".notif-row__meta")!.textContent).toBe("3 h ago");
    expect(badge(door).textContent).toBe("1");

    door.bell.element.click();
    expect(door.isOpen).toBe(false);
  });

  it("marks a row read on a click, and keeps it read", async () => {
    const api = fakeApi([notification({ id: 9 }), notification({ id: 8 })]);
    const door = doorWith(api);
    await door.open();
    rows()[1]!.click();
    await flush();
    expect(api.read).toHaveBeenCalledWith(8);
    expect(rows()[1]!.classList.contains("notif-row--unread")).toBe(false);
    expect(rows()[0]!.classList.contains("notif-row--unread")).toBe(true);
    expect(badge(door).textContent).toBe("1");
    // A read row asks nothing more.
    rows()[1]!.click();
    await flush();
    expect(api.read).toHaveBeenCalledOnce();
  });

  it("marks every row read with Mark all read, which then has nothing left to do", async () => {
    const api = fakeApi([notification({ id: 9 }), notification({ id: 8 })]);
    const door = doorWith(api);
    await door.open();
    const readAll = container.querySelector<HTMLButtonElement>(".notif-screen__read-all")!;
    expect(readAll.disabled).toBe(false);
    readAll.click();
    await flush();
    expect(api.readAll).toHaveBeenCalledOnce();
    expect(rows().some((row) => row.classList.contains("notif-row--unread"))).toBe(false);
    expect(readAll.disabled).toBe(true);
    expect(badge(door).hidden).toBe(true);
  });

  it("selects a building named in a row about the open yard, closing the list and marking the row read", async () => {
    const api = fakeApi([notification({ id: 9 })]);
    const door = doorWith(api);
    await door.open();
    rows()[0]!.querySelector<HTMLButtonElement>(".job-notice__building")!.click();
    await flush();
    expect(select).toHaveBeenCalledWith(7);
    expect(door.isOpen).toBe(false);
    expect(api.read).toHaveBeenCalledWith(9);
  });

  it("names a building in another yard as plain text, and tags an outpost's row", async () => {
    const api = fakeApi([notification({ id: 9, baseid: "3511" }), notification({ id: 8 })]);
    yard = "3511";
    const door = doorWith(api);
    await door.open();
    expect(rows()[0]!.querySelector(".job-notice__building")).not.toBeNull();
    expect(rows()[0]!.querySelector(".notif-row__meta")!.textContent).toBe("5 min ago · Outpost");
    expect(rows()[1]!.querySelector(".job-notice__building")).toBeNull();
  });

  it("says when there is nothing, and when the list could not load", async () => {
    const door = doorWith(fakeApi([]));
    await door.open();
    expect(container.querySelector(".notif-list__empty")!.textContent).toBe(EMPTY_TEXT);
    door.close();

    const failing = { ...fakeApi([]), list: vi.fn(async () => Promise.reject(new Error("down"))) };
    const other = doorWith(failing);
    await other.open();
    expect([...container.querySelectorAll(".notif-status")].some((one) => one.textContent === LOAD_FAILED_TEXT)).toBe(
      true,
    );
  });

  it("fetches the open list again when a yard answer finished something other than hatches", async () => {
    const api = fakeApi([notification({ id: 9 })]);
    const door = doorWith(api);
    door.jobsFinished([upgrade(7, 5)]);
    expect(api.list).not.toHaveBeenCalled();
    await door.open();
    expect(api.list).toHaveBeenCalledOnce();
    door.jobsFinished([{ kind: "hatch", id: "C1", t: null, at: NOW, detail: { count: 1 } }]);
    expect(api.list).toHaveBeenCalledOnce();
    door.jobsFinished([upgrade(7, 6)]);
    await flush();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and takes everything away on destroy", async () => {
    const door = doorWith(fakeApi([notification({ id: 9 })]));
    await door.open();
    container.querySelector(".notif-screen")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(door.isOpen).toBe(false);
    door.destroy();
    expect(container.querySelector(".notif-screen")).toBeNull();
    expect(container.querySelector(".yard-dock__button--bell")).toBeNull();
  });
});
