/**
 * Whether this is a phone or a tablet (patch 7.11): they get the lighter
 * monster sheets (`game/quality.ts`). iPhones ran out of memory with the
 * `@4x` sheets and iOS closed the tab; they report neither their memory nor a
 * small texture limit, so nothing else tells them from a desktop.
 *
 * A laptop with a touch screen is not one: its first pointer is the mouse.
 */

/** What the browser says about the device. */
export interface TouchEnv {
  readonly userAgent: string;
  /** `navigator.maxTouchPoints`. */
  readonly maxTouchPoints: number;
  /** Whether the first pointer is a finger: `matchMedia("(pointer: coarse)")`. */
  readonly coarsePointer: boolean;
}

/**
 * A phone or tablet by its name (iPhone, iPad, iPod, Android); an iPad that
 * says it is a Mac, told by its touch points (a real Mac has none); or any
 * device whose first pointer is a finger. Touch points alone do not count:
 * touch-screen laptops have them too.
 */
export const looksLikeTouchDevice = (env: TouchEnv): boolean =>
  /iPhone|iPad|iPod|Android/.test(env.userAgent) ||
  (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1) ||
  env.coarsePointer;

/** This browser's {@link TouchEnv}; all "no" where there is no browser. */
export const browserTouchEnv = (): TouchEnv => {
  try {
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const touchPoints = nav?.maxTouchPoints;
    return {
      userAgent: typeof nav?.userAgent === "string" ? nav.userAgent : "",
      maxTouchPoints: typeof touchPoints === "number" ? touchPoints : 0,
      coarsePointer: typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true,
    };
  } catch {
    return { userAgent: "", maxTouchPoints: 0, coarsePointer: false };
  }
};

/** Decided once a page load: a device does not change kind. */
let touch: boolean | null = null;

/** Whether this device is a phone or a tablet ({@link looksLikeTouchDevice}). */
export const isTouchDevice = (): boolean => (touch ??= looksLikeTouchDevice(browserTouchEnv()));

/** Sets it outright, or forgets it with null (tests). */
export const setTouchDevice = (value: boolean | null): void => {
  touch = value;
};
