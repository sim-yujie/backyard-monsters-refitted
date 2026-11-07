import { describe, expect, it } from "vitest";
import {
  artSummary,
  browserOf,
  buildSummary,
  compactRecord,
  fileOf,
  pathOf,
  resourceKind,
  shaderName,
  summaryLine,
  summaryRows,
  type OpenState,
  type ResourceSample,
} from "./openTimingSummary";

const resource = (name: string, over: Partial<ResourceSample> = {}): ResourceSample => ({
  name,
  start: 100,
  responseEnd: 400,
  transferSize: 1000,
  decodedBodySize: 1000,
  ...over,
});

const state = (over: Partial<OpenState> = {}): OpenState => ({
  index: 1,
  startedAt: 5000,
  steps: { open: 0, "own-cell": 900.4, "area-first-answer": 1200, "view-zones": 2100, painted: 6300, "full-look": 14200 },
  spans: [
    { name: "account-hexshape", start: 1, end: 151, ok: true },
    { name: "own-yard", start: 160, end: null, ok: false },
  ],
  area: { calls: 4, answered: 3, failed: 1, totalMs: 600, maxMs: 300.6 },
  art: [{ url: "/maproom/painted/ground@4x.webp", start: 2000, end: 2900, ok: true }],
  cuts: [{ name: "ground", ms: 120.4 }],
  shaders: [{ name: "ground-low", requested: 2000, start: 2500, end: 6000, ok: true }],
  info: { quality: "high", browser: "Chrome 131", gpu: "ANGLE (NVIDIA)", painted: true },
  resources: [
    resource("https://bymr.example/maproom/painted/ground@4x.webp?v=3", { start: 2010, responseEnd: 2700, transferSize: 760_000 }),
    resource("https://bymr.example/api/v2/worldmapv2/getarea", { transferSize: 3000 }),
    resource("https://bymr.example/api/v2/worldmapv2/getarea", { transferSize: 2000 }),
    resource("https://bymr.example/assets/paintedLook-abc.js", { transferSize: 50_000 }),
    resource("https://bymr.example/api/v2/account", { transferSize: 400 }),
  ],
  ...over,
});

describe("open timing summary helpers", () => {
  it("reduces URLs to their paths and file names", () => {
    expect(pathOf("https://a.b/maproom/painted/ground@4x.webp?v=1#x")).toBe("maproom/painted/ground@4x.webp");
    expect(pathOf("/maproom/x.png")).toBe("maproom/x.png");
    expect(pathOf("./maproom/x.png")).toBe("maproom/x.png");
    expect(fileOf("/maproom/painted/decals@2x.webp")).toBe("decals@2x.webp");
  });

  it("sorts downloads into getarea, art, code and other", () => {
    expect(resourceKind("https://a/api/v2/worldmapv2/getarea")).toBe("area");
    expect(resourceKind("https://a/maproom/g.webp?v=2")).toBe("art");
    expect(resourceKind("https://a/assets/x.js")).toBe("code");
    expect(resourceKind("https://a/api/v2/account")).toBe("other");
  });

  it("names shader programs from Pixi's SHADER_NAME", () => {
    expect(shaderName({ fragment: "#version 300 es\n#define SHADER_NAME mr2-painted-ground-low-fragment\n" })).toBe("ground-low");
    expect(shaderName({ fragment: "#define SHADER_NAME mr2-painted-borders-fragment-2\n" })).toBe("borders");
    expect(shaderName({ fragment: "#define SHADER_NAME mr2-place-wide-fragment\n" })).toBe("place-wide");
    expect(shaderName({ fragment: "void main(){}" })).toBe("program");
  });

  it("reads the browser and its version", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    expect(browserOf(chrome)).toBe("Chrome 131");
    expect(browserOf(`${chrome} Edg/131.0.2903.70`)).toBe("Edge 131");
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox 132");
    expect(
      browserOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15"),
    ).toBe("Safari 18");
    expect(browserOf("curl/8")).toBe("other");
  });
});

describe("art files", () => {
  const entry = { url: "/maproom/painted/ground@4x.webp", start: 2000, end: 2900, ok: true };

  it("splits download from decode and says it came over the network", () => {
    const art = artSummary(entry, [resource("https://x/maproom/painted/ground@4x.webp", { start: 2010, responseEnd: 2700, transferSize: 5 })]);
    expect(art).toEqual({ file: "ground@4x.webp", ms: 900, downloadMs: 690, decodeMs: 200, from: "network", bytes: 5 });
  });

  it("says disk when the browser's cache answered (nothing transferred)", () => {
    const art = artSummary(entry, [resource("https://x/maproom/painted/ground@4x.webp", { transferSize: 0, decodedBodySize: 700 })]);
    expect(art.from).toBe("disk");
  });

  it("says memory when there was no download at all (already loaded in this page)", () => {
    expect(artSummary(entry, []).from).toBe("memory");
    expect(artSummary({ ...entry, end: null }, []).from).toBe("unknown");
  });
});

describe("buildSummary", () => {
  it("rounds the times, averages getarea and splits the bytes", () => {
    const summary = buildSummary(state(), "done", 14200.4);
    expect(summary.type).toBe("first");
    expect(summary.totalMs).toBe(14200);
    expect(summary.steps["own-cell"]).toBe(900);
    expect(summary.spans).toEqual([
      { name: "account-hexshape", startMs: 1, ms: 150, ok: true },
      { name: "own-yard", startMs: 160, ms: null, ok: false },
    ]);
    expect(summary.area).toEqual({ calls: 4, answered: 3, failed: 1, avgMs: 200, maxMs: 301, bytes: 5000 });
    expect(summary.bytes).toEqual({ total: 815_400, area: 5000, art: 760_000, code: 50_000, other: 400 });
    expect(summary.artCached).toBe("no");
    expect(summary.shaders).toEqual([{ name: "ground-low", waitMs: 500, ms: 3500, ok: true }]);
  });

  it("calls a later open later and has no averages without answers", () => {
    const summary = buildSummary(state({ index: 2, area: { calls: 0, answered: 0, failed: 0, totalMs: 0, maxMs: 0 }, art: [] }), "left", 10);
    expect(summary.type).toBe("later");
    expect(summary.area.avgMs).toBeNull();
    expect(summary.artCached).toBeNull();
  });

  it("prints one line with the main steps", () => {
    const line = summaryLine(buildSummary(state(), "done", 14200));
    expect(line).toContain("[MR2 timing] open 1 (first, done) 14.2 s");
    expect(line).toContain("zones in view 2.1 s");
    expect(line).toContain("full look 14.2 s");
    expect(line).toContain("getarea 4 calls, avg 200 ms, max 301 ms");
    expect(line).toContain("Chrome 131");
  });

  it("lists table rows in time order, untimed rows last", () => {
    const rows = summaryRows(buildSummary(state(), "done", 14200));
    const ats = rows.map((row) => row.at).filter((at): at is number => at !== null);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(rows[rows.length - 1]!.at).toBeNull();
    expect(rows.find((row) => row.what === "own-yard")!.note).toBe("not finished");
    expect(rows.find((row) => row.what === "art ground@4x.webp")!.note).toContain("network");
  });
});

describe("compactRecord", () => {
  it("keeps whole numbers and short keys", () => {
    const record = compactRecord(buildSummary(state(), "done", 14200));
    expect(record.v).toBe(1);
    expect(record.open).toBe("first");
    expect(record.t["view-zones"]).toBe(2100);
    expect(record.spans).toEqual({ "account-hexshape": 150 });
    expect(record.area).toEqual({ n: 4, ok: 3, fail: 1, avg: 200, max: 301 });
    expect(record.art).toEqual({ "ground@4x.webp": 900 });
    expect(record.cut).toBe(120);
    expect(record.shaders).toEqual({ "ground-low": 3500 });
    expect(record.kb).toEqual({ total: 796, area: 5, art: 742, code: 49 });
  });

  it("cuts long text, such as a GPU name", () => {
    const long = "x".repeat(500);
    const record = compactRecord(buildSummary(state({ info: { gpu: long } }), "done", 1));
    expect(String(record.info["gpu"]).length).toBe(120);
  });
});
