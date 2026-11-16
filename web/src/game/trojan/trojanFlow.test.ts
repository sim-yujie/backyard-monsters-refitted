import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { TROJAN_SPRING_FAILED, TrojanFlow } from "./trojanFlow";

/** Springing the Trojan Horse from its letter (#327 WP4). */
describe("TrojanFlow", () => {
  const flow = (spring: () => Promise<never>) => {
    const notice = vi.fn();
    const fight = vi.fn();
    return { flow: new TrojanFlow({ api: { spring }, fight, notice }), notice, fight };
  };

  it("says the server's reason when the spring is refused", async () => {
    const t = flow(async () => {
      throw new ApiError("You need to be at your yard for this.", {
        status: 409,
        details: { data: { reason: "offline" } },
      });
    });
    await t.flow.spring();
    expect(t.notice).toHaveBeenCalledWith("You need to be at your yard for this.");
    expect(t.fight).not.toHaveBeenCalled();
  });

  it("says the general line when the server cannot be reached", async () => {
    const t = flow(async () => {
      throw new Error("offline");
    });
    await t.flow.spring();
    expect(t.notice).toHaveBeenCalledWith(TROJAN_SPRING_FAILED);
  });
});
