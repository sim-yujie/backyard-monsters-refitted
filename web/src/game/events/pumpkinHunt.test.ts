import { describe, expect, it, vi } from "vitest";
import type { EventView } from "@/api/events";
import { notePumpkins, onPumpkins, withPumpkinCount } from "./pumpkinHunt";

const hunt = (status: EventView["status"], counter: number): EventView =>
  ({
    id: "halloween-2026",
    kind: "halloween",
    status,
    ladder: { label: "Pumpkins found", counter, tiers: [{ need: 10, rewards: [], claimed: false }] },
  }) as unknown as EventView;

/** The pumpkin hunt's count between reads: picks pass it on, the Events page moves at once. */
describe("pumpkin hunt count", () => {
  it("raises the active hunt's ladder counter, never lowers it, and leaves other events alone", () => {
    const other = { ...hunt("active", 3), id: "other", kind: "other" } as EventView;
    const [raised, untouched] = withPumpkinCount([hunt("active", 4), other], 10);
    expect(raised?.ladder?.counter).toBe(10);
    expect(untouched).toBe(other);
    expect(withPumpkinCount([hunt("active", 12)], 10)[0]?.ladder?.counter).toBe(12);
    expect(withPumpkinCount([hunt("upcoming", 0)], 10)[0]?.ladder?.counter).toBe(0);
  });

  it("tells every listener the new count until it stops listening", () => {
    const heard = vi.fn();
    const stop = onPumpkins(heard);
    notePumpkins(7);
    stop();
    notePumpkins(8);
    expect(heard.mock.calls).toEqual([[7]]);
  });
});
