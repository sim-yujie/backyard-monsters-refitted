import { devices, type BrowserContextOptions } from "@playwright/test";

/**
 * The screens the layout check opens every window on (owner, 15 Nov 2026).
 *
 * Phones and iPads use Playwright's device emulation (touch, an iPhone or iPad
 * user agent, `isMobile`, `hasTouch`) so the game picks its touch layout; the
 * viewport is then set to the size the owner named, since the device presets
 * are other sizes (iPhone 13 is 390x664 upright, 750x342 on its side).
 *
 * `deviceScaleFactor` is 1 everywhere: CSS pixels, media queries and every
 * box the check measures are the same at any pixel ratio (no stylesheet asks
 * for `resolution`), and the WebGL yard draws far faster at 1 on a CI runner
 * that has no graphics card.
 */
export interface Profile {
  /** Short id, used in test names and in KNOWN_FAILURES keys. */
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** A touch screen: the game must see `(pointer: coarse)`. */
  readonly touch: boolean;
  readonly context: BrowserContextOptions;
}

const iphone = devices["iPhone 13"];
const ipad = devices["iPad Pro 11"];
const mac = devices["Desktop Safari"];

const profile = (
  id: string,
  label: string,
  width: number,
  height: number,
  base: BrowserContextOptions & { readonly defaultBrowserType?: string },
): Profile => {
  // The preset's browser type and screen size are not context options here.
  const { defaultBrowserType: _browser, screen: _screen, ...options } = base;
  return {
    id,
    label,
    width,
    height,
    touch: options.hasTouch === true,
    context: {
      ...options,
      viewport: { width, height },
      screen: { width, height },
      deviceScaleFactor: 1,
    },
  };
};

export const PROFILES: readonly Profile[] = [
  // Phones.
  profile("phone-upright", "iPhone upright", 390, 844, iphone),
  profile("phone-upright-bars", "iPhone upright, Safari bars", 390, 664, iphone),
  profile("phone-side", "iPhone on its side", 844, 390, iphone),
  // iPads. Safari's bars take 100-150 px off the height of a landscape iPad.
  profile("ipad-side-bars", "iPad on its side, Safari bars", 1180, 690, ipad),
  profile("ipad-side-short", "iPad on its side, short", 1024, 560, ipad),
  profile("ipad-upright", "iPad upright", 820, 1180, ipad),
  // A 9.7-10.2 inch iPad upright: the Monsters tabs slid out of sight here (beta 9).
  profile("ipad-small-upright", "Small iPad upright", 768, 1024, ipad),
  profile("ipad-split", "iPad Split View", 694, 768, ipad),
  profile("ipad-pro-side", "iPad Pro 12.9 on its side", 1366, 1024, ipad),
  // Odd sizes: the player's screenshot was 2000x1161 (about 1000x580 at 2x).
  profile("odd-980", "Small tablet or zoomed page", 980, 551, ipad),
  // Desktop Safari.
  profile("desktop", "Desktop", 1366, 768, mac),
  profile("desktop-large", "Desktop, large", 1920, 1080, mac),
];

/** The run can be narrowed: LAYOUT_PROFILES=ipad-side-bars,phone-side. */
export const selectedProfiles = (): readonly Profile[] => {
  const wanted = process.env["LAYOUT_PROFILES"]
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!wanted?.length) return PROFILES;
  return PROFILES.filter((item) => wanted.includes(item.id));
};
