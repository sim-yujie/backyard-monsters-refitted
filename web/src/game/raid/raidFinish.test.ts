import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { RaidFinishResponse, RaidResult } from "@/api/raid";
import { FINISH_RETRY_MS, finishRaidFight } from "./raidFinish";

/** Landing a raid's fight (issue #226 WP4, `/raid/finish`). */

const RESULT: RaidResult = {
  id: "r1",
  tribe: "Kozu",
  at: 1_000,
  defended: true,
  health: 0.95,
  stolen: { r1: 0, r2: 0, r3: 0, r4: 0 },
  shiny: 10,
  damaged: [],
  housedLost: 0,
};

const refusal = (reason: string, extra: Record<string, number> = {}): ApiError =>
  new ApiError("refused", { status: 409, details: { data: { reason, ...extra } } });

const options = (finish: () => Promise<RaidFinishResponse>, now = 1_000) => {
  const wait = vi.fn(async (_ms: number) => {});
  return { options: { api: { finish: vi.fn(finish) }, id: "r1", serverNow: () => now, wait }, wait };
};

describe("finishRaidFight", () => {
  it("lands the fight", async () => {
    const { options: o } = options(async () => ({ error: 0, result: RESULT }) as RaidFinishResponse);
    await expect(finishRaidFight(o)).resolves.toEqual({ kind: "landed", result: RESULT });
    expect(o.api.finish).toHaveBeenCalledWith("r1");
  });

  it("waits until the server takes it when it is too early, then lands it", async () => {
    let first = true;
    const { options: o, wait } = options(async () => {
      if (first) {
        first = false;
        throw refusal("tooEarly", { readyAt: 1_003 });
      }
      return { error: 0, result: RESULT } as RaidFinishResponse;
    });
    await expect(finishRaidFight(o)).resolves.toMatchObject({ kind: "landed" });
    expect(wait).toHaveBeenCalledWith(3_250);
  });

  it("says a cancelled raid was cancelled, and any other refusal that it is gone", async () => {
    const cancelled = options(async () => {
      throw refusal("cancelled");
    });
    await expect(finishRaidFight(cancelled.options)).resolves.toEqual({ kind: "cancelled" });
    const gone = options(async () => {
      throw refusal("notFighting");
    });
    await expect(finishRaidFight(gone.options)).resolves.toEqual({ kind: "gone" });
  });

  it("tries three times when the server cannot be reached", async () => {
    const { options: o, wait } = options(async () => {
      throw new Error("offline");
    });
    await expect(finishRaidFight(o)).resolves.toEqual({ kind: "failed" });
    expect(o.api.finish).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledWith(FINISH_RETRY_MS);
  });
});
