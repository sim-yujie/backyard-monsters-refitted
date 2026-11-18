import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { artBase, artUrl, joinArtUrl } from "./artUrl";

const CDN = "https://cdn.example.test";

describe("artBase (VITE_ART_URL)", () => {
  it("is empty when unset or blank, so nothing moves", () => {
    for (const raw of [undefined, "", "   "]) expect(artBase(raw)).toBe("");
  });

  it("drops trailing slashes and spaces", () => {
    expect(artBase(`${CDN}/`)).toBe(CDN);
    expect(artBase(` ${CDN}// `)).toBe(CDN);
    expect(artBase("http://127.0.0.1:3411")).toBe("http://127.0.0.1:3411");
  });

  it("ignores a value that is not a whole http(s) address, rather than breaking every picture", () => {
    for (const raw of ["cdn.example.test", "/cdn", "ftp://cdn.example.test", "https://"])
      expect(artBase(raw)).toBe("");
  });
});

describe("joinArtUrl", () => {
  it("leaves every path as it is with no base (today's behaviour)", () => {
    for (const path of [
      "/assets/buildings/flinger/top.1.png",
      "/gamestage/assets/english.json",
      "/templates/x.html",
    ]) {
      expect(joinArtUrl("", path)).toBe(path);
    }
  });

  it("puts the server's art folders on the base", () => {
    expect(joinArtUrl(CDN, "/assets/buildings/flinger/top.1.png")).toBe(
      `${CDN}/assets/buildings/flinger/top.1.png`,
    );
    expect(joinArtUrl(CDN, "/gamestage/assets/english.json")).toBe(
      `${CDN}/gamestage/assets/english.json`,
    );
    expect(joinArtUrl(CDN, "/templates/x.html")).toBe(`${CDN}/templates/x.html`);
    expect(joinArtUrl(CDN, "/assets/monsters/C1.png?v=3")).toBe(
      `${CDN}/assets/monsters/C1.png?v=3`,
    );
  });

  it("leaves whole addresses, data and blob pictures, and the page's own files alone", () => {
    for (const path of [
      "https://other.example/assets/x.png",
      `${CDN}/assets/x.png`,
      "//cdn.example.test/assets/x.png",
      "data:image/png;base64,AAAA",
      "blob:https://play.example/1234",
      "/portraits/C1.png",
      "/tribes/kozu.png",
      "/ui/close.png",
      "/assetsx/y.png",
      "/api/v1/player/account",
      "assets/x.png",
    ]) {
      expect(joinArtUrl(CDN, path)).toBe(path);
    }
  });

  it("changes nothing the second time", () => {
    const once = joinArtUrl(CDN, "/assets/x.png");
    expect(joinArtUrl(CDN, once)).toBe(once);
  });
});

describe("artUrl in a build without VITE_ART_URL", () => {
  it("returns the same root-relative paths as before", () => {
    expect(artUrl("/assets/buildings/flinger/top.1.png")).toBe(
      "/assets/buildings/flinger/top.1.png",
    );
  });
});

describe("artUrl in a build with VITE_ART_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async (value: string) => {
    vi.stubEnv("VITE_ART_URL", value);
    vi.resetModules();
    return { art: await import("./artUrl"), retry: await import("./game/yard/retryLoad") };
  };

  it("asks the art name, and maps back to the path", async () => {
    const { art } = await load(`${CDN}/`);
    expect(art.artUrl("/assets/x.png")).toBe(`${CDN}/assets/x.png`);
    expect(art.artUrl("/portraits/C1.png")).toBe("/portraits/C1.png");
    expect(art.artPath(`${CDN}/assets/x.png`)).toBe("/assets/x.png");
    expect(art.artPath("/assets/x.png")).toBe("/assets/x.png");
  });

  it("still versions building pictures (BUILDING_ART_VERSION)", async () => {
    const { art, retry } = await load(CDN);
    const url = art.artUrl("/assets/buildings/flinger/top.1.png");
    expect(retry.versionedArt(url)).toBe(`${url}?v=${retry.BUILDING_ART_VERSION}`);
    expect(retry.versionedArt(art.artUrl("/assets/monsters/C1.png"))).toBe(
      `${CDN}/assets/monsters/C1.png`,
    );
  });
});

/**
 * Every piece of the server's art must be asked for through `artUrl()`, or it
 * keeps going through Vercel once VITE_ART_URL is set. A path counts as
 * wrapped when `artUrl(` comes right before its opening quote (line breaks
 * allowed); comments are skipped, and so is a line marked
 * `// art path, not fetched` (a path compared, never asked for).
 */
describe("no art path outside artUrl()", () => {
  const SRC = fileURLToPath(new URL(".", import.meta.url));
  const ART_STRING = /["'`]\/(?:assets|gamestage|templates)\//g;

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
        ? [path]
        : [];
    });

  it("finds none", () => {
    const bare: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(ART_STRING)) {
        const at = match.index;
        const lineStart = text.lastIndexOf("\n", at) + 1;
        const line = text.slice(
          lineStart,
          text.indexOf("\n", at) === -1 ? undefined : text.indexOf("\n", at),
        );
        const head = line.trimStart();
        if (head.startsWith("*") || head.startsWith("//") || head.startsWith("/*")) continue;
        if (line.includes("// art path, not fetched")) continue;
        if (/artUrl\(\s*$/.test(text.slice(Math.max(0, at - 200), at))) continue;
        bare.push(
          `${relative(SRC, file)}:${text.slice(0, at).split("\n").length}: ${head.slice(0, 100)}`,
        );
      }
    }
    expect(bare).toEqual([]);
  });
});
