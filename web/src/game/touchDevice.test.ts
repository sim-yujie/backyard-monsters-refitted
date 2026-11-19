// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultQuality,
  deviceDefaultQuality,
  deviceTextureLimit,
  setDeviceDefaultQuality,
  setDeviceTextureLimit,
} from "./quality";
import { browserTouchEnv, isTouchDevice, looksLikeTouchDevice, setTouchDevice, type TouchEnv } from "./touchDevice";

/** Patch 7.11: phones and tablets start on Medium; desktops, touch-screen laptops among them, on High. */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const DEVICES: ReadonlyArray<{ name: string; env: TouchEnv; touch: boolean }> = [
  { name: "an iPhone", env: { userAgent: IPHONE, maxTouchPoints: 5, coarsePointer: true }, touch: true },
  { name: "an iPhone that says nothing about its pointer", env: { userAgent: IPHONE, maxTouchPoints: 0, coarsePointer: false }, touch: true },
  { name: "an iPad that says it is a Mac, with touch points", env: { userAgent: MAC, maxTouchPoints: 5, coarsePointer: false }, touch: true },
  { name: "an Android phone", env: { userAgent: ANDROID, maxTouchPoints: 5, coarsePointer: true }, touch: true },
  { name: "an unnamed device whose first pointer is a finger", env: { userAgent: "Mozilla/5.0 (X11; Linux)", maxTouchPoints: 5, coarsePointer: true }, touch: true },
  { name: "a touch-screen laptop (mouse first, 10 touch points)", env: { userAgent: WINDOWS, maxTouchPoints: 10, coarsePointer: false }, touch: false },
  { name: "a real Mac", env: { userAgent: MAC, maxTouchPoints: 0, coarsePointer: false }, touch: false },
  { name: "a plain desktop", env: { userAgent: WINDOWS, maxTouchPoints: 0, coarsePointer: false }, touch: false },
];

describe("the default Quality by kind of device (patch 7.11)", () => {
  afterEach(() => {
    setTouchDevice(null);
    setDeviceDefaultQuality(null);
    setDeviceTextureLimit(null);
  });

  for (const { name, env, touch } of DEVICES) {
    it(`${name} ${touch ? "is a touch device and starts on Medium" : "is not a touch device and starts on High"}`, () => {
      expect(looksLikeTouchDevice(env)).toBe(touch);
      // An iPhone's hints otherwise: no memory said, a 16384 px texture limit.
      expect(defaultQuality({ memoryGb: null, textureLimit: 16384, touch: looksLikeTouchDevice(env) })).toBe(
        touch ? "medium" : "high",
      );
    });
  }

  it("the device's own default follows the touch check", () => {
    setDeviceTextureLimit(16384);
    setTouchDevice(true);
    expect(deviceDefaultQuality()).toBe("medium");
    setDeviceDefaultQuality(null);
    setTouchDevice(false);
    expect(deviceDefaultQuality()).toBe("high");
  });

  it("a touch device that never chose still asks for its texture limit, so its first sheets step down", () => {
    setTouchDevice(true);
    expect(deviceTextureLimit()).toBeNull();
    const created = vi.spyOn(document, "createElement").mockReturnValue({
      getContext: () => ({ MAX_TEXTURE_SIZE: 1, getParameter: () => 4096, getExtension: () => null }),
    } as unknown as HTMLElement);
    try {
      expect(deviceDefaultQuality()).toBe("medium");
      expect(deviceTextureLimit()).toBe(4096);
    } finally {
      created.mockRestore();
    }
  });

  it("is not a touch device where there is no browser to ask, decided once", () => {
    expect(looksLikeTouchDevice(browserTouchEnv())).toBe(false);
    setTouchDevice(true);
    expect(isTouchDevice()).toBe(true);
  });
});
