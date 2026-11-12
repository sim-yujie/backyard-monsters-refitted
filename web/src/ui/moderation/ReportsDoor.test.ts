// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModReportsApi } from "@/api/modReports";
import { ReportsDoor } from "./ReportsDoor";

/** The More fan's Reports button: moderators only, with the open count. */

const api = (moderator: boolean, open = 3): ModReportsApi =>
  ({
    status: vi.fn(() => Promise.resolve({ moderator, open })),
    list: vi.fn(() =>
      Promise.resolve({
        ok: true,
        filter: "all",
        players: [],
        closed: [],
        nextOffset: null,
        counts: { all: 0, reports: 0, filter: 0, closed: 0 },
      }),
    ),
    player: vi.fn(),
    around: vi.fn(),
    act: vi.fn(),
  }) as unknown as ModReportsApi;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
});

describe("ReportsDoor", () => {
  it("stays hidden for a player who is not a moderator", async () => {
    const door = new ReportsDoor({ container: document.body, api: api(false), pollMs: 0 });
    await settle();
    expect(door.button.dataset["dock"]).toBe("reports");
    expect(door.button.hidden).toBe(true);
    door.open();
    expect(door.isOpen).toBe(false);
    door.destroy();
  });

  it("shows a moderator the button with the monster picture and the open count", async () => {
    const door = new ReportsDoor({ container: document.body, api: api(true, 5), pollMs: 0 });
    await settle();
    expect(door.button.hidden).toBe(false);
    expect(door.button.querySelector<HTMLImageElement>(".yard-dock__picture")!.getAttribute("src")).toBe("/assets/popups/military.png");
    const badge = door.button.querySelector<HTMLElement>(".yard-dock__badge")!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("5");
    door.destroy();
  });

  it("hides the badge when nothing is open, and caps a big count", async () => {
    const none = new ReportsDoor({ container: document.body, api: api(true, 0), pollMs: 0 });
    const many = new ReportsDoor({ container: document.body, api: api(true, 250), pollMs: 0 });
    await settle();
    expect(none.button.querySelector<HTMLElement>(".yard-dock__badge")!.hidden).toBe(true);
    expect(many.button.querySelector<HTMLElement>(".yard-dock__badge")!.textContent).toBe("99+");
    none.destroy();
    many.destroy();
  });

  it("opens and closes the Reports window, telling the scene first", async () => {
    const onOpen = vi.fn();
    const door = new ReportsDoor({ container: document.body, api: api(true), onOpen, pollMs: 0 });
    await settle();
    door.button.click();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(document.querySelector(".mod-reports-window")).not.toBeNull();
    door.button.click();
    expect(door.isOpen).toBe(false);
    expect(document.querySelector(".mod-reports-window")).toBeNull();
    door.destroy();
  });

  it("reads the status again on its round, but not while the game is out of view", async () => {
    vi.useFakeTimers();
    try {
      const routes = api(true);
      const door = new ReportsDoor({ container: document.body, api: routes, pollMs: 1000 });
      expect(routes.status).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(routes.status).toHaveBeenCalledTimes(2);
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      await vi.advanceTimersByTimeAsync(1000);
      expect(routes.status).toHaveBeenCalledTimes(2);
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      door.destroy();
      await vi.advanceTimersByTimeAsync(5000);
      expect(routes.status).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
