import { describe, expect, test } from "bun:test";

import { browserSummary, isBugReportFilter, MAX_OWNER_NOTES, parseTicketUpdate } from "./bugReportsAdmin.js";

describe("bug report tickets (bugReportsAdmin.ts)", () => {
  test("a ticket change takes a known status, notes, or both", () => {
    expect(parseTicketUpdate({ status: "working" })).toEqual({ ok: true, value: { status: "working" } });
    expect(parseTicketUpdate({ notes: "" })).toEqual({ ok: true, value: { notes: "" } });
    expect(parseTicketUpdate({ status: "fixed", notes: "in beta.5", other: 1 })).toEqual({
      ok: true,
      value: { status: "fixed", notes: "in beta.5" },
    });
  });

  test("anything else is refused with a reason", () => {
    for (const body of [{}, null, "status=fixed", { status: "done" }, { status: 1 }, { notes: 5 }]) {
      const result = parseTicketUpdate(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    }
  });

  test("the list filters are all, open, closed or one status", () => {
    for (const filter of ["all", "open", "closed", "new", "working", "fixed", "wontfix"]) expect(isBugReportFilter(filter)).toBe(true);
    for (const filter of ["filed", "", undefined, 3]) expect(isBugReportFilter(filter)).toBe(false);
    expect(MAX_OWNER_NOTES).toBeGreaterThan(100);
  });
});

describe("browserSummary", () => {
  test("names the browser and system, most specific first", () => {
    const chromeAndroid =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
    const safari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
    expect(browserSummary(chromeAndroid)).toBe("Chrome 130 on Android");
    expect(browserSummary(edge)).toBe("Edge 130 on Windows");
    expect(browserSummary(safari)).toBe("Safari 18 on iOS");
    expect(browserSummary(firefox)).toBe("Firefox 131 on Linux");
    expect(browserSummary("")).toBe("unknown browser");
  });
});
