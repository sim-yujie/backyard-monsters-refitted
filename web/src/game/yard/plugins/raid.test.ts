// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RaidResult } from "@/api/raid";
import { setRaidNote, setRaidResult } from "@/game/raid/raidSession";
import { raidWatch } from "@/game/raid/raidWatch";
import type { YardMounts } from "../yardPlugins";
import { raidYardPlugin } from "./raid";

/** The raid's own-yard plugin (issue #226 WP4): main yard only, the stage on screen, the aftermath. */

const RESULT: RaidResult = {
  id: "r1",
  tribe: "Kozu",
  at: 1_000,
  defended: true,
  health: 0.97,
  stolen: { r1: 0, r2: 0, r3: 0, r4: 0 },
  shiny: 10,
  damaged: [],
  housedLost: 0,
};

const mounts = (kind: "main" | "outpost") => {
  const modal = document.createElement("div");
  const content = document.createElement("div");
  document.body.append(modal, content);
  const notices = { show: vi.fn() };
  const scene = { openMap: vi.fn(), plannerOpen: () => false, openRaid: vi.fn(), reload: vi.fn() };
  const store = { kind, save: { buildingdata: {} }, credits: 0, now: () => 0 };
  return {
    modal,
    content,
    notices,
    scene,
    mounts: { store, overlay: { modal, content }, notices, scene } as unknown as YardMounts,
  };
};

afterEach(() => {
  raidWatch.set(null);
  document.body.replaceChildren();
});

describe("raidYardPlugin", () => {
  it("stays off an outpost", () => {
    const t = mounts("outpost");
    expect(raidYardPlugin(t.mounts)).toBeUndefined();
  });

  it("shows the alert for a raid in its warning, and takes it down on teardown", () => {
    const t = mounts("main");
    raidWatch.set({
      id: "r1",
      phase: "warning",
      tribe: "Kozu",
      monsters: { C2: 4 },
      attackAt: raidWatch.serverNow() + 300,
      warned: 0,
    });
    const teardown = raidYardPlugin(t.mounts);
    expect(t.modal.querySelector(".raid-alert")).not.toBeNull();
    if (typeof teardown === "function") teardown();
    expect(t.modal.querySelector(".raid-alert")).toBeNull();
  });

  it("shows what the last fight landed, once, and a line when it did not land", () => {
    setRaidResult(RESULT);
    setRaidNote("The raid was called off.");
    const t = mounts("main");
    const teardown = raidYardPlugin(t.mounts);
    expect(t.modal.querySelector(".raid-result--good")).not.toBeNull();
    expect(t.notices.show).toHaveBeenCalledWith("raid", "The raid was called off.", expect.anything());
    if (typeof teardown === "function") teardown();

    const again = mounts("main");
    const second = raidYardPlugin(again.mounts);
    expect(again.modal.querySelector(".raid-result")).toBeNull();
    if (typeof second === "function") second();
  });
});
