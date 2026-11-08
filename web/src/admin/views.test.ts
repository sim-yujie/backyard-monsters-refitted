import { describe, expect, it } from "vitest";
import { PHONE_TABS, ScrollMemory, VIEWS, phoneTab, readRoute, viewGroups, viewHash } from "./views";

describe("the address", () => {
  it("names a view, with what it should show", () => {
    expect(readRoute("", "#errors")).toEqual({ view: "errors", params: {}, bug: null });
    expect(readRoute("", "#bugs?list=working")).toEqual({ view: "bugs", params: { list: "working" }, bug: null });
    expect(readRoute("", "#cases?player=12&x=")).toEqual({ view: "cases", params: { player: "12", x: "" }, bug: null });
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
    expect(readRoute("?bug=41", "#errors")).toEqual({ view: "errors", params: {}, bug: null });
  });

  it("is written back the same way it is read", () => {
    expect(viewHash("errors")).toBe("#errors");
    expect(viewHash("bugs", { list: "working", empty: "", none: null })).toBe("#bugs?list=working");
    const hash = viewHash("inbox", { player: 12, source: "filter" });
    expect(readRoute("", hash)).toEqual({ view: "inbox", params: { player: "12", source: "filter" }, bug: null });
  });
});

describe("the nav", () => {
  it("lists every view once, in groups, Home first", () => {
    const groups = viewGroups();
    expect(groups[0]).toEqual({ title: "", views: ["home"] });
    expect(groups.map((g) => g.title)).toEqual(["", "Moderation", "Players", "Monitoring"]);
    expect(groups.flatMap((g) => g.views)).toEqual(VIEWS.map(([id]) => id));
  });

  it("marks a phone tab, or More for a view under it", () => {
    for (const tab of PHONE_TABS) expect(phoneTab(tab)).toBe(tab);
    expect(phoneTab("errors")).toBe("more");
    expect(phoneTab("announcements")).toBe("more");
    expect(PHONE_TABS).toEqual(["home", "inbox", "bugs"]);
    expect(phoneTab("cases")).toBe("more");
  });
});

describe("coming back to a view", () => {
  it("puts it back where it was scrolled to, or at the top the first time", () => {
    const memory = new ScrollMemory();
    expect(memory.restore("bugs")).toBe(0);
    memory.save("bugs", 812.4);
    memory.save("errors", -5);
    expect(memory.restore("bugs")).toBe(812);
    expect(memory.restore("errors")).toBe(0);
  });
});
