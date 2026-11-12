import { describe, expect, it } from "vitest";
import { PAGES, ScrollMemory, VIEWS, pageHome, pageOf, pageViews, readRoute, viewHash } from "./views";

describe("the address", () => {
  it("names a view, with what it should show", () => {
    expect(readRoute("", "#chat")).toEqual({ view: "chat", params: {}, bug: null });
    expect(readRoute("", "#bugs?list=working")).toEqual({ view: "bugs", params: { list: "working" }, bug: null });
    expect(readRoute("", "#find?player=12&x=")).toEqual({ view: "find", params: { player: "12", x: "" }, bug: null });
  });

  it("opens Home for an empty or unknown address", () => {
    expect(readRoute("", "")).toEqual({ view: "home", params: {}, bug: null });
    expect(readRoute("", "#nothing")).toEqual({ view: "home", params: {}, bug: null });
    expect(readRoute("?bug=x", "#nothing")).toEqual({ view: "home", params: {}, bug: null });
  });

  it("still opens a Telegram alert's bug report link", () => {
    expect(readRoute("?bug=41", "#bugs")).toEqual({ view: "bugs", params: {}, bug: 41 });
    expect(readRoute("?bug=41", "")).toEqual({ view: "bugs", params: {}, bug: 41 });
    expect(readRoute("", "#bugs?bug=7&list=new")).toEqual({ view: "bugs", params: { list: "new" }, bug: 7 });
    expect(readRoute("?bug=-3", "#health")).toEqual({ view: "health", params: {}, bug: null });
    // A bug number with another view leaves the bug alone.
    expect(readRoute("?bug=41", "#chat")).toEqual({ view: "chat", params: {}, bug: null });
  });

  it("is written back the same way it is read", () => {
    expect(viewHash("chat")).toBe("#chat");
    expect(viewHash("bugs", { list: "working", empty: "", none: null })).toBe("#bugs?list=working");
    const hash = viewHash("moderation", { player: 12, filter: "filter" });
    expect(readRoute("", hash)).toEqual({ view: "moderation", params: { player: "12", filter: "filter" }, bug: null });
  });

  it("sends older links and page names to their view", () => {
    expect(readRoute("", "#inbox?player=3").view).toBe("moderation");
    expect(readRoute("", "#cases").view).toBe("moderation");
    expect(readRoute("", "#support").view).toBe("bugs");
    expect(readRoute("", "#server").view).toBe("health");
    // Server health is one page: its old Errors and Backups tabs land on it.
    expect(readRoute("", "#errors").view).toBe("health");
    expect(readRoute("", "#backups").view).toBe("health");
  });
});

describe("the menu", () => {
  it("has the six pages of the mock-up, Home first", () => {
    expect(PAGES.map(([, label]) => label)).toEqual([
      "Home",
      "Moderation",
      "Player support",
      "Announcements",
      "Game activity",
      "Server health",
    ]);
  });

  it("puts every view on one page, and opens a page at its first view", () => {
    expect(PAGES.flatMap(([id]) => pageViews(id))).toEqual(VIEWS.map(([id]) => id));
    expect(pageHome("moderation")).toBe("moderation");
    expect(pageViews("moderation")).toEqual(["moderation", "photos", "find", "attacks", "flagged", "moderators", "modmail"]);
    expect(pageViews("support")).toEqual(["bugs", "shiny", "chat"]);
    expect(pageViews("announcements")).toEqual(["announcements", "events"]);
    expect(pageViews("server")).toEqual(["health"]);
    expect(pageOf("health")).toBe("server");
  });

  it("puts beta 7's Photo reports under Moderation and Weekend events under Announcements", () => {
    expect(pageOf("photos")).toBe("moderation");
    expect(pageOf("events")).toBe("announcements");
    expect(readRoute("", "#photos").view).toBe("photos");
    expect(readRoute("", "#events").view).toBe("events");
    // The Weekend events view's address before it became a tab.
    expect(readRoute("", "#weekend").view).toBe("events");
  });
});

describe("coming back to a view", () => {
  it("puts it back where it was scrolled to, or at the top the first time", () => {
    const memory = new ScrollMemory();
    expect(memory.restore("bugs")).toBe(0);
    memory.save("bugs", 812.4);
    memory.save("chat", -5);
    expect(memory.restore("bugs")).toBe(812);
    expect(memory.restore("chat")).toBe(0);
  });
});
