// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LEAVE_WORLD_TEXT, confirmLeaveWorld, showHandOverFirst } from "./LeaveWorldWarning";

const ACORNS = { name: "Golden Acorns", image: 9 };

const click = (host: HTMLElement, label: string): void => {
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
};

describe("confirmLeaveWorld", () => {
  it("says the player leaves the alliance and the points stay, under its shield; true on Leave", async () => {
    const host = document.createElement("div");
    const answer = confirmLeaveWorld(host, ACORNS);
    expect(host.querySelector(".takeover-dialog__lead")!.textContent).toBe(
      "You will leave Golden Acorns. Your points stay with the alliance.",
    );
    expect(host.querySelector(".attack-mate-dialog__alliance img")!.getAttribute("src")).toBe(
      "/assets/alliances/9_medium.png",
    );
    click(host, LEAVE_WORLD_TEXT.go);
    expect(await answer).toBe(true);
    expect(host.querySelector(".leave-world-dialog")).toBeNull();
  });

  it("tells a leader alone the alliance closes", async () => {
    const host = document.createElement("div");
    const answer = confirmLeaveWorld(host, ACORNS, true);
    expect(host.querySelector(".takeover-dialog__lead")!.textContent).toBe(LEAVE_WORLD_TEXT.lastLead("Golden Acorns"));
    click(host, LEAVE_WORLD_TEXT.cancel);
    expect(await answer).toBe(false);
  });
});

describe("showHandOverFirst", () => {
  it("tells a leader to hand over first, and resolves on OK", async () => {
    const host = document.createElement("div");
    const closed = showHandOverFirst(host, ACORNS);
    expect(host.textContent).toContain(LEAVE_WORLD_TEXT.handOverLead("Golden Acorns"));
    click(host, LEAVE_WORLD_TEXT.ok);
    await closed;
    expect(host.querySelector(".leave-world-dialog")).toBeNull();
  });
});
