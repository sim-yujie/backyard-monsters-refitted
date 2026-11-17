import { afterEach, describe, expect, it } from "vitest";
import type { Renderer } from "pixi.js";
import {
  errorWords,
  GraphicsLogThrottle,
  graphicsMessage,
  LOAD_MAX,
  pictureName,
  readGpuName,
  reportGraphicsProblem,
  resetGraphicsLog,
  SESSION_KEY,
  shortAgent,
  watchGraphics,
  type GraphicsDevice,
} from "./graphicsLog";

/** A stand-in for the browser's storage. */
const storage = (entries: Record<string, string> = {}): Storage => {
  const kept = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  } as Storage;
};

const OLD_PHONE: GraphicsDevice = {
  gpu: "Mali-G52 MC2",
  maxTexture: 4096,
  memoryGb: 2,
  quality: "medium",
  qualityChosen: false,
  dpr: 2.75,
  screen: { width: 393, height: 873 },
  agent: "Android 11 SM-A125F, Chrome 120",
};

afterEach(() => resetGraphicsLog());

describe("graphicsMessage", () => {
  it("carries what failed and every device detail, most telling first", () => {
    const message = graphicsMessage(
      "sheet-failed",
      "monsters/krallen_1_rev_65-repaint.png (@2x)",
      "InvalidStateError: The source image could not be decoded.",
      OLD_PHONE,
    );
    expect(message).toBe(
      "Graphics: picture did not load: monsters/krallen_1_rev_65-repaint.png (@2x) " +
        "(InvalidStateError: The source image could not be decoded.) | gpu Mali-G52 MC2 | max texture 4096 | " +
        "memory 2 GB | quality medium (default) | dpr 2.75 | screen 393x873 | Android 11 SM-A125F, Chrome 120",
    );
    // The server keeps 500 characters of it.
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it("says unknown for what a device does not tell, and a chosen Quality as chosen", () => {
    const message = graphicsMessage("context-lost", "game canvas", "", {
      gpu: null,
      maxTexture: null,
      memoryGb: null,
      quality: "high",
      qualityChosen: true,
      dpr: null,
      screen: null,
      agent: "unknown",
    });
    expect(message).toBe(
      "Graphics: WebGL context lost: game canvas | gpu unknown | max texture unknown | memory unknown | " +
        "quality high (chosen) | dpr unknown | screen unknown | unknown",
    );
  });

  it("stays within the server's 500 characters with the longest parts", () => {
    const message = graphicsMessage("sheet-cut-failed", "x".repeat(400), "y".repeat(400), { ...OLD_PHONE, gpu: "z".repeat(400) });
    expect(message.length).toBeLessThanOrEqual(500);
  });
});

describe("the throttle", () => {
  it("lets one entry through per kind per picture a page load", () => {
    const throttle = new GraphicsLogThrottle(8, 20, () => storage());
    expect(throttle.allow("sheet-failed", "monsters/a@2x.png")).toBe(true);
    expect(throttle.allow("sheet-failed", "monsters/a@2x.png")).toBe(false);
    expect(throttle.allow("sheet-over-limit", "monsters/a@2x.png")).toBe(true);
    expect(throttle.allow("sheet-failed", "monsters/b@2x.png")).toBe(true);
    expect(throttle.allow("context-lost", "game canvas")).toBe(true);
    expect(throttle.allow("context-lost", "game canvas")).toBe(false);
  });

  it(`stops after ${LOAD_MAX} a page load`, () => {
    const throttle = new GraphicsLogThrottle(LOAD_MAX, 100, () => storage());
    const allowed = Array.from({ length: 12 }, (_, i) => throttle.allow("sheet-failed", `monsters/${i}.png`));
    expect(allowed.filter(Boolean)).toHaveLength(LOAD_MAX);
    expect(allowed.slice(0, LOAD_MAX).every(Boolean)).toBe(true);
  });

  it("stops at the tab session's cap across reloads", () => {
    const store = storage();
    const first = new GraphicsLogThrottle(8, 10, () => store);
    for (let i = 0; i < 8; i += 1) expect(first.allow("sheet-failed", `a${i}`)).toBe(true);
    expect(store.getItem(SESSION_KEY)).toBe("8");
    // The page is loaded again: a new count for the load, the same tab's.
    const second = new GraphicsLogThrottle(8, 10, () => store);
    expect(second.allow("sheet-failed", "b0")).toBe(true);
    expect(second.allow("sheet-failed", "b1")).toBe(true);
    expect(second.allow("sheet-failed", "b2")).toBe(false);
  });

  it("still caps a page load with site data blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const throttle = new GraphicsLogThrottle(2, 20, () => blocked);
    expect(throttle.allow("sheet-failed", "a")).toBe(true);
    expect(throttle.allow("sheet-failed", "b")).toBe(true);
    expect(throttle.allow("sheet-failed", "c")).toBe(false);
  });
});

describe("reportGraphicsProblem", () => {
  it("sends the entry once, through the error reporter's channel", () => {
    resetGraphicsLog(new GraphicsLogThrottle(8, 20, () => storage()));
    const sent: string[] = [];
    const send = (message: string): void => void sent.push(message);
    expect(reportGraphicsProblem("sheet-failed", "monsters/a@2x.png", "Error: 404", send, () => OLD_PHONE)).toBe(true);
    expect(reportGraphicsProblem("sheet-failed", "monsters/a@2x.png", "Error: 404", send, () => OLD_PHONE)).toBe(false);
    expect(sent).toEqual([
      "Graphics: picture did not load: monsters/a@2x.png (Error: 404) | gpu Mali-G52 MC2 | max texture 4096 | " +
        "memory 2 GB | quality medium (default) | dpr 2.75 | screen 393x873 | Android 11 SM-A125F, Chrome 120",
    ]);
  });

  it("never throws", () => {
    resetGraphicsLog(new GraphicsLogThrottle(8, 20, () => storage()));
    const send = (): void => {
      throw new Error("down");
    };
    expect(reportGraphicsProblem("context-lost", "game canvas", "", send, () => OLD_PHONE)).toBe(false);
  });
});

describe("watchGraphics", () => {
  const fakeGl = (renderer: string, unmasked: string | null) =>
    ({
      RENDERER: 0x1f01,
      getParameter: (name: number) => (name === 0x1f01 ? renderer : name === 0x9246 ? unmasked : null),
      getExtension: (name: string) =>
        name === "WEBGL_debug_renderer_info" && unmasked !== null ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
    }) as unknown as WebGLRenderingContext;

  it("reads the unmasked graphics card where the browser masks it, and Firefox's own name", () => {
    expect(readGpuName(fakeGl("WebKit WebGL", "Apple GPU"))).toBe("Apple GPU");
    expect(readGpuName(fakeGl("Mali-G52 MC2, or similar", "secret"))).toBe("Mali-G52 MC2, or similar");
    expect(readGpuName(fakeGl("WebKit WebGL", null))).toBe("WebKit WebGL");
  });

  it("sends a lost and a restored context, with the time on the page, and stops when asked", () => {
    resetGraphicsLog(new GraphicsLogThrottle(8, 20, () => storage()));
    const canvas = new EventTarget();
    const sent: string[] = [];
    const renderer = { gl: fakeGl("WebKit WebGL", "Adreno (TM) 506") } as unknown as Renderer;
    const stop = watchGraphics(renderer, canvas, (kind, subject, detail) =>
      reportGraphicsProblem(kind, subject, detail, (m) => void sent.push(m), () => OLD_PHONE),
    );
    canvas.dispatchEvent(new Event("webglcontextlost"));
    canvas.dispatchEvent(new Event("webglcontextlost"));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    stop();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatch(/^Graphics: WebGL context lost: game canvas \(after \d+ s on the page\) \| gpu Mali-G52 MC2 \|/);
    expect(sent[1]).toMatch(/^Graphics: WebGL context restored: game canvas \(after \d+ s on the page\) \|/);
  });

  it("names the graphics card in the entries", () => {
    resetGraphicsLog(new GraphicsLogThrottle(8, 20, () => storage()));
    watchGraphics({ gl: fakeGl("WebKit WebGL", "Adreno (TM) 506") } as unknown as Renderer, new EventTarget())();
    const sent: string[] = [];
    reportGraphicsProblem("sheet-failed", "monsters/a.png", "", (m) => void sent.push(m));
    expect(sent[0]).toContain("| gpu Adreno (TM) 506 |");
    expect(sent[0]).toMatch(/\| quality (high|medium|low) \((default|chosen)\) \|/);
  });
});

describe("words", () => {
  it("names a picture by its last two path parts and its copy, without address or query", () => {
    expect(pictureName("http://localhost:5431/assets/monsters/krallen_1_rev_65-repaint@2x.png?v=3")).toBe(
      "monsters/krallen_1_rev_65-repaint.png (@2x)",
    );
    expect(pictureName("/assets/monsters/korath_5@1.5x.webp")).toBe("monsters/korath_5.webp (@1.5x)");
    expect(pictureName("/assets/buildings/tower.png")).toBe("buildings/tower.png (1x)");
    expect(pictureName(undefined)).toBe("");
  });

  it("gives an error's words without the page's address", () => {
    expect(errorWords(new TypeError("Failed to fetch https://play.example.com/assets/a.png"))).toBe(
      "TypeError: Failed to fetch (url)",
    );
    // Pixi's loader wraps the cause: only the cause is kept, its address left out.
    const pixi = new Error(
      "[Loader.load] Failed to load http://localhost:5431/assets/monsters/dave-anim@2x.png?v=w3oo.\n" +
        "Error: [loadImageBitmap] Failed to fetch http://localhost:5431/assets/monsters/dave-anim@2x.png?v=w3oo: 404 Not Found",
    );
    expect(errorWords(pixi)).toBe("Error: [loadImageBitmap] Failed to fetch (url): 404 Not Found");
    const decode = new Error("[Loader.load] Failed to load /assets/monsters/a@4x.png.\nInvalidStateError: The source image could not be decoded.");
    expect(errorWords(decode)).toBe("InvalidStateError: The source image could not be decoded.");
    expect(errorWords("plain words")).toBe("plain words");
    expect(errorWords({ type: "error" })).toBe("error event");
  });

  it("shortens the user agent to system and browser, major versions only", () => {
    expect(
      shortAgent(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Android 10, Chrome 120");
    expect(
      shortAgent(
        "Mozilla/5.0 (Linux; Android 9; SM-J530F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Android 9 SM-J530F, Samsung Internet 23");
    expect(
      shortAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone iOS 15.8, Safari 15");
    expect(shortAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe(
      "Windows, Firefox 132",
    );
    expect(shortAgent("")).toBe("unknown");
    // Nothing the server would take for an address (four dotted numbers).
    expect(shortAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.6099.109 Safari/537.36")).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
