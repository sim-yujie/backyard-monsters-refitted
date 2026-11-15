/**
 * The phone layout's media query, as the stylesheets write it: upright up to
 * 620 px wide (`max-width: 620px`), and a phone on its side by its height
 * (`max-height: 500px`). Together that is either one.
 */
export const PHONE_LAYOUT_QUERY = "(max-width: 620px), (max-height: 500px)";

/** Whether the screen gets the phone layout now; false where nothing can tell. */
export const isPhoneLayout = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.(PHONE_LAYOUT_QUERY).matches === true;
