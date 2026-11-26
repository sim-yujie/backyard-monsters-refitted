import { describe, expect, it } from "vitest";
import type { HelpBlock } from "@/api/friends";
import { afterHelp, afterRefusal, helpRefusalText, isHelpOpen, refusalStays, savingTag, type HelpTarget } from "./helpModel";
import { helpAllResultText, helpAllShortText, runHelpAll, stopsHelpAll, type HelpOutcome } from "./helpAll";

/**
 * Help all (beta 8, owner 15 Nov 2026): every speed-up, adding up the
 * server's own numbers; a refusal about one building is passed over, one
 * about the whole visit stops it. Since 26 Nov 2026 the helps go in one
 * request (`POST /bm/friends/help/all`), in turns of the server's most.
 */

const reward = (each: number) => ({ r1: each, r2: each, r3: each, r4: each });

const blockOf = (ids: number[]): HelpBlock => ({
  rewardsLeft: 5,
  buildings: Object.fromEntries(ids.map((id) => [String(id), { speedup: true as const }])),
});

/**
 * A scene and server stand-in: answers each request from a script as the
 * server does (in order, passing over a building refusal, stopping at any
 * other), keeps the block as the scene does, and logs each request.
 */
const scene = (answers: Record<number, HelpOutcome>, ids = [1, 2, 3]) => {
  let block: HelpBlock | null = blockOf(ids);
  const requests: number[][] = [];
  const helpMany = async (sent: readonly HelpTarget[]): Promise<HelpOutcome[]> => {
    requests.push(sent.map((target) => target.id));
    await Promise.resolve();
    const outcomes: HelpOutcome[] = [];
    for (const target of sent) {
      const answer = answers[target.id] ?? { ok: true, secondsSaved: 60, reward: reward(10) };
      if (block) {
        block = answer.ok
          ? afterHelp(block, target.id, target.kind, 4)
          : afterRefusal(block, target.id, target.kind, answer.reason);
      }
      outcomes.push(answer);
      if (!answer.ok && stopsHelpAll(answer.reason)) break;
    }
    return outcomes;
  };
  return {
    helpMany,
    block: () => block,
    requests,
    leave: () => {
      block = null;
    },
  };
};

const targets = (ids: number[]): HelpTarget[] => ids.map((id) => ({ id, kind: "speedup" }));

describe("runHelpAll", () => {
  it("sends every help in one request, counts the bar on per help, and adds up the server's numbers", async () => {
    const yard = scene({ 2: { ok: true, secondsSaved: 1080, reward: reward(0) } });
    const steps: string[] = [];
    const summary = await runHelpAll(targets([1, 2, 3]), {
      block: yard.block,
      helpMany: yard.helpMany,
      onStep: (done, total) => steps.push(`${done}/${total}`),
    });
    expect(yard.requests).toEqual([[1, 2, 3]]);
    expect(steps).toEqual(["1/3", "2/3", "3/3"]);
    expect(summary).toEqual({ helped: 3, secondsSaved: 1200, reward: { r1: 20, r2: 20, r3: 20, r4: 20 }, skipped: 0, stoppedBy: null });
  });

  it("adds the helps up as their tags read, so the total is the tags' sum", async () => {
    // The lead's yard: 2h 38m 59s, 3h 35m 59s and 2h 23m 59s read 2h 38m, 3h 35m and 2h 23m.
    const seconds = [9539, 12_959, 8639];
    const yard = scene(
      Object.fromEntries(seconds.map((secondsSaved, i) => [i + 1, { ok: true as const, secondsSaved, reward: reward(0) }])),
    );
    const summary = await runHelpAll(targets([1, 2, 3]), { block: yard.block, helpMany: yard.helpMany });
    expect(seconds.map(savingTag)).toEqual(["-2h 38m", "-3h 35m", "-2h 23m"]);
    expect(summary.secondsSaved).toBe((2 * 60 + 38 + 3 * 60 + 35 + 2 * 60 + 23) * 60);
    expect(helpAllResultText(summary)).toBe("Helped 3 · saved 8h 36m");
  });

  it("passes over a refusal about one building and goes on", async () => {
    const yard = scene({ 2: { ok: false, reason: "helpersFull", text: "5 friends have already sped up this job." } });
    const summary = await runHelpAll(targets([1, 2, 3]), { block: yard.block, helpMany: yard.helpMany });
    expect(yard.requests).toEqual([[1, 2, 3]]);
    expect(summary.helped).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.stoppedBy).toBeNull();
  });

  it("stops on a refusal about the whole visit, or at the server's stop", async () => {
    // The request refused as a whole: one stopping outcome, on the first.
    const refused = await runHelpAll(targets([1, 2, 3]), {
      block: () => blockOf([1, 2, 3]),
      helpMany: async () => [{ ok: false, reason: "underAttack", text: "They are under attack right now." }],
    });
    expect(refused).toMatchObject({ helped: 0, skipped: 0, stoppedBy: "They are under attack right now." });

    // The answer ends early (the server stopped, or the visit ended): the third was never reached.
    const steps: string[] = [];
    const summary = await runHelpAll(targets([1, 2, 3]), {
      block: () => blockOf([1, 2, 3]),
      helpMany: async () => [
        { ok: true, secondsSaved: 60, reward: reward(10) },
        { ok: false, reason: "network", text: "Could not reach the server. Try again." },
      ],
      onStep: (done, total) => steps.push(`${done}/${total}`),
    });
    expect(summary.helped).toBe(1);
    expect(summary.stoppedBy).toBe("Could not reach the server. Try again.");
    expect(steps).toEqual(["1/3", "2/3"]);
    for (const reason of ["notFriends", "cannotSend", "tooNew", "rateLimited", "network", "unknown", "underAttack"]) {
      expect(stopsHelpAll(reason)).toBe(true);
    }
    // A repair after one landed today is passed over, as the block stopped offering it.
    for (const reason of ["alreadyHelped", "helpersFull", "nothingToHelp", "repairedToday"]) expect(stopsHelpAll(reason)).toBe(false);
  });

  it("the spam limit stops it with the help words, and leaves the buildings open for later (bug report #50)", async () => {
    let block: HelpBlock = blockOf([1, 2, 3]);
    const text = helpRefusalText("rateLimited");
    const summary = await runHelpAll(targets([1, 2, 3]), {
      block: () => block,
      helpMany: async (sent) => {
        // As the scene does it (`giveHelps`): a refusal that does not stay leaves the block alone.
        if (refusalStays("rateLimited")) block = afterRefusal(block, sent[0]!.id, "speedup", "rateLimited");
        return [{ ok: false, reason: "rateLimited", text }];
      },
    });
    expect(text).toBe("You have helped a lot this hour. Try again later.");
    expect(summary.stoppedBy).toBe(text);
    expect(helpAllResultText(summary)).toContain(text);
    expect(helpAllShortText({ ...summary, helped: 0 })).toBe(text);
    expect(isHelpOpen(block, { id: 1, kind: "speedup" })).toBe(true);
  });

  it("sends more than the server takes in turns, and stops before the next turn once the visit is over", async () => {
    const steps: string[] = [];
    const yard = scene({}, [1, 2, 3, 4, 5]);
    const summary = await runHelpAll(targets([1, 2, 3, 4, 5]), {
      block: yard.block,
      helpMany: yard.helpMany,
      perRequest: 2,
      onStep: (done, total) => steps.push(`${done}/${total}`),
    });
    expect(yard.requests).toEqual([[1, 2], [3, 4], [5]]);
    expect(steps).toEqual(["1/5", "2/5", "3/5", "4/5", "5/5"]);
    expect(summary.helped).toBe(5);

    const left = scene({}, [1, 2, 3, 4, 5]);
    const partial = await runHelpAll(targets([1, 2, 3, 4, 5]), {
      block: left.block,
      helpMany: async (sent) => {
        const outcomes = await left.helpMany(sent);
        left.leave();
        return outcomes;
      },
      perRequest: 2,
      goOn: () => left.block() !== null,
    });
    expect(left.requests).toEqual([[1, 2]]);
    expect(partial.helped).toBe(2);
  });

  it("leaves out a help the block no longer offers, and ends where the answers end", async () => {
    const yard = scene({});
    const summary = await runHelpAll(targets([1, 4, 2, 3]), { block: yard.block, helpMany: yard.helpMany });
    // 4 was never offered.
    expect(yard.requests).toEqual([[1, 2, 3]]);
    expect(summary.helped).toBe(3);

    // The visit ended while the answer was on its way: the scene landed none.
    const gone = await runHelpAll(targets([1, 2, 3]), { block: () => blockOf([1, 2, 3]), helpMany: async () => [] });
    expect(gone).toMatchObject({ helped: 0, skipped: 0, stoppedBy: null });
  });

  it("sends at most the server's 10 a request", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const yard = scene({}, ids);
    const summary = await runHelpAll(targets(ids), { block: yard.block, helpMany: yard.helpMany });
    expect(yard.requests.map((sent) => sent.length)).toEqual([10, 2]);
    expect(summary.helped).toBe(12);
  });

  it("asks nothing when nothing is open", async () => {
    let asked = 0;
    const summary = await runHelpAll(targets([1, 2]), {
      block: () => blockOf([]),
      helpMany: async () => {
        asked += 1;
        return [];
      },
    });
    expect(asked).toBe(0);
    expect(summary.helped).toBe(0);
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
