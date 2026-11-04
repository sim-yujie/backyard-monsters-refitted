// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CaptureStats,
  type GameApp,
  SCREENSHOT_WIDTH,
  clearInlinedImages,
  gameFrameOf,
  inlineFonts,
  inlineUrls,
  preloadImages,
  replaceUrls,
  usedImageUrls,
  rootAttributes,
  uiSvgMarkup,
} from "./screenCapture";

/**
 * The bug report's screenshot copies the HTML windows into an SVG picture.
 * There `:root` is the <svg>, so it must carry <html>'s attributes for the
 * window style (`:root[data-skin]`) and font choice (`:root[data-font]`) to
 * show as the player sees them (owner, 4 Nov 2026).
 */

const root = document.documentElement;

afterEach(() => {
  for (const name of ["data-skin", "data-font", "class", "style", "lang"]) root.removeAttribute(name);
  vi.unstubAllGlobals();
});

const parseSvg = (markup: string): Document => new DOMParser().parseFromString(markup, "image/svg+xml");

describe("the screenshot's SVG root", () => {
  it.each(["scrap", "flash"])("carries data-skin=%s from <html>", (skin) => {
    root.dataset.skin = skin;
    const svg = parseSvg(uiSvgMarkup("<p>hi</p>", "", 800, 600)).documentElement;
    expect(svg.localName).toBe("svg");
    expect(svg.getAttribute("data-skin")).toBe(skin);
  });

  it("carries the font choice, classes, other data-* and the inline style", () => {
    root.dataset.font = "readable";
    root.setAttribute("class", "touch wide");
    root.setAttribute("lang", "en");
    root.setAttribute("style", '--hud-scale: 1.25; --title: "A & B"');
    const svg = parseSvg(uiSvgMarkup("<p>hi</p>", "", 800, 600)).documentElement;
    expect(svg.getAttribute("data-font")).toBe("readable");
    expect(svg.getAttribute("class")).toBe("touch wide");
    expect(svg.getAttribute("lang")).toBe("en");
    expect(svg.getAttribute("style")).toContain('--hud-scale: 1.25; --title: "A & B"');
    // Its own size and namespace are not overwritten.
    expect(svg.getAttribute("width")).toBe("800");
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("leaves no data-skin when the page has none (the base look)", () => {
    expect(rootAttributes()).not.toContain("data-skin");
    const svg = parseSvg(uiSvgMarkup("<p>hi</p>", "", 800, 600)).documentElement;
    expect(svg.hasAttribute("data-skin")).toBe(false);
  });

  it("lets :root[data-skin] rules reach the copied windows", () => {
    root.dataset.skin = "scrap";
    const html = '<div xmlns="http://www.w3.org/1999/xhtml" id="game-root"><section class="panel">x</section></div>';
    const doc = parseSvg(uiSvgMarkup(html, "", 800, 600));
    expect(doc.querySelector(':root[data-skin="scrap"] .panel')).not.toBeNull();
    expect(doc.querySelector(':root[data-skin="flash"] .panel')).toBeNull();
  });

  it("keeps a CSS ]]> from closing the style block", () => {
    const doc = parseSvg(uiSvgMarkup("<p>hi</p>", 'a::after{content:"]]>"}', 800, 600));
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  });
});

describe("the screenshot's fonts", () => {
  const face = (family: string, file: string): { text: string; base: string } => ({
    text: `@font-face { font-family: "${family}"; src: url("/fonts/${file}") format("woff2"); }`,
    base: window.location.href,
  });
  const faces = [face("Titan One", "titan.woff2"), face("Nunito", "nunito.woff2"), face("Atkinson Hyperlegible", "atk.woff2")];

  const stubFetch = (size: number) => {
    // The page's own Blob, which its FileReader can read (Node's Response makes another kind).
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(size)], { type: "font/woff2" }) }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("inlines the loaded families' files as data URLs", async () => {
    const fetchMock = stubFetch(1000);
    const css = await inlineFonts(faces, new Set(["Titan One", "Nunito"]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(css).toContain('font-family: "Titan One"');
    expect(css).toContain('font-family: "Nunito"');
    expect(css).not.toContain("Atkinson");
    expect(css).toContain('url("data:font/woff2;base64,');
    expect(css).not.toContain("/fonts/");
  });

  it("keeps every face when the browser cannot say which are loaded", async () => {
    stubFetch(10);
    const css = await inlineFonts(faces, null);
    expect(css).toContain("Atkinson Hyperlegible");
  });

  it("drops the fonts (plain font stack) when the files together are too big", async () => {
    stubFetch(600);
    expect(await inlineFonts(faces, null, 1000)).toBe("");
  });

  it("drops the fonts when they cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await inlineFonts(faces, null)).toBe("");
  });

  it("skips files on another site", async () => {
    const fetchMock = stubFetch(10);
    const css = await inlineFonts([{ text: '@font-face { font-family: "X"; src: url("https://cdn.example.com/x.woff2"); }', base: window.location.href }], null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(css).toBe("");
  });
});

describe("the screenshot's game layer", () => {
  const fakeApp = (extract: () => unknown) => {
    const canvas = document.createElement("canvas");
    const render = vi.fn();
    const calls: unknown[] = [];
    const app = {
      canvas,
      stage: {},
      screen: { x: 0, y: 0, width: 1600, height: 900 },
      renderer: {
        resolution: 2,
        extract: {
          canvas: (options: unknown) => {
            calls.push(options);
            return extract();
          },
        },
      },
      render,
    } as unknown as GameApp;
    return { app, canvas, render, calls };
  };

  it("has Pixi draw the stage into its own texture, at no more than the screenshot's width", () => {
    const picture = document.createElement("canvas");
    picture.width = 1280;
    picture.height = 720;
    const { app, canvas, render, calls } = fakeApp(() => picture);
    const frame = gameFrameOf(app);
    expect(frame.picture).toBe(picture);
    expect(frame.canvas).toBe(canvas);
    expect(render).not.toHaveBeenCalled();
    expect(calls[0]).toMatchObject({ target: app.stage, frame: app.screen, resolution: SCREENSHOT_WIDTH / 1600 });
  });

  it("falls back to the page canvas right after a render when the read-back fails", () => {
    const { app, canvas, render } = fakeApp(() => {
      throw new Error("no extract");
    });
    const frame = gameFrameOf(app);
    expect(render).toHaveBeenCalledTimes(1);
    expect(frame.picture).toBe(canvas);
  });
});

describe("the screenshot's pictures", () => {
  afterEach(() => clearInlinedImages());

  const stubImages = (sizes: Record<string, number>) => {
    const fetchMock = vi.fn(async (href: string) => {
      const path = new URL(href).pathname;
      const size = sizes[path];
      if (size === undefined) return { ok: false, blob: async () => new Blob([]) };
      return { ok: true, blob: async () => new Blob([new Uint8Array(size)], { type: "image/webp" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const freshStats = (): CaptureStats => ({
    game: "none",
    images: 0,
    imageBytes: 0,
    missing: [],
    fontBytes: 0,
    svgBytes: 0,
    uiMs: 0,
    totalMs: 0,
  });
  const base = window.location.href;

  it("inlines the window art the styles name, counts it, and notes what it could not have", async () => {
    stubImages({ "/ui/skin/scrap/frame.webp": 41_924, "/ui/skin/scrap/title.webp": 20_126 });
    const stats = freshStats();
    const found = await inlineUrls(
      [
        { url: "/ui/skin/scrap/frame.webp", base },
        { url: "/ui/skin/scrap/title.webp", base },
        { url: "/ui/skin/scrap/frame.webp", base },
        { url: "/ui/skin/gone.webp", base },
        { url: "https://cdn.example.com/x.png", base },
      ],
      stats,
    );
    expect(found.get("/ui/skin/scrap/frame.webp")).toMatch(/^data:image\/webp;base64,/);
    expect(new Set(found.values()).size).toBe(2);
    expect(found.get(new URL("/ui/skin/scrap/frame.webp", base).href)).toBe(found.get("/ui/skin/scrap/frame.webp"));
    expect(stats.images).toBe(2);
    expect(stats.imageBytes).toBe(41_924 + 20_126);
    expect(stats.missing.sort()).toEqual(["/ui/skin/gone.webp", "https://cdn.example.com/x.png"]);
  });

  it("keeps the pictures for the next report rather than reading them again", async () => {
    const fetchMock = stubImages({ "/ui/skin/flash/frame.webp": 100 });
    await inlineUrls([{ url: "/ui/skin/flash/frame.webp", base }]);
    await inlineUrls([{ url: "/ui/skin/flash/frame.webp", base }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("puts the styles' art in tiny <img>s so the SVG waits for it, once each", () => {
    const frame = "data:image/webp;base64,AAAA";
    const card = "data:image/webp;base64,BBBB";
    const inlined = new Map([
      ["/ui/skin/scrap/frame.webp", frame],
      ["/ui/frame-again.webp", frame],
      ["/whats-new/card.webp", card],
    ]);
    const shown = document.createElement("img");
    shown.setAttribute("src", card);
    const markup = preloadImages(inlined, [shown]);
    const doc = parseSvg(uiSvgMarkup(markup, "", 800, 600));
    const images = Array.from(doc.getElementsByTagName("img"));
    // The card is already an <img> of the copy; the frame is added once.
    expect(images.map((image) => image.getAttribute("src"))).toEqual([frame]);
    expect(images[0]?.getAttribute("decoding")).toBe("sync");
    expect(preloadImages(new Map())).toBe("");
  });
});

describe("which pictures the screenshot carries", () => {
  const page = window.location.href;

  it("takes only the pictures of shown elements, as absolute addresses", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="hud" style="background-image: url(/ui/icons/gold.webp)"></div>' +
      '<img class="card" src="/whats-new/a.webp">' +
      '<div class="hidden" style="background-image: url(/ui/icons/hidden.webp)"></div>' +
      '<img class="hidden" src="/whats-new/hidden.webp">' +
      '<div style="background-image: url(data:image/png;base64,AA)"></div>';
    document.body.append(root);
    const urls = usedImageUrls(root, 800, 600, (element) => !element.classList.contains("hidden"));
    root.remove();
    expect(urls.sort()).toEqual([new URL("/ui/icons/gold.webp", page).href, new URL("/whats-new/a.webp", page).href].sort());
  });

  it("swaps each url() for its data URL however it was written, and the rest for none", () => {
    const frame = "data:image/webp;base64,AAAA";
    const inlined = new Map([[new URL("/ui/skin/scrap/frame.webp", page).href, frame]]);
    const css =
      ':root[data-skin="scrap"] { --skin-frame: url("/ui/skin/scrap/frame.webp"); }\n' +
      ':root[data-skin="flash"] { --skin-frame: url("/ui/skin/flash/frame.webp"); }\n' +
      ".x { background: url(../skin/scrap/frame.webp) }";
    const out = replaceUrls(css, inlined, new URL("/ui/styles/skin.css", page).href);
    expect(out).toContain(`--skin-frame: url("${frame}")`);
    expect(out).toContain("--skin-frame: none");
    expect(out).toContain(`.x { background: url("${frame}") }`);
  });
});
