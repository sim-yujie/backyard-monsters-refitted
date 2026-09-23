import { describe, expect, it } from "vitest";
import {
  MAX_BOOKMARKS,
  decodeBookmarks,
  encodeBookmarks,
  normaliseBookmarkName,
  packLocation,
  unpackLocation,
} from "./bookmarks";

describe("bookmark blob", () => {
  it("encodes to the flat mbm key-value shape the server stores", () => {
    expect(encodeBookmarks([{ x: 710, y: 347, name: "Home" }])).toEqual({
      mbms: 1,
      mbm0: 7100347,
      mbmn0: "Home",
    });
  });

  it("round trips through the wire shape", () => {
    const bookmarks = [
      { x: 710, y: 347, name: "Home" },
      { x: 0, y: 0, name: "Origin" },
      { x: 799, y: 799, name: "Far corner" },
    ];
    expect(decodeBookmarks(encodeBookmarks(bookmarks))).toEqual(bookmarks);
  });

  it("packs coordinates as x * 10000 + y", () => {
    expect(packLocation(710, 347)).toBe(7100347);
    expect(unpackLocation(7100347)).toEqual({ x: 710, y: 347 });
    expect(unpackLocation(packLocation(0, 799))).toEqual({ x: 0, y: 799 });
  });

  it("reads an empty account's blob as no bookmarks", () => {
    expect(decodeBookmarks({})).toEqual([]);
    expect(decodeBookmarks(null)).toEqual([]);
    expect(decodeBookmarks(undefined)).toEqual([]);
    expect(decodeBookmarks("nonsense")).toEqual([]);
  });

  it("caps the list at eight, as the original client did", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      x: index,
      y: index,
      name: `b${index}`,
    }));
    expect(encodeBookmarks(many)["mbms"]).toBe(MAX_BOOKMARKS);
    expect(decodeBookmarks(encodeBookmarks(many))).toHaveLength(MAX_BOOKMARKS);
  });

  it("falls back to the coordinates when a stored name is missing", () => {
    expect(decodeBookmarks({ mbms: 1, mbm0: 7100347 })).toEqual([
      { x: 710, y: 347, name: "710, 347" },
    ]);
  });

  it("skips entries whose location did not survive storage", () => {
    expect(decodeBookmarks({ mbms: 2, mbm0: "oops", mbm1: 10, mbmn1: "ok" })).toEqual([
      { x: 0, y: 10, name: "ok" },
    ]);
  });

  it("trims and truncates names", () => {
    expect(normaliseBookmarkName("  spaced  ")).toBe("spaced");
    expect(normaliseBookmarkName("a".repeat(40))).toHaveLength(20);
  });
});
