// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AllianceApi } from "@/api/alliance";
import { allianceOpener } from "@/game/alliance/allianceView";
import { AllianceDoor } from "./AllianceDoor";

/** The More fan's Alliance button and the window behind it (beta 7). */

const ok = <T extends object>(value: T) => Promise.resolve({ ok: true as const, ...value });

const api = (): AllianceApi =>
  ({
    mine: vi.fn(() => ok({ alliance: null, rejoinAt: null })),
    search: vi.fn(() => ok({ alliances: [], pageSize: 10, totalResults: 0 })),
    messages: vi.fn(() => ok({ messages: [] })),
  }) as unknown as AllianceApi;

afterEach(() => {
  document.body.replaceChildren();
});

describe("AllianceDoor", () => {
  it("is a hidden dock button named alliance with the painted icon until Map Room 2 shows it", () => {
    const door = new AllianceDoor({ container: document.body, api: api() });
    expect(door.button.dataset["dock"]).toBe("alliance");
    expect(door.button.hidden).toBe(true);
    expect(door.button.querySelector<HTMLImageElement>(".yard-dock__picture")!.src).toContain("ui/icons/alliance-64.webp");
    door.setAvailable(true);
    expect(door.button.hidden).toBe(false);
    door.destroy();
  });

  it("opens and closes the window from the button, and tells the scene first", () => {
    const onOpen = vi.fn();
    const door = new AllianceDoor({ container: document.body, api: api(), onOpen });
    door.button.click();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(door.isOpen).toBe(true);
    expect(document.querySelector(".alliance-window")).not.toBeNull();
    door.button.click();
    expect(door.isOpen).toBe(false);
    expect(document.querySelector(".alliance-window")).toBeNull();
    door.destroy();
  });

  it("is the alliance opener while it stands", () => {
    const door = new AllianceDoor({ container: document.body, api: api() });
    allianceOpener()!();
    expect(door.isOpen).toBe(true);
    door.destroy();
    expect(allianceOpener()).toBeNull();
    expect(document.querySelector(".alliance-window")).toBeNull();
  });
});
