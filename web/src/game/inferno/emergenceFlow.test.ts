import { describe, expect, it, vi } from "vitest";
import { ATTACK_DELAY_MS, FOCUS_DELAY_MS } from "./cave";
import { BUSY_RETRY_MS, playEmergence, playStagePassed, type EmergenceView } from "./emergenceFlow";
import { MOLOCH_INTRO, MOLOCH_TAUNTS } from "./emergenceText";

/** The order of Moloch's emergence on the main yard (Inferno WP 1.10), on a view that only writes down what it is asked. */

const fakeView = (busyFor = 0) => {
  const log: string[] = [];
  let busyLeft = busyFor;
  const view: EmergenceView = {
    setCaveLevel: (level) => log.push(`cave ${level}`),
    focusCave: () => log.push("focus"),
    busy: () => busyLeft-- > 0,
    moloch: async (text) => {
      log.push(`moloch ${text === MOLOCH_INTRO ? "intro" : `taunt ${MOLOCH_TAUNTS.indexOf(text) + 1}`}`);
    },
    earthquake: () => {
      log.push("quake");
      return () => log.push("quake over");
    },
    stagePassed: async () => {
      log.push("stage passed");
    },
    complete: async () => {
      log.push("complete");
    },
    warning: async (groups, engage) => {
      log.push(`warning ${groups.map((group) => `${group.monster}x${group.count}`).join(" ")}`);
      while (!(await engage())) log.push("engage again");
    },
  };
  return { view, log };
};

const instantWait = (log: string[]) => async (ms: number) => {
  log.push(`wait ${ms}`);
};

/** Moloch's raid for a raise: raid 1's groups at a low level, and a start that hands the fight on. */
const molochRaid = (start = vi.fn(async () => true)) => ({
  groups: [
    { monster: "IC1", count: 1 },
    { monster: "IC1", count: 1 },
  ],
  start,
});

describe("playEmergence", () => {
  it("lets Moloch speak before the first raise, grows the cave with the earthquake, then warns with his army", async () => {
    const { view, log } = fakeView();
    const raid = molochRaid();
    await playEmergence(1, { view, wait: instantWait(log), alive: () => true, raid });
    expect(log).toEqual([
      "cave 0",
      `wait ${FOCUS_DELAY_MS}`,
      "focus",
      "moloch intro",
      "cave 1",
      "quake",
      `wait ${ATTACK_DELAY_MS}`,
      "quake over",
      "warning IC1x1 IC1x1",
    ]);
    expect(raid.start).toHaveBeenCalledTimes(1);
  });

  it("has no intro on a later raise", async () => {
    const { view, log } = fakeView();
    await playEmergence(3, {
      view,
      wait: instantWait(log),
      alive: () => true,
      raid: molochRaid(),
    });
    expect(log).toEqual([
      "cave 2",
      `wait ${FOCUS_DELAY_MS}`,
      "focus",
      "cave 3",
      "quake",
      `wait ${ATTACK_DELAY_MS}`,
      "quake over",
      "warning IC1x1 IC1x1",
    ]);
  });

  it("keeps the warning up until the start is done with", async () => {
    const { view, log } = fakeView();
    const start = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await playEmergence(2, {
      view,
      wait: instantWait(log),
      alive: () => true,
      raid: molochRaid(start),
    });
    expect(log.slice(-2)).toEqual(["warning IC1x1 IC1x1", "engage again"]);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("a first raise with no raid (the yard at 10% or less) grows the cave with no earthquake and no warning, as Flash", async () => {
    const { view, log } = fakeView();
    await playEmergence(1, { view, wait: instantWait(log), alive: () => true, raid: null });
    expect(log).toEqual(["cave 0", `wait ${FOCUS_DELAY_MS}`, "focus", "moloch intro", "cave 1"]);
  });

  it("waits a second at a time while the player is busy", async () => {
    const { view, log } = fakeView(2);
    await playEmergence(2, { view, wait: instantWait(log), alive: () => true });
    expect(log.slice(0, 5)).toEqual(["cave 1", `wait ${FOCUS_DELAY_MS}`, `wait ${BUSY_RETRY_MS}`, `wait ${BUSY_RETRY_MS}`, "focus"]);
  });

  it("drops the rest once the yard has gone", async () => {
    const { view, log } = fakeView();
    const raid = molochRaid();
    let alive = true;
    const wait = async (ms: number) => {
      log.push(`wait ${ms}`);
      alive = false;
    };
    await playEmergence(2, { view, wait, alive: () => alive, raid });
    expect(log).toEqual(["cave 1", `wait ${FOCUS_DELAY_MS}`]);
    expect(raid.start).not.toHaveBeenCalled();
  });

  it("stops after the intro if the yard went while Moloch spoke", async () => {
    const { view, log } = fakeView();
    let alive = true;
    view.moloch = async () => {
      log.push("moloch");
      alive = false;
    };
    await playEmergence(1, {
      view,
      wait: instantWait(log),
      alive: () => alive,
      raid: molochRaid(),
    });
    expect(log).toEqual(["cave 0", `wait ${FOCUS_DELAY_MS}`, "focus", "moloch"]);
  });

  it("stops the earthquake but gives no warning if the yard went during it", async () => {
    const { view, log } = fakeView();
    const raid = molochRaid();
    let alive = true;
    const wait = async (ms: number) => {
      log.push(`wait ${ms}`);
      // Gone during the earthquake's wait.
      if (log.includes("quake")) alive = false;
    };
    await playEmergence(4, { view, wait, alive: () => alive, raid });
    expect(log.at(-1)).toBe("quake over");
    expect(raid.start).not.toHaveBeenCalled();
  });
});

describe("playStagePassed", () => {
  it("shows stage passed and the taunt for the level", async () => {
    const { view, log } = fakeView();
    await playStagePassed(3, view);
    expect(log).toEqual(["stage passed", "moloch taunt 3"]);
  });

  it("ends with the last popup after the fifth raid", async () => {
    const { view, log } = fakeView();
    await playStagePassed(5, view);
    expect(log).toEqual(["stage passed", "moloch taunt 5", "complete"]);
  });

  it("keeps the taunt within the five there are", async () => {
    const { view, log } = fakeView();
    await playStagePassed(0, view);
    expect(log).toEqual(["stage passed", "moloch taunt 1"]);
  });
});
