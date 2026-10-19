import { describe, expect, it, vi } from "vitest";
import { attackWithFriendWarning } from "./attackWarning";

const container = {} as HTMLElement;
const deps = (friend: boolean, answer: boolean) => ({
  isFriend: vi.fn(() => friend),
  confirm: vi.fn(async () => answer),
});

describe("attackWithFriendWarning", () => {
  it("asks first when the target is a friend, and attacks on Attack anyway", async () => {
    const d = deps(true, true);
    const go = vi.fn();
    await attackWithFriendWarning({ owner: 7, name: "Ann" }, container, go, d);
    expect(d.isFriend).toHaveBeenCalledWith(7);
    expect(d.confirm).toHaveBeenCalledWith(container, "Ann");
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("does not attack when the player cancels", async () => {
    const d = deps(true, false);
    const go = vi.fn();
    await attackWithFriendWarning({ owner: 7, name: "Ann" }, container, go, d);
    expect(d.confirm).toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it("attacks a non-friend straight away with no warning", async () => {
    const d = deps(false, false);
    const go = vi.fn();
    await attackWithFriendWarning({ owner: 8, name: "Bob" }, container, go, d);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("attacks a wild camp (no owner) with no warning", async () => {
    const d = deps(true, false);
    const go = vi.fn();
    await attackWithFriendWarning({ name: "Camp" }, container, go, d);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(1);
  });
});
