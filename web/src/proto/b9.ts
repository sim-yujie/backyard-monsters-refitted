/**
 * DESIGN PROTOTYPE ONLY (branch design/b9-screens, never merged): the beta 9
 * screen options, switched on by URL parameters so real in-game screenshots
 * can be taken of each option. Fake data throughout.
 *
 * - `b9arrows=a|b|c`  outpost arrows (A flank the flag, B bottom row, C tray)
 * - `b9hcc=2|3`       fake HCC level; `b9hccopt=a|b|c` the window option
 * - `b9baiter=a|b`    Baiter for friends (A Baiter HQ, B Friends desk)
 */
const params = (): URLSearchParams => {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
};

export const b9 = (name: string): string | null => params().get(name);

export const b9Arrows = (): "a" | "b" | "c" | null => {
  const v = b9("b9arrows");
  return v === "a" || v === "b" || v === "c" ? v : null;
};

export const b9HccLevel = (): number => Number(b9("b9hcc") ?? 1) || 1;
export const b9HccOption = (): "a" | "b" | "c" => (b9("b9hccopt") as "a" | "b" | "c" | null) ?? "a";
export const b9Baiter = (): "a" | "b" | null => {
  const v = b9("b9baiter");
  return v === "a" || v === "b" ? v : null;
};
