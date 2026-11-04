// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineFonts, rootAttributes, uiSvgMarkup } from "./screenCapture";

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
