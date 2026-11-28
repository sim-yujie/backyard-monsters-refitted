// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RaidResult } from "@/api/raid";
import type { WaveStatus } from "@/api/waves";
import { rememberWaveArmy, waveCounter, waveStripLine, waveTip } from "@/game/waves/waveText";
import { startWave } from "@/game/yard/plugins/waves";
import { ApiError } from "@/api/http";
import { onWaveFeed, resetWaveFeed, setWaveFeed, snoozeWaveMark, waveMarkDue, waveReady } from "@/game/waves/waveFeed";
import { scriptMonsters, yardHealth } from "./WaveFight";
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
    expect(waveStripLine(7, 31)).toBe("Wave 7/30");
    expect(waveStripLine(31, 31)).toBe("Bonus wave 1");
    expect(waveCounter(7, 31)).toBe("7/30");
    expect(waveCounter(32, 31)).toBe("Bonus 2");
  });
});

describe("the fight's pill", () => {
  it("shows the yard's health as the strip rounds its damage, and counts the script's monsters", () => {
    expect(yardHealth(0)).toBe(100);
    expect(yardHealth(23.7)).toBe(77);
    expect(yardHealth(120)).toBe(0);
    expect(scriptMonsters([{ monsters: { C1: 5, C2: 3 } }, { monsters: { G1: 1 } }])).toBe(9);
    expect(scriptMonsters([{ monsters: { C1: 5 } }, { monsters: {}, champion: { t: 1, l: 4 } }])).toBe(6);
  });

  it("tips flyers first, then a champion, then a swarm", () => {
    const flies = (monster: string) => monster === "C9";
    expect(waveTip([], flies)).toBeNull();
    expect(waveTip([{ monster: "C9", count: 2 }, { monster: "G1", count: 1 }], flies)).toContain("Flyers");
    expect(waveTip([{ monster: "G1", count: 1 }], flies)).toContain("champion");
    expect(waveTip([{ monster: "C1", count: 45 }], flies)).toContain("swarm");
    expect(waveTip([{ monster: "C1", count: 5 }], flies)).toContain("Tough");
  });
});

describe("waveTrack", () => {
  it("counts main waves out of 30, then the bonus waves, with six totem marks", () => {
    expect(waveTrack(7, 32, 121, 31).querySelector(".wave-track__count")?.textContent).toBe("7/30 won");
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

  it("a loss offers Retry, says what winning needs, and gives a tip from the wave's army", () => {
    rememberWaveArmy("wmi1-1", 7, [{ monster: "C3", count: 50 }]);
    waveResultPopup(result({ beaten: false, next: 7, glimmers: 0 }), { onNext: vi.fn() }, vi.fn()).mount(document.body);
    expect(document.body.textContent).toContain("Wave 7 lost");
    expect(document.body.textContent).toContain("more than 10%");
    expect(document.body.textContent).toContain("Repairs started");
    expect(document.body.querySelector(".wave-result__tip")?.textContent).toContain("big swarm");
    expect(document.body.querySelector(".wave-result__next")?.textContent).toContain("Retry");
  });

  it("the last wave beaten has no next wave to start", () => {
    waveResultPopup(result({ wave: 32, next: null, glimmers: 60 }), { onNext: vi.fn() }, vi.fn()).mount(document.body);
    expect(document.body.textContent).toContain("Bonus wave 2 beaten!");
    expect(document.body.querySelector(".wave-result__next")).toBeNull();
  });
});

describe("the Events card", () => {
  const feed = (extra: Partial<WaveStatus> = {}, busy = false, blocked = false) => ({ status: status(extra), busy, blocked });

  it("shows the track, the prize and the start, with no monsters", () => {
    const onStart = vi.fn();
    const body = waveCardBody(feed(), onStart);
    expect(body.querySelector(".wave-track")).not.toBeNull();
    expect(body.querySelector(".wave-card__prize")?.textContent).toContain("+5");
    // No monster portraits or counts (owner, 27 Nov 2026: clutter).
    expect(body.querySelector("img[class*=portrait]")).toBeNull();
    expect(body.textContent).not.toContain("×");
    const start = body.querySelector<HTMLButtonElement>(".wave-card__start")!;
    expect(start.textContent).toContain("Start wave 7");
    start.click();
    start.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("shows the totem's next level on a totem wave, and names a bonus wave as the pop-ups do", () => {
    const body = waveCardBody(feed({ beaten: 30, next: 31, prize: { glimmers: 40, totemLevel: 5 } }), vi.fn());
    expect(body.querySelector(".wave-card__chip--totem")?.textContent).toContain("Lv 5");
    expect(body.querySelector(".wave-card__start")?.textContent).toContain("Start bonus 1");
  });

  it("is busy while the wave is called, and waits while a wild raid is on", () => {
    const busy = waveCardBody(feed({}, true), vi.fn()).querySelector<HTMLButtonElement>(".wave-card__start")!;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain("Starting");
    const blocked = waveCardBody(feed({}, false, true), vi.fn()).querySelector<HTMLButtonElement>(".wave-card__start")!;
    expect(blocked.disabled).toBe(true);
    expect(blocked.textContent).toContain("Start wave 7");
  });

  it("has no start once every wave is won", () => {
    const body = waveCardBody(feed({ beaten: 32, next: null, prize: null, totemLevel: 6 }), vi.fn());
    expect(body.querySelector(".wave-card__start")).toBeNull();
    expect(body.textContent).toContain("All 32 waves won");
  });
});

describe("the wave feed and the Events button's mark", () => {
  afterEach(() => resetWaveFeed());
  const DAY = 86_400;

  it("tells its listeners only when something changed", () => {
    const listener = vi.fn();
    onWaveFeed(listener);
    setWaveFeed(status());
    setWaveFeed(status());
    expect(listener).toHaveBeenCalledTimes(1);
    setWaveFeed(status(), true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("is due while a wave can be started, rests for the day once Events opens, and comes back the next day", () => {
    const now = 1_000 * DAY + 100;
    expect(waveMarkDue(now)).toBe(false);
    setWaveFeed(status());
    expect(waveReady()).toBe(true);
    expect(waveMarkDue(now)).toBe(true);
    snoozeWaveMark(now);
    expect(waveMarkDue(now + 3_600)).toBe(false);
    expect(waveMarkDue(now + DAY)).toBe(true);
  });

  it("is not due while busy, during a wild raid, or with every wave won", () => {
    setWaveFeed(status(), true);
    expect(waveMarkDue(0)).toBe(false);
    setWaveFeed(status(), false, true);
    expect(waveMarkDue(0)).toBe(false);
    setWaveFeed(status({ next: null }));
    expect(waveMarkDue(0)).toBe(false);
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
