// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ATTACK_MATE_TEXT, confirmAttackOnMate } from "./AttackMateWarning";

const GANG = { name: "Goo Gang", image: 12 };

const click = (host: HTMLElement, label: string): void => {
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
};

describe("confirmAttackOnMate", () => {
  it("asks Flash's question under the alliance's shield and name, true on Attack anyway", async () => {
    const host = document.createElement("div");
    const answer = confirmAttackOnMate(host, "Ana", GANG);
    expect(host.querySelector(".takeover-dialog__lead")!.textContent).toBe("Ana is in your alliance. Attack anyway?");
    const badge = host.querySelector(".attack-mate-dialog__alliance")!;
    expect(badge.textContent).toBe("Goo Gang");
    expect(badge.querySelector("img")!.getAttribute("src")).toBe("/assets/alliances/12_medium.png");
    click(host, ATTACK_MATE_TEXT.go);
    expect(await answer).toBe(true);
    expect(host.querySelector(".attack-mate-dialog")).toBeNull();
  });

  it("resolves false on Cancel", async () => {
    const host = document.createElement("div");
    const answer = confirmAttackOnMate(host, "Ana", GANG);
    click(host, ATTACK_MATE_TEXT.cancel);
    expect(await answer).toBe(false);
  });
});
