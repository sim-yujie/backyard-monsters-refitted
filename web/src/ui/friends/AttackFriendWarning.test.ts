// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ATTACK_FRIEND_TEXT, confirmAttackOnFriend } from "./AttackFriendWarning";

const click = (host: HTMLElement, label: string): void => {
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
};

describe("confirmAttackOnFriend", () => {
  it("names the friend and resolves true on Attack anyway", async () => {
    const host = document.createElement("div");
    const answer = confirmAttackOnFriend(host, "Ann");
    expect(host.textContent).toContain(ATTACK_FRIEND_TEXT.lead("Ann"));
    click(host, ATTACK_FRIEND_TEXT.go);
    expect(await answer).toBe(true);
    expect(host.querySelector(".attack-friend-dialog")).toBeNull();
  });

  it("resolves false on Cancel", async () => {
    const host = document.createElement("div");
    const answer = confirmAttackOnFriend(host, "Ann");
    click(host, ATTACK_FRIEND_TEXT.cancel);
    expect(await answer).toBe(false);
  });
});
