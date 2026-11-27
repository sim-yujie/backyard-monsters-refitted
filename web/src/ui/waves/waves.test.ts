// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RaidResult } from "@/api/raid";
import type { WaveStatus } from "@/api/waves";
import { waveCounter, waveStripLine } from "@/game/waves/waveText";
import { startWave } from "@/game/yard/plugins/waves";
import { ApiError } from "@/api/http";
import { WaveHud } from "./WaveHud";
import { waveResultPopup, waveTrack } from "./WaveScreens";
import { waveCardBody } from "./waveEventCard";

/** The wave events' screens (beta 10, Wild Monster Invasion). */

const status = (extra: Partial<WaveStatus> = {}): WaveStatus => ({
  event: "wmi1",
  title: "Wild Monster Invasion",
  run: "wmi1-1",
  endsAt: 2_000_000_000,
  waves: 32,
  firstBonusWave: 31,
  beaten: 6,
  lost: 0,
  next: 7,
  preview: [
    { monster: "C6", count: 10 },
    { monster: "C3", count: 50 },
  ],
  size: 60,
  prize: { glimmers: 5 },
  totemType: 121,
  totemLevel: 1,
  banner: { modern: "/events/wmi1-banner.jpg", classic: "/events/wmi1-banner-classic.jpg" },
  ...extra,
});

const result = (wave: Partial<NonNullable<RaidResult["wave"]>> = {}): RaidResult => ({
  id: "r_1",
  tribe: "wave",
  at: 1,
  defended: false,
  health: 0.42,
  stolen: { r1: 0, r2: 0, r3: 0, r4: 0 },
  shiny: 0,
  damaged: [3],
  housedLost: 0,
  wave: { event: "wmi1", run: "wmi1-1", wave: 7, waves: 32, firstBonusWave: 31, totemType: 121, beaten: true, surrendered: false, next: 8, glimmers: 5, ...wave },
});

afterEach(() => {
  document.body.replaceChildren();
  try {
    window.localStorage.clear();
  } catch {
    /* none */
  }
});

describe("the words", () => {
  it("names main waves out of 30 and the bonus waves apart", () => {
    expect(waveStripLine(7, 31)).toBe("Wave 7 of 30");
    expect(waveStripLine(31, 31)).toBe("Bonus wave 1");
    expect(waveCounter(7, 31)).toBe("7/30");
    expect(waveCounter(32, 31)).toBe("Bonus 2");
  });
});

describe("WaveHud", () => {
  it("is hidden with no event on, and names the next wave with its monsters, prize and start", () => {
    const onStart = vi.fn();
    const hud = new WaveHud({ onStart }).mount(document.body);
    hud.update(null);
    expect(hud.element.hidden).toBe(true);
    hud.update(status());
    expect(hud.element.hidden).toBe(false);
    expect(hud.element.querySelector(".wave-hud__label")?.textContent).toBe("Wave 7/30");
    // jsdom is wide: a computer's bar starts open.
    expect(hud.element.querySelectorAll(".wave-hud__monster")).toHaveLength(2);
    const start = hud.element.querySelector<HTMLButtonElement>(".wave-hud__start")!;
    expect(start.textContent).toContain("Start wave 7");
    start.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("the pill only opens and closes the tray; it never starts a wave", () => {
    const onStart = vi.fn();
    const hud = new WaveHud({ onStart }).mount(document.body);
    hud.update(status());
    const pill = hud.element.querySelector<HTMLButtonElement>(".wave-hud__pill")!;
    pill.click();
    expect(hud.element.querySelector<HTMLElement>(".wave-hud__tray")!.hidden).toBe(true);
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    pill.click();
    expect(hud.element.querySelector<HTMLElement>(".wave-hud__tray")!.hidden).toBe(false);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("keeps a bonus wave's army secret, shows the totem prize, and has no start once every wave is beaten", () => {
    const hud = new WaveHud({ onStart: vi.fn() }).mount(document.body);
    hud.update(status({ beaten: 30, next: 31, preview: [], prize: { glimmers: 40, totemLevel: 5 }, totemLevel: 4 }));
    expect(hud.element.querySelector(".wave-hud__secret")).not.toBeNull();
    expect(hud.element.querySelector(".wave-hud__prize-totem")).not.toBeNull();
    expect(hud.element.querySelector(".wave-hud__label")?.textContent).toBe("Bonus wave 1");
    hud.update(status({ beaten: 32, next: null, preview: [], prize: null, totemLevel: 6 }));
    expect(hud.element.querySelector(".wave-hud__start")).toBeNull();
    expect(hud.element.querySelector(".wave-hud__label")?.textContent).toBe("All waves beaten");
  });

  it("disables the start while a wave is being called", () => {
    const hud = new WaveHud({ onStart: vi.fn() }).mount(document.body);
    hud.update(status(), true);
    expect(hud.element.querySelector<HTMLButtonElement>(".wave-hud__start")!.disabled).toBe(true);
  });
});

describe("waveTrack", () => {
  it("counts main waves out of 30, then the bonus waves, with six totem marks", () => {
    expect(waveTrack(7, 32, 121, 31).querySelector(".wave-track__count")?.textContent).toBe("7/30");
    expect(waveTrack(31, 32, 121, 31).querySelector(".wave-track__count")?.textContent).toBe("Bonus 1/2");
    const track = waveTrack(10, 32, 121, 31);
    expect(track.querySelectorAll(".wave-track__mark")).toHaveLength(6);
    expect(track.querySelectorAll(".wave-track__mark--won")).toHaveLength(2);
  });
});

describe("the result pop-up", () => {
  it("a win: its Glimmers and Start of the next wave, which runs after it closes", () => {
    const onNext = vi.fn();
    const onClose = vi.fn();
    waveResultPopup(result(), { onNext }, onClose).mount(document.body);
    expect(document.body.textContent).toContain("Wave 7 beaten!");
    const next = document.body.querySelector<HTMLButtonElement>(".wave-result__next")!;
    expect(next.textContent).toContain("Start wave 8");
    next.click();
    expect(onClose).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("a loss offers Retry and says what winning needs", () => {
    waveResultPopup(result({ beaten: false, next: 7, glimmers: 0 }), { onNext: vi.fn() }, vi.fn()).mount(document.body);
    expect(document.body.textContent).toContain("Wave 7 lost");
    expect(document.body.textContent).toContain("more than 10%");
    expect(document.body.querySelector(".wave-result__next")?.textContent).toContain("Retry");
  });

  it("the last wave beaten has no next wave to start", () => {
    waveResultPopup(result({ wave: 32, next: null, glimmers: 60 }), { onNext: vi.fn() }, vi.fn()).mount(document.body);
    expect(document.body.textContent).toContain("Bonus wave 2 beaten!");
    expect(document.body.querySelector(".wave-result__next")).toBeNull();
  });
});

describe("the Events card", () => {
  it("shows the track, the next wave and its start", () => {
    const onStart = vi.fn();
    const body = waveCardBody(status(), onStart);
    expect(body.querySelector(".wave-track")).not.toBeNull();
    expect(body.textContent).toContain("Next: Wave 7");
    body.querySelector<HTMLButtonElement>(".wave-card__start")!.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe("startWave", () => {
  const mounts = () => ({
    store: { save: { baseid: "1" } } as never,
    scene: { openRaid: vi.fn() } as never as { openRaid: () => void },
    notices: { show: vi.fn() } as never as { show: ReturnType<typeof vi.fn> },
  });

  it("hands the fought wave to the raid scene", async () => {
    const m = mounts();
    const next = vi.fn(async () => ({ error: 0, raid: { id: "r_1" }, fight: {}, wave: status() }) as never);
    expect(await startWave(m as never, { next })).toBe(true);
    expect((m.scene as { openRaid: ReturnType<typeof vi.fn> }).openRaid).toHaveBeenCalled();
  });

  it("says why the server refused, in its own words", async () => {
    const m = mounts();
    const refusal = new ApiError("A raid is already happening on your yard.", { status: 409, details: { status: 409, data: { reason: "raidOpen" }, message: "" } } as never);
    const next = vi.fn(async () => {
      throw refusal;
    });
    expect(await startWave(m as never, { next })).toBe(false);
    expect(m.notices.show).toHaveBeenCalledWith("wave", "A raid is already happening on your yard.", expect.anything());
  });
});
