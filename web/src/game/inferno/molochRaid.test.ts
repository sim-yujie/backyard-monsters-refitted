import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { RaidStartResponse } from "@/api/raid";
import { MOLOCH_RAID_GONE, MOLOCH_RAID_RETRY, MOLOCH_RAID_WAIT } from "./emergenceText";
import { isMolochRaid, startMolochRaid } from "./molochRaid";

/** "Engage Attack" on Moloch's warning (Inferno WP 1.9). */

const refusal = (reason: string): ApiError => new ApiError("refused", { status: 409, details: { data: { reason } } });

const run = (start: () => Promise<RaidStartResponse>) => {
  const deps = { api: { start: vi.fn(start) }, fight: vi.fn(), notice: vi.fn() };
  return { deps, done: startMolochRaid("m1", deps) };
};

describe("isMolochRaid", () => {
  it("knows Moloch's raids by their tribe", () => {
    expect(isMolochRaid({ tribe: "moloch" })).toBe(true);
    expect(isMolochRaid({ tribe: "Kozu" })).toBe(false);
    expect(isMolochRaid(null)).toBe(false);
  });
});

describe("startMolochRaid", () => {
  it("hands the server's fight on, and the warning is done with", async () => {
    const answer = { error: 0 } as unknown as RaidStartResponse;
    const { deps, done } = run(async () => answer);
    expect(await done).toBe(true);
    expect(deps.api.start).toHaveBeenCalledWith("m1");
    expect(deps.fight).toHaveBeenCalledWith(answer);
    expect(deps.notice).not.toHaveBeenCalled();
  });

  it("closes the warning with a line when the raid is gone", async () => {
    for (const reason of ["noRaid", "notWarning", "notMainYard"]) {
      const { deps, done } = run(async () => Promise.reject(refusal(reason)));
      expect(await done).toBe(true);
      expect(deps.notice).toHaveBeenCalledWith(MOLOCH_RAID_GONE);
      expect(deps.fight).not.toHaveBeenCalled();
    }
  });

  it("keeps the warning up to press again while another attack is on, or the server is out of reach", async () => {
    const busy = run(async () => Promise.reject(refusal("underAttack")));
    expect(await busy.done).toBe(false);
    expect(busy.deps.notice).toHaveBeenCalledWith(MOLOCH_RAID_WAIT);

    const offline = run(async () => Promise.reject(new Error("offline")));
    expect(await offline.done).toBe(false);
    expect(offline.deps.notice).toHaveBeenCalledWith(MOLOCH_RAID_RETRY);
  });
});
