import { post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * Map bookmarks.
 *
 * Route: POST /api/:apiVersion/player/savebookmarks (docs/server-api.md).
 * `bookmarks` is a JSON *string* in a single form field, which the controller
 * parses and stores on `user.bookmarks` with no validation at all — there is no
 * zod schema on this route, so whatever is sent is what comes back.
 *
 * The blob is not an array. It is the Flash client's flat key-value bag
 * (docs/specs/maproom2.md §4 Bookmarks, MapRoom.as:479-483):
 *
 *   { mbms: <count>, mbm<i>: <x * 10000 + y>, mbmn<i>: <name> }
 *
 * Verified against the running server: saving that shape and logging back in
 * returns it verbatim on the login response's `bookmarks` field. Keeping the
 * old encoding rather than inventing a cleaner one means the Flash client and
 * this one can share an account without either corrupting the other's list.
 */

const SAVE_PATH = "/api/:apiVersion/player/savebookmarks";

/** The cap the original client enforced (MapRoom.as:462-467). */
export const MAX_BOOKMARKS = 8;
/** Names are trimmed and cut to this length (MapRoom.as:442-455). */
export const MAX_BOOKMARK_NAME_LENGTH = 20;

export interface Bookmark {
  x: number;
  y: number;
  name: string;
}

/** Packs a coordinate the way the blob stores it. */
export const packLocation = (x: number, y: number): number => x * 10000 + y;

/** Reads a packed location back. */
export const unpackLocation = (packed: number): { x: number; y: number } => ({
  x: Math.floor(packed / 10000),
  y: packed % 10000,
});

/** Turns a list into the wire blob. */
export const encodeBookmarks = (bookmarks: Bookmark[]): Record<string, number | string> => {
  const capped = bookmarks.slice(0, MAX_BOOKMARKS);
  const blob: Record<string, number | string> = { mbms: capped.length };

  capped.forEach((bookmark, index) => {
    blob[`mbm${index}`] = packLocation(bookmark.x, bookmark.y);
    blob[`mbmn${index}`] = bookmark.name;
  });

  return blob;
};

/**
 * Reads the blob the login response carries.
 *
 * Tolerant on purpose: the field is stored unvalidated, is `{}` for a new
 * account, and older lists may be missing a name for an index. Anything that
 * does not parse as a location is skipped rather than failing the map.
 */
export const decodeBookmarks = (blob: unknown): Bookmark[] => {
  if (typeof blob !== "object" || blob === null) return [];
  const record = blob as Record<string, unknown>;

  const declared = Number(record["mbms"]);
  const count = Number.isFinite(declared)
    ? Math.min(Math.max(declared, 0), MAX_BOOKMARKS)
    : MAX_BOOKMARKS;

  const bookmarks: Bookmark[] = [];
  for (let index = 0; index < count; index++) {
    const packed = Number(record[`mbm${index}`]);
    if (!Number.isFinite(packed) || packed < 0) continue;

    const { x, y } = unpackLocation(packed);
    const name = record[`mbmn${index}`];
    bookmarks.push({
      x,
      y,
      name: typeof name === "string" && name !== "" ? name : `${x}, ${y}`,
    });
  }
  return bookmarks;
};

/** Trims and caps a name the way the original client did. */
export const normaliseBookmarkName = (name: string): string =>
  name.trim().slice(0, MAX_BOOKMARK_NAME_LENGTH);

/** Persists the whole list. There is no add or remove endpoint; this replaces it. */
export const saveBookmarks = async (bookmarks: Bookmark[]): Promise<void> => {
  await post<ApiEnvelope>(SAVE_PATH, {
    bookmarks: JSON.stringify(encodeBookmarks(bookmarks)),
  });
};
