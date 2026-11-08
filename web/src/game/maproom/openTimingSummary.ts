/**
 * The summary of one Map Room 2 open (`openMarks.ts` collects the times; the owner's "make MR2 open
 * faster, measure first", 7 Nov 2026). Pure: everything here works on plain numbers, so it is tested
 * without a browser. All times are milliseconds since the open began (the scene's `enter`).
 */

/** A step that took time: an `/account` call, the atlas bake, the own yard, the sight request... */
export interface SpanEntry {
  readonly name: string;
  readonly start: number;
  end: number | null;
  ok: boolean;
}

/** One painted art file: `Assets.load` (download and decode) and the canvases cut from it. */
export interface ArtEntry {
  readonly url: string;
  readonly start: number;
  end: number | null;
  ok: boolean;
}

/** One shader program: asked for, compile started (later where they compile one at a time), done. */
export interface ShaderEntry {
  readonly name: string;
  readonly requested: number;
  readonly start: number;
  readonly end: number;
  readonly ok: boolean;
}

/** A Resource Timing entry seen during the open, times already relative to the open. */
export interface ResourceSample {
  readonly name: string;
  readonly start: number;
  readonly responseEnd: number;
  readonly transferSize: number;
  readonly decodedBodySize: number;
}

export type InfoValue = string | number | boolean | null;

/** Everything collected for one open. */
export interface OpenState {
  /** 1 for the first open in this page, then 2, 3... */
  readonly index: number;
  /** `performance.now()` when the open began. */
  readonly startedAt: number;
  /** Steps (marks without the `mr2-` prefix), the first time each happened. */
  readonly steps: Record<string, number>;
  readonly spans: SpanEntry[];
  readonly area: { calls: number; answered: number; failed: number; totalMs: number; maxMs: number };
  readonly art: ArtEntry[];
  /** Main-thread canvas cutting after an art file arrived, by name. */
  readonly cuts: { name: string; ms: number }[];
  readonly shaders: ShaderEntry[];
  readonly info: Record<string, InfoValue>;
  readonly resources: ResourceSample[];
}

export type OpenType = "first" | "later";
/** done: everything wanted arrived; timeout: not within the limit; left: the player left first. */
export type FinishReason = "done" | "timeout" | "left";

export interface ArtSummary {
  readonly file: string;
  readonly ms: number | null;
  readonly downloadMs: number | null;
  readonly decodeMs: number | null;
  /** network: downloaded; disk: the browser's cache; memory: already loaded earlier in this page. */
  readonly from: "network" | "disk" | "memory" | "unknown";
  readonly bytes: number;
}

export interface OpenSummary {
  readonly open: number;
  readonly type: OpenType;
  readonly reason: FinishReason;
  /** When the last wanted step arrived (`done`), else when the summary was made. */
  readonly totalMs: number;
  readonly steps: Record<string, number>;
  readonly spans: { name: string; startMs: number; ms: number | null; ok: boolean }[];
  readonly area: { calls: number; answered: number; failed: number; avgMs: number | null; maxMs: number | null; bytes: number };
  readonly art: ArtSummary[];
  readonly cuts: { name: string; ms: number }[];
  readonly shaders: { name: string; waitMs: number; ms: number; ok: boolean }[];
  readonly bytes: { total: number; area: number; art: number; code: number; other: number };
  /** Whether the painted art came from a cache: yes, no, mixed, or null when there was none. */
  readonly artCached: "yes" | "no" | "mixed" | null;
  readonly info: Record<string, InfoValue>;
}

const round = (ms: number): number => Math.round(ms);

/** The path of a URL without its site, query or leading slashes, for matching a load to its entry. */
export const pathOf = (url: string): string =>
  url
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^(\.?\/)+/, "");

/** The file name of a URL (`ground@4x.webp`). */
export const fileOf = (url: string): string => {
  const path = pathOf(url);
  return path.slice(path.lastIndexOf("/") + 1);
};

const ART_FILE = /\.(png|webp|jpe?g|avif|gif|ktx2|basis)$/i;
const CODE_FILE = /\.(m?js|css|wasm)$/i;

export const resourceKind = (name: string): "area" | "art" | "code" | "other" => {
  if (name.includes("/worldmapv2/getarea")) return "area";
  const path = pathOf(name);
  if (ART_FILE.test(path)) return "art";
  if (CODE_FILE.test(path)) return "code";
  return "other";
};

const findResource = (url: string, resources: readonly ResourceSample[]): ResourceSample | undefined => {
  const path = pathOf(url);
  // The latest one: a file asked for again (another Quality) is a new entry.
  for (let index = resources.length - 1; index >= 0; index--) {
    const other = pathOf(resources[index]!.name);
    if (other === path || other.endsWith(`/${path}`) || path.endsWith(`/${other}`)) return resources[index];
  }
  return undefined;
};

/** One art file's times and where it came from. */
export const artSummary = (entry: ArtEntry, resources: readonly ResourceSample[]): ArtSummary => {
  const ms = entry.end === null ? null : round(entry.end - entry.start);
  const resource = findResource(entry.url, resources);
  if (!resource) {
    // No network entry at all: Pixi already had it from an earlier open in this page.
    return { file: fileOf(entry.url), ms, downloadMs: null, decodeMs: null, from: entry.end === null ? "unknown" : "memory", bytes: 0 };
  }
  const from = resource.transferSize > 0 ? "network" : resource.decodedBodySize > 0 ? "disk" : "unknown";
  return {
    file: fileOf(entry.url),
    ms,
    downloadMs: round(resource.responseEnd - resource.start),
    decodeMs: entry.end === null ? null : Math.max(0, round(entry.end - resource.responseEnd)),
    from,
    bytes: resource.transferSize,
  };
};

const artCachedOf = (art: readonly ArtSummary[]): OpenSummary["artCached"] => {
  const known = art.filter((entry) => entry.from !== "unknown");
  if (known.length === 0) return null;
  const cached = known.filter((entry) => entry.from !== "network").length;
  if (cached === known.length) return "yes";
  return cached === 0 ? "no" : "mixed";
};

/** Builds the summary of an open. `now` is milliseconds since the open began. */
export const buildSummary = (state: OpenState, reason: FinishReason, totalMs: number): OpenSummary => {
  const bytes = { total: 0, area: 0, art: 0, code: 0, other: 0 };
  for (const resource of state.resources) {
    bytes.total += resource.transferSize;
    bytes[resourceKind(resource.name)] += resource.transferSize;
  }
  const art = state.art.map((entry) => artSummary(entry, state.resources));
  const { area } = state;
  return {
    open: state.index,
    type: state.index === 1 ? "first" : "later",
    reason,
    totalMs: round(totalMs),
    steps: Object.fromEntries(Object.entries(state.steps).map(([name, at]) => [name, round(at)])),
    spans: state.spans.map((span) => ({
      name: span.name,
      startMs: round(span.start),
      ms: span.end === null ? null : round(span.end - span.start),
      ok: span.ok,
    })),
    area: {
      calls: area.calls,
      answered: area.answered,
      failed: area.failed,
      avgMs: area.answered > 0 ? round(area.totalMs / area.answered) : null,
      maxMs: area.answered > 0 ? round(area.maxMs) : null,
      bytes: bytes.area,
    },
    art,
    cuts: state.cuts.map((cut) => ({ name: cut.name, ms: round(cut.ms) })),
    shaders: state.shaders.map((shader) => ({
      name: shader.name,
      waitMs: round(shader.start - shader.requested),
      ms: round(shader.end - shader.start),
      ok: shader.ok,
    })),
    bytes,
    artCached: artCachedOf(art),
    info: { ...state.info },
  };
};

const seconds = (ms: number | null | undefined): string => (ms === null || ms === undefined ? "-" : `${(ms / 1000).toFixed(1)} s`);

const megabytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/** The one console line for an open. */
export const summaryLine = (summary: OpenSummary): string => {
  const { steps, area, info } = summary;
  const parts = [
    `own cell ${seconds(steps["own-cell"])}`,
    `first zone ${seconds(steps["area-first-answer"])}`,
    `zones in view ${seconds(steps["view-zones"])}`,
  ];
  if (info["painted"] === true) {
    parts.push(`painted ${seconds(steps["painted"])}`, `full look ${seconds(steps["full-look"])}`);
  }
  const areaText =
    area.answered > 0 ? `getarea ${area.calls} calls, avg ${area.avgMs} ms, max ${area.maxMs} ms` : `getarea ${area.calls} calls`;
  return (
    `[MR2 timing] open ${summary.open} (${summary.type}, ${summary.reason}) ${seconds(summary.totalMs)}: ${parts.join(", ")}; ` +
    `${areaText}; ${megabytes(summary.bytes.total)} downloaded, art cached: ${summary.artCached ?? "-"}; ` +
    `Quality ${String(info["quality"])}, ${String(info["browser"])}, GPU ${String(info["gpu"] ?? "-")}`
  );
};

export interface TableRow {
  readonly what: string;
  /** Milliseconds since the open began. */
  readonly at: number | null;
  /** How long it took, for the steps that take time. */
  readonly took: number | null;
  readonly note: string;
}

/** The rows of the console table, in time order. */
export const summaryRows = (summary: OpenSummary): TableRow[] => {
  const rows: TableRow[] = [];
  for (const [name, at] of Object.entries(summary.steps)) rows.push({ what: name, at, took: null, note: "" });
  for (const span of summary.spans) {
    rows.push({ what: span.name, at: span.startMs, took: span.ms, note: span.ok ? "" : span.ms === null ? "not finished" : "failed" });
  }
  for (const art of summary.art) {
    const parts: string[] = [art.from];
    if (art.downloadMs !== null) parts.push(`download ${art.downloadMs} ms`);
    if (art.decodeMs !== null) parts.push(`decode ${art.decodeMs} ms`);
    if (art.bytes > 0) parts.push(megabytes(art.bytes));
    rows.push({ what: `art ${art.file}`, at: null, took: art.ms, note: parts.join(", ") });
  }
  for (const cut of summary.cuts) rows.push({ what: `cut ${cut.name}`, at: null, took: cut.ms, note: "main thread" });
  for (const shader of summary.shaders) {
    rows.push({
      what: `shader ${shader.name}`,
      at: null,
      took: shader.ms,
      note: `${shader.ok ? "linked" : "FAILED"}${shader.waitMs > 0 ? `, waited ${shader.waitMs} ms in line` : ""}`,
    });
  }
  return rows.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
};

/** The record sent for real players: short keys, whole milliseconds, nothing about the player. */
export interface CompactRecord {
  readonly v: 1;
  readonly open: OpenType;
  readonly reason: FinishReason;
  readonly total: number;
  readonly t: Record<string, number>;
  readonly spans: Record<string, number>;
  readonly area: { n: number; ok: number; fail: number; avg: number | null; max: number | null };
  readonly art: Record<string, number>;
  readonly cut: number;
  readonly shaders: Record<string, number>;
  readonly kb: { total: number; area: number; art: number; code: number };
  readonly cached: OpenSummary["artCached"];
  readonly info: Record<string, InfoValue>;
}

const INFO_TEXT_MAX = 120;

export const compactRecord = (summary: OpenSummary): CompactRecord => {
  const kb = (bytes: number): number => Math.round(bytes / 1024);
  const spans: Record<string, number> = {};
  for (const span of summary.spans) if (span.ms !== null) spans[span.name] = span.ms;
  const art: Record<string, number> = {};
  for (const entry of summary.art) if (entry.ms !== null) art[entry.file] = entry.ms;
  const shaders: Record<string, number> = {};
  for (const shader of summary.shaders) shaders[shader.name] = shader.ms;
  const info: Record<string, InfoValue> = {};
  for (const [key, value] of Object.entries(summary.info)) {
    info[key] = typeof value === "string" ? value.slice(0, INFO_TEXT_MAX) : value;
  }
  return {
    v: 1,
    open: summary.type,
    reason: summary.reason,
    total: summary.totalMs,
    t: { ...summary.steps },
    spans,
    area: { n: summary.area.calls, ok: summary.area.answered, fail: summary.area.failed, avg: summary.area.avgMs, max: summary.area.maxMs },
    art,
    cut: summary.cuts.reduce((sum, cut) => sum + cut.ms, 0),
    shaders,
    kb: { total: kb(summary.bytes.total), area: kb(summary.bytes.area), art: kb(summary.bytes.art), code: kb(summary.bytes.code) },
    cached: summary.artCached,
    info,
  };
};

/**
 * A shader program's short name from the name Pixi writes into its source
 * (`#define SHADER_NAME mr2-painted-ground-low-fragment` gives `ground-low`).
 */
export const shaderName = (source: { readonly vertex?: string; readonly fragment?: string }): string => {
  const found = /#define SHADER_NAME (\S+)/.exec(source.fragment ?? "") ?? /#define SHADER_NAME (\S+)/.exec(source.vertex ?? "");
  if (!found) return "program";
  return found[1]!.replace(/^mr2-(painted-)?/, "").replace(/-(fragment|vertex)(-\d+)?$/, "");
};

/** The browser and its main version from the user agent ("Chrome 131", "Firefox 132", "Edge 131"). */
export const browserOf = (userAgent: string): string => {
  const pick = (pattern: RegExp, name: string): string | null => {
    const found = pattern.exec(userAgent);
    return found ? `${name} ${found[1]}` : null;
  };
  return (
    pick(/Edg(?:e|A|iOS)?\/(\d+)/, "Edge") ??
    pick(/OPR\/(\d+)/, "Opera") ??
    pick(/Firefox\/(\d+)/, "Firefox") ??
    pick(/FxiOS\/(\d+)/, "Firefox") ??
    pick(/CriOS\/(\d+)/, "Chrome") ??
    pick(/Chrome\/(\d+)/, "Chrome") ??
    pick(/Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari/, "Safari") ??
    "other"
  );
};
