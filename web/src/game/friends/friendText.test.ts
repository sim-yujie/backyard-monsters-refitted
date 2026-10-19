import { describe, expect, it } from "vitest";
import { friendCountText, friendLineText, friendNoticeText, levelLabel, onlineText, waitingText } from "./friendText";

/** How the friends screens and the bell word things (issue #370). */

describe("friend words", () => {
  it("says how recently a friend was about, and nothing when hidden", () => {
    expect(onlineText("online")).toBe("Online");
    expect(onlineText("today")).toBe("Seen today");
    expect(onlineText("week")).toBe("Seen this week");
    expect(onlineText("away")).toBe("Away");
    expect(onlineText(null)).toBe("");
  });

  it("counts friends, levels and what waits", () => {
    expect(friendCountText(12, 100)).toBe("12 of 100 friends");
    expect(levelLabel(7)).toBe("Level 7");
    expect(levelLabel(0)).toBe("");
    expect(waitingText(3)).toBe("3 waiting");
  });
});

describe("friend notification lines", () => {
  it("words each event", () => {
    expect(friendNoticeText({ event: "request", userid: 7, username: "Bob" })).toBe("Bob wants to be your friend.");
    expect(friendNoticeText({ event: "accepted", userid: 7, username: "Bob" })).toBe("Bob is now your friend.");
    expect(friendNoticeText({ event: "gift", userid: 7, username: "Bob" })).toBe("Bob sent you a gift.");
    expect(friendNoticeText({ event: "helpSpeedup", username: "Bob", seconds: 390, building: "Storage Silo" })).toBe(
      "Bob took 6m 30s off your Storage Silo.",
    );
    expect(friendNoticeText({ event: "helpRepair", username: "Bob", building: "Cannon Tower" })).toBe(
      "Bob repaired your Cannon Tower.",
    );
  });

  it("names a building from its type number, and copes without one", () => {
    expect(friendNoticeText({ event: "helpRepair", username: "Bob", building: { type: 1 } })).toMatch(/^Bob repaired your \S/);
    expect(friendNoticeText({ event: "helpRepair", username: "Bob" })).toBe("Bob repaired a building in your yard.");
    expect(friendNoticeText({ event: "helpSpeedup", username: "Bob" })).toBe("Bob sped up a job in your yard.");
  });

  it("has a general line for an event it does not know, and for no name", () => {
    expect(friendNoticeText({ event: "taunt", username: "Bob" })).toBe("News from Bob.");
    expect(friendNoticeText({ event: "request" })).toBe("Someone wants to be your friend.");
    expect(friendNoticeText({ event: "taunt" })).toBe("News from your friends.");
    expect(friendLineText([])).toBe("News from your friends.");
    expect(friendLineText([{ event: "accepted", username: "Cat" }])).toBe("Cat is now your friend.");
  });
});
