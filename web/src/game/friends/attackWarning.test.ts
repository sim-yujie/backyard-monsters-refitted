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

describe("attackWithFriendWarning: an alliance mate (beta 7)", () => {
  const GANG = { name: "Goo Gang", image: 12 };
  const mateDeps = (friend: boolean, answer: boolean) => ({
    ...deps(friend, true),
    confirmMate: vi.fn(async () => answer),
  });

  it("asks 'in your alliance, attack anyway?' and attacks on yes", async () => {
    const d = mateDeps(false, true);
    const go = vi.fn();
    await attackWithFriendWarning({ owner: 7, name: "Ana", ally: GANG }, container, go, d);
    expect(d.confirmMate).toHaveBeenCalledWith(container, "Ana", GANG);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("does not attack when the player cancels", async () => {
    const d = mateDeps(false, false);
    const go = vi.fn();
    await attackWithFriendWarning({ owner: 7, name: "Ana", ally: GANG }, container, go, d);
    expect(go).not.toHaveBeenCalled();
  });

  it("asks a mate who is also a friend once, as a mate", async () => {
    const d = mateDeps(true, true);
    const go = vi.fn();
    await attackWithFriendWarning({ owner: 7, name: "Ana", ally: GANG }, container, go, d);
    expect(d.confirmMate).toHaveBeenCalledTimes(1);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("leaves a non-mate to the friend warning", async () => {
    const d = mateDeps(true, true);
    const go = vi.fn();
    await attackWithFriendWarning({ owner: 7, name: "Ann" }, container, go, d);
    expect(d.confirmMate).not.toHaveBeenCalled();
    expect(d.confirm).toHaveBeenCalledWith(container, "Ann");
  });
});
