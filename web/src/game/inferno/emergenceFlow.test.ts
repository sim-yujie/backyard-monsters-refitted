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
  };
  return { view, log };
};

const instantWait = (log: string[]) => async (ms: number) => {
  log.push(`wait ${ms}`);
};

describe("playEmergence", () => {
  it("lets Moloch speak before the first raise, then grows the cave with the earthquake", async () => {
    const { view, log } = fakeView();
    const raid = vi.fn();
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
    ]);
    expect(raid).toHaveBeenCalledWith(1);
  });

  it("has no intro on a later raise", async () => {
    const { view, log } = fakeView();
    await playEmergence(3, { view, wait: instantWait(log), alive: () => true });
    expect(log).toEqual(["cave 2", `wait ${FOCUS_DELAY_MS}`, "focus", "cave 3", "quake", `wait ${ATTACK_DELAY_MS}`, "quake over"]);
  });

  it("waits a second at a time while the player is busy", async () => {
    const { view, log } = fakeView(2);
    await playEmergence(2, { view, wait: instantWait(log), alive: () => true });
    expect(log.slice(0, 5)).toEqual(["cave 1", `wait ${FOCUS_DELAY_MS}`, `wait ${BUSY_RETRY_MS}`, `wait ${BUSY_RETRY_MS}`, "focus"]);
  });

  it("drops the rest once the yard has gone", async () => {
    const { view, log } = fakeView();
    const raid = vi.fn();
    let alive = true;
    const wait = async (ms: number) => {
      log.push(`wait ${ms}`);
      alive = false;
    };
    await playEmergence(2, { view, wait, alive: () => alive, raid });
    expect(log).toEqual(["cave 1", `wait ${FOCUS_DELAY_MS}`]);
    expect(raid).not.toHaveBeenCalled();
  });

  it("stops after the intro if the yard went while Moloch spoke", async () => {
    const { view, log } = fakeView();
    let alive = true;
    view.moloch = async () => {
      log.push("moloch");
      alive = false;
    };
    await playEmergence(1, { view, wait: instantWait(log), alive: () => alive });
    expect(log).toEqual(["cave 0", `wait ${FOCUS_DELAY_MS}`, "focus", "moloch"]);
  });

  it("stops the earthquake but sends no raid if the yard went during it", async () => {
    const { view, log } = fakeView();
    const raid = vi.fn();
    let alive = true;
    const wait = async (ms: number) => {
      log.push(`wait ${ms}`);
      // Gone during the earthquake's wait.
      if (log.includes("quake")) alive = false;
    };
    await playEmergence(4, { view, wait, alive: () => alive, raid });
    expect(log.at(-1)).toBe("quake over");
    expect(raid).not.toHaveBeenCalled();
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
