/**
 * MOCK-UP ONLY (branch `mock/hexcell-styles`): a throwaway switch for an owner
 * comparison of hex-cell looks. Never wired up outside this branch.
 *
 * `?cellStyle=a|b|c` on the URL picks an alternate look for a player's yard
 * and outpost cells; anything else leaves the map exactly as it is. Wild
 * monster camps are unaffected by every style.
 */
export type MockCellStyle = "a" | "b" | "c" | null;

const VALID_STYLES: ReadonlySet<string> = new Set(["a", "b", "c"]);

const paramsOf = (): URLSearchParams | null =>
  typeof location === "undefined" ? null : new URLSearchParams(location.search);

const styleParam = paramsOf()?.get("cellStyle") ?? null;

/** Read once at module load; the URL does not change without a reload. */
export const mockCellStyle: MockCellStyle =
  styleParam && VALID_STYLES.has(styleParam) ? (styleParam as MockCellStyle) : null;

/**
 * `?fakeOutposts=1`: fake a few outposts near the player's own yard, since the
 * dev database has none. Client-side only; see `mockFakeOutposts.ts`.
 */
export const mockFakeOutposts: boolean = paramsOf()?.get("fakeOutposts") === "1";
