import { describe, expect, it, vi } from "vitest";
import { leaveWorldStep, leaveWorldWithWarning, type WorldLeaver } from "./leaveWorld";

const container = {} as HTMLElement;
const member: WorldLeaver = { name: "Golden Acorns", image: 9, role: "member", number_of_members: 5 };
const deps = (answer: boolean) => ({
  confirm: vi.fn(async () => answer),
  handOverFirst: vi.fn(async () => {}),
});

describe("leaveWorldStep", () => {
  it("follows the server's rule", () => {
    expect(leaveWorldStep(null)).toBe("go");
    expect(leaveWorldStep(member)).toBe("confirm");
    expect(leaveWorldStep({ ...member, role: "officer" })).toBe("confirm");
    expect(leaveWorldStep({ ...member, role: "leader", number_of_members: 1 })).toBe("confirmLast");
    expect(leaveWorldStep({ ...member, role: "leader", number_of_members: 2 })).toBe("handOver");
  });
});

describe("leaveWorldWithWarning", () => {
  it("moves at once a player in no alliance", async () => {
    const d = deps(false);
    const go = vi.fn();
    expect(await leaveWorldWithWarning(null, container, go, d)).toBe(true);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("asks a member first, and moves on Leave", async () => {
    const d = deps(true);
    const go = vi.fn();
    expect(await leaveWorldWithWarning(member, container, go, d)).toBe(true);
    expect(d.confirm).toHaveBeenCalledWith(container, member, false);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("does not move a member who cancels", async () => {
    const d = deps(false);
    const go = vi.fn();
    expect(await leaveWorldWithWarning(member, container, go, d)).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });

  it("asks a leader alone with the alliance-closes words", async () => {
    const d = deps(true);
    const leader = { ...member, role: "leader" as const, number_of_members: 1 };
    await leaveWorldWithWarning(leader, container, vi.fn(), d);
    expect(d.confirm).toHaveBeenCalledWith(container, leader, true);
  });

  it("stops a leader with members and tells them to hand over first", async () => {
    const d = deps(true);
    const go = vi.fn();
    const leader = { ...member, role: "leader" as const };
    expect(await leaveWorldWithWarning(leader, container, go, d)).toBe(false);
    expect(d.handOverFirst).toHaveBeenCalledWith(container, leader);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });
});
