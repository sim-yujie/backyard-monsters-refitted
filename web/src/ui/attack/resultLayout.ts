/**
 * Which look the Repeat attack's result takes (owner, 16 Nov 2026: "this
 * panel is too wordy, badly formatted"). astra's proposals are built side by
 * side so the owner can pick one on the Review Desk: `?arp=A` in the address,
 * or `localStorage["bymr.arp"]`. Anything else is today's panel. The switch
 * goes once the owner has picked.
 */
export type ResultLayout = "today" | "A" | "B" | "C";

const LAYOUTS: readonly ResultLayout[] = ["A", "B", "C"];

/** The look asked for, from the address first, then the browser's storage. */
export const resultLayout = (): ResultLayout => {
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(window.location.search).get("arp");
  } catch {
    asked = null;
  }
  if (!asked) {
    try {
      asked = window.localStorage.getItem("bymr.arp");
    } catch {
      asked = null;
    }
  }
  const upper = (asked ?? "").toUpperCase() as ResultLayout;
  return LAYOUTS.includes(upper) ? upper : "today";
};
