import { describe, expect, it } from "vitest";
import type { HelpBlock } from "@/api/friends";
import { afterHelp, afterRefusal, savingTag, type HelpTarget } from "./helpModel";
import { helpAllResultText, helpAllShortText, runHelpAll, stopsHelpAll, type HelpOutcome } from "./helpAll";

/**
 * Help all (beta 8, owner 15 Nov 2026): every speed-up, one after another,
 * adding up the server's own numbers; a refusal about one building is passed
 * over, one about the whole visit stops it.
 */

const reward = (each: number) => ({ r1: each, r2: each, r3: each, r4: each });

const blockOf = (ids: number[]): HelpBlock => ({
  rewardsLeft: 5,
  buildings: Object.fromEntries(ids.map((id) => [String(id), { speedup: true as const }])),
});

/** A scene stand-in: answers from a script, keeps the block as the scene does, logs the order. */
const scene = (answers: Record<number, HelpOutcome>, ids = [1, 2, 3]) => {
  let block: HelpBlock | null = blockOf(ids);
  const asked: number[] = [];
  let inFlight = 0;
  let overlapped = false;
  const helpOne = async (target: HelpTarget): Promise<HelpOutcome> => {
    inFlight += 1;
    if (inFlight > 1) overlapped = true;
    asked.push(target.id);
    await Promise.resolve();
    inFlight -= 1;
    const answer = answers[target.id] ?? { ok: true, secondsSaved: 60, reward: reward(10) };
    if (block) {
      block = answer.ok
        ? afterHelp(block, target.id, target.kind, 4)
        : afterRefusal(block, target.id, target.kind, answer.reason);
    }
    return answer;
  };
  return {
    helpOne,
    block: () => block,
    asked,
    get overlapped() {
      return overlapped;
    },
    leave: () => {
      block = null;
    },
  };
};

const targets = (ids: number[]): HelpTarget[] => ids.map((id) => ({ id, kind: "speedup" }));

describe("runHelpAll", () => {
  it("helps each in turn, never two at once, and adds up the server's numbers", async () => {
    const yard = scene({ 2: { ok: true, secondsSaved: 1080, reward: reward(0) } });
    const steps: string[] = [];
    const summary = await runHelpAll(targets([1, 2, 3]), {
      block: yard.block,
      helpOne: yard.helpOne,
      onStep: (done, total) => steps.push(`${done}/${total}`),
    });
    expect(yard.asked).toEqual([1, 2, 3]);
    expect(yard.overlapped).toBe(false);
    expect(steps).toEqual(["1/3", "2/3", "3/3"]);
    expect(summary).toEqual({ helped: 3, secondsSaved: 1200, reward: { r1: 20, r2: 20, r3: 20, r4: 20 }, skipped: 0, stoppedBy: null });
  });

  it("adds the helps up as their tags read, so the total is the tags' sum", async () => {
    // The lead's yard: 2h 38m 59s, 3h 35m 59s and 2h 23m 59s read 2h 38m, 3h 35m and 2h 23m.
    const seconds = [9539, 12_959, 8639];
    const yard = scene(
      Object.fromEntries(seconds.map((secondsSaved, i) => [i + 1, { ok: true as const, secondsSaved, reward: reward(0) }])),
    );
    const summary = await runHelpAll(targets([1, 2, 3]), { block: yard.block, helpOne: yard.helpOne });
    expect(seconds.map(savingTag)).toEqual(["-2h 38m", "-3h 35m", "-2h 23m"]);
    expect(summary.secondsSaved).toBe((2 * 60 + 38 + 3 * 60 + 35 + 2 * 60 + 23) * 60);
    expect(helpAllResultText(summary)).toBe("Helped 3 · saved 8h 36m");
  });

  it("passes over a refusal about one building and goes on", async () => {
    const yard = scene({ 2: { ok: false, reason: "helpersFull", text: "5 friends have already sped up this job." } });
    const summary = await runHelpAll(targets([1, 2, 3]), { block: yard.block, helpOne: yard.helpOne });
    expect(yard.asked).toEqual([1, 2, 3]);
    expect(summary.helped).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.stoppedBy).toBeNull();
  });

  it("stops on a refusal about the whole visit", async () => {
    const yard = scene({ 2: { ok: false, reason: "underAttack", text: "They are under attack right now." } });
    const summary = await runHelpAll(targets([1, 2, 3]), { block: yard.block, helpOne: yard.helpOne });
    expect(yard.asked).toEqual([1, 2]);
    expect(summary.helped).toBe(1);
    expect(summary.stoppedBy).toBe("They are under attack right now.");
    for (const reason of ["notFriends", "cannotSend", "tooNew", "rateLimited", "network", "unknown"]) {
      expect(stopsHelpAll(reason)).toBe(true);
    }
    for (const reason of ["alreadyHelped", "helpersFull", "nothingToHelp"]) expect(stopsHelpAll(reason)).toBe(false);
  });

  it("skips a help the block no longer offers, and stops once the visit is over", async () => {
    const yard = scene({});
    const summary = await runHelpAll(targets([1, 4, 2, 3]), {
      block: yard.block,
      helpOne: async (target) => {
        const answer = await yard.helpOne(target);
        if (target.id === 2) yard.leave();
        return answer;
      },
      goOn: () => yard.block() !== null,
    });
    // 4 was never offered; after 2 the player left.
    expect(yard.asked).toEqual([1, 2]);
    expect(summary.helped).toBe(2);
  });
});

describe("helpAllResultText", () => {
  it("says what it came to, and why it stopped", () => {
    expect(
      helpAllResultText({ helped: 3, secondsSaved: 4320, reward: reward(1250), skipped: 0, stoppedBy: null }),
    ).toBe("Helped 3 · saved 1h 12m · earned 1,250 of each resource");
    expect(helpAllResultText({ helped: 2, secondsSaved: 600, reward: reward(0), skipped: 1, stoppedBy: null })).toBe(
      "Helped 2 · saved 10m",
    );
    expect(
      helpAllResultText({ helped: 1, secondsSaved: 60, reward: reward(0), skipped: 0, stoppedBy: "They are under attack." }),
    ).toBe("Helped 1 · saved 1m. They are under attack.");
    // Past a day the total keeps its minutes: 23h 50m + 3h.
    expect(helpAllResultText({ helped: 2, secondsSaved: 96_600, reward: reward(0), skipped: 0, stoppedBy: null })).toBe(
      "Helped 2 · saved 1d 2h 50m",
    );
    expect(helpAllResultText({ helped: 0, secondsSaved: 0, reward: reward(0), skipped: 2, stoppedBy: null })).toBe(
      "There is nothing left to help with here.",
    );
  });
});

describe("helpAllShortText", () => {
  it("fits the one-row visit bar: numbers over words", () => {
    expect(
      helpAllShortText({ helped: 3, secondsSaved: 30_960, reward: reward(172_875), skipped: 0, stoppedBy: null }),
    ).toBe("Helped 3 · -8h 36m · +172.8K each");
    expect(helpAllShortText({ helped: 2, secondsSaved: 600, reward: reward(0), skipped: 1, stoppedBy: null })).toBe(
      "Helped 2 · -10m",
    );
    expect(
      helpAllShortText({
        helped: 1,
        secondsSaved: 60,
        reward: { r1: 1500, r4: 20 },
        skipped: 0,
        stoppedBy: "They are under attack.",
      }),
    ).toBe("Helped 1 · -1m · +1.5K twigs +20 goo");
    // Nothing helped: the reason alone (the notice has the full line too).
    expect(
      helpAllShortText({ helped: 0, secondsSaved: 0, reward: reward(0), skipped: 0, stoppedBy: "They are under attack." }),
    ).toBe("They are under attack.");
    expect(helpAllShortText({ helped: 0, secondsSaved: 0, reward: reward(0), skipped: 2, stoppedBy: null })).toBe(
      "There is nothing left to help with here.",
    );
  });
});
