import { afterEach, describe, expect, it, vi } from "vitest";
import type { RaidStartResponse, RaidView } from "@/api/raid";
import { ApiError } from "@/api/http";
import { RaidYardFlow, raidCountdownText, raidStage, type RaidBusy, type RaidStage } from "./raidYardFlow";
import { RaidWatch } from "./raidWatch";

/**
 * The raid on the own main yard up to the fight (issue #226 WP4): the alert,
 * the top bar, the start when it is due with the Planner closed, and what each
 * refusal does.
 */

const NOW = 1_800_000_000;

const raid = (over: Partial<RaidView> = {}): RaidView => ({
  id: "r1",
  phase: "warning",
  tribe: "Kozu",
  monsters: { C2: 10, C4: 5 },
  attackAt: NOW + 300,
  warned: 0,
  ...over,
});

const refusal = (reason: string, extra: Record<string, number> = {}): ApiError =>
  new ApiError("refused", { status: 409, details: { data: { reason, ...extra } } });

const startAnswer = (view: RaidView): RaidStartResponse =>
  ({
    error: 0,
    raid: { ...view, phase: "fighting" },
    fight: {
      seed: 1,
      events: [],
      hitLimit: 30,
      tick: 400,
      seconds: 5,
      yard: { buildingdata: {}, buildinghealthdata: {}, resources: {} },
      defence: null,
    },
  }) as unknown as RaidStartResponse;

/** A watch on a fixed server clock, `NOW` until moved. */
const clockedWatch = () => {
  let ms = NOW * 1000;
  const watch = new RaidWatch(() => ms);
  return { watch, at: (seconds: number) => (ms = seconds * 1000) };
};

const setup = (planner = false) => {
  const { watch, at } = clockedWatch();
  const stages: RaidStage[] = [];
  const busy: RaidBusy[] = [];
  const notices: string[] = [];
  const api = {
    engage: vi.fn(async (id: string) => ({ error: 0, raid: { ...watch.current!, id, attackAt: NOW } })),
    prepare: vi.fn(async (id: string) => ({ error: 0, raid: { ...watch.current!, id, warned: 1 as const } })),
    start: vi.fn(async () => startAnswer(watch.current!)),
  };
  const fight = vi.fn();
  const reload = vi.fn();
  let plannerOpen = planner;
  let ms = 0;
  const flow = new RaidYardFlow({
    watch,
    api: api as never,
    plannerOpen: () => plannerOpen,
    view: {
      render: (stage, state) => {
        stages.push(stage);
        busy.push(state);
      },
      notice: (message) => notices.push(message),
    },
    fight,
    reload,
    now: () => ms,
    retryMs: 5_000,
  });
  return {
    watch,
    at,
    flow,
    api,
    fight,
    reload,
    stages,
    busy,
    notices,
    setPlanner: (open: boolean) => (plannerOpen = open),
    advance: (by: number) => (ms += by),
    last: () => stages[stages.length - 1]!,
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe("raidStage", () => {
  it("reads the alert, the top bar, the due fight and the lock", () => {
    expect(raidStage(null, NOW, false)).toEqual({ kind: "none" });
    expect(raidStage(raid(), NOW, false)).toMatchObject({ kind: "alert", secondsLeft: 300 });
    expect(raidStage(raid({ warned: 1 }), NOW + 0.5, false)).toMatchObject({ kind: "spotted", secondsLeft: 300 });
    expect(raidStage(raid({ attackAt: NOW }), NOW, true)).toMatchObject({ kind: "due", planner: true });
    expect(raidStage(raid({ phase: "fighting" }), NOW, false)).toMatchObject({ kind: "locked" });
  });

  it("counts down as a clock", () => {
    expect(raidCountdownText(299)).toBe("4:59");
    expect(raidCountdownText(5)).toBe("0:05");
  });
});

describe("RaidYardFlow", () => {
  it("shows the alert, and Prepare defences turns it into the top bar", async () => {
    const t = setup();
    t.watch.set(raid());
    t.flow.start();
    expect(t.last().kind).toBe("alert");

    await t.flow.prepare();
    expect(t.api.prepare).toHaveBeenCalledWith("r1");
    expect(t.busy).toContain("prepare");
    expect(t.last()).toMatchObject({ kind: "spotted", secondsLeft: 300 });
    expect(t.fight).not.toHaveBeenCalled();
    t.flow.stop();
  });

  it("Engage now makes the fight due and starts it, handing the fight over", async () => {
    const t = setup();
    t.watch.set(raid());
    t.flow.start();
    await t.flow.engage();
    await settle();
    expect(t.api.start).toHaveBeenCalledWith("r1");
    expect(t.fight).toHaveBeenCalledTimes(1);
    expect(t.fight.mock.calls[0]![0].fight.hitLimit).toBe(30);
    expect(t.watch.current?.phase).toBe("fighting");
    t.flow.stop();
  });

  it("waits for the Planner to close before it starts a due fight", async () => {
    const t = setup(true);
    t.watch.set(raid({ attackAt: NOW - 1, warned: 1 }));
    t.flow.start();
    await settle();
    expect(t.last()).toMatchObject({ kind: "due", planner: true });
    expect(t.api.start).not.toHaveBeenCalled();

    t.setPlanner(false);
    t.flow.tick();
    await settle();
    expect(t.api.start).toHaveBeenCalledTimes(1);
    expect(t.fight).toHaveBeenCalledTimes(1);
    t.flow.stop();
  });

  it("starts the fight when the countdown runs out", async () => {
    const t = setup();
    t.watch.set(raid({ warned: 1 }));
    t.flow.start();
    expect(t.api.start).not.toHaveBeenCalled();
    t.at(NOW + 300);
    t.flow.tick();
    await settle();
    expect(t.api.start).toHaveBeenCalledTimes(1);
    t.flow.stop();
  });

  it("locks the yard while the server fights a raid this screen is not playing", () => {
    const t = setup();
    t.watch.set(raid({ phase: "fighting" }));
    t.flow.start();
    expect(t.last().kind).toBe("locked");
    expect(t.api.start).not.toHaveBeenCalled();
    t.flow.stop();
  });

  it("forgets a raid the server no longer has", async () => {
    const t = setup();
    t.watch.set(raid());
    t.api.engage.mockRejectedValueOnce(refusal("noRaid"));
    t.flow.start();
    await t.flow.engage();
    expect(t.watch.current).toBeNull();
    expect(t.last().kind).toBe("none");
    t.flow.stop();
  });

  it("takes the server's time on notYet and asks again a second later", async () => {
    const t = setup();
    t.watch.set(raid({ attackAt: NOW, warned: 1 }));
    t.api.start.mockRejectedValueOnce(refusal("notYet", { attackAt: NOW + 2 }));
    t.flow.start();
    await settle();
    expect(t.api.start).toHaveBeenCalledTimes(1);
    expect(t.last()).toMatchObject({ kind: "spotted", secondsLeft: 2 });
    t.at(NOW + 2);
    t.flow.tick();
    await settle();
    expect(t.api.start).toHaveBeenCalledTimes(1);
    t.advance(1_000);
    t.flow.tick();
    await settle();
    expect(t.api.start).toHaveBeenCalledTimes(2);
    t.flow.stop();
  });

  it("opens the yard again when the fight began elsewhere (notWarning)", async () => {
    const t = setup();
    t.watch.set(raid({ attackAt: NOW }));
    t.api.start.mockRejectedValueOnce(refusal("notWarning"));
    t.flow.start();
    await settle();
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.fight).not.toHaveBeenCalled();
    t.flow.stop();
  });

  it("waits five seconds after underAttack, busy or a network failure, saying so where it helps", async () => {
    const t = setup();
    t.watch.set(raid({ attackAt: NOW }));
    t.api.start
      .mockRejectedValueOnce(refusal("underAttack"))
      .mockRejectedValueOnce(new ApiError("busy", { status: 503, details: { data: { reason: "busy" } } }))
      .mockRejectedValueOnce(new Error("offline"));
    t.flow.start();
    await settle();
    expect(t.notices).toEqual([expect.stringContaining("Another attack")]);

    t.flow.tick();
    await settle();
    expect(t.api.start).toHaveBeenCalledTimes(1);

    t.advance(5_000);
    t.flow.tick();
    await settle();
    expect(t.api.start).toHaveBeenCalledTimes(2);
    expect(t.notices).toHaveLength(1);

    t.advance(5_000);
    t.flow.tick();
    await settle();
    expect(t.api.start).toHaveBeenCalledTimes(3);
    expect(t.notices[1]).toContain("Could not reach the server");

    t.advance(5_000);
    t.flow.tick();
    await settle();
    expect(t.fight).toHaveBeenCalledTimes(1);
    t.flow.stop();
  });

  it("does nothing once stopped", async () => {
    const t = setup();
    t.watch.set(raid({ attackAt: NOW }));
    let release: (value: RaidStartResponse) => void = () => {};
    t.api.start.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    t.flow.start();
    t.flow.stop();
    release(startAnswer(raid()));
    await settle();
    expect(t.fight).not.toHaveBeenCalled();
  });
});
