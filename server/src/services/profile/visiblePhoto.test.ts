import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { addPhotos, photoColumn, photoJoin, photoOf, visiblePhotoVersion, visiblePhotoWhere, visiblePhotos } from "./visiblePhoto.js";

/**
 * Whose uploaded photo other players see (owner, 13 Nov 2026): the one rule
 * every list uses. The rule against a real database, with the Profile
 * window, the photo's address and the friends lists side by side, is
 * `visiblePhoto.db.test.ts`.
 */

describe("visiblePhotoVersion", () => {
  const shown = { has_photo: true, photo_hidden: false, photo_version: 3, banned: false };

  test("a photo that is there, not hidden, of a player not banned, shows by its upload number", () => {
    expect(visiblePhotoVersion(shown)).toBe(3);
    expect(visiblePhotoVersion({ ...shown, photo_version: "7" })).toBe(7);
  });

  test("hidden by reports or waiting for review: the critter", () => {
    expect(visiblePhotoVersion({ ...shown, photo_hidden: true })).toBeNull();
  });

  test("removed or blocked by the owner (no photo left), or never uploaded: the critter", () => {
    expect(visiblePhotoVersion({ ...shown, has_photo: false })).toBeNull();
    expect(visiblePhotoVersion({ ...shown, has_photo: null })).toBeNull();
    expect(visiblePhotoVersion(null)).toBeNull();
    expect(visiblePhotoVersion(undefined)).toBeNull();
  });

  test("a banned player: the critter", () => {
    expect(visiblePhotoVersion({ ...shown, banned: true })).toBeNull();
  });
});

describe("the rule in SQL", () => {
  test("the same three tests", () => {
    expect(visiblePhotoWhere("p", "u")).toBe("p.photo IS NOT NULL AND p.photo_hidden = false AND u.banned = false");
  });

  test("the join and the column a list adds", () => {
    expect(photoJoin("cp", "u")).toBe("LEFT JOIN bym.player_profile cp ON cp.userid = u.userid");
    expect(photoColumn("cp", "u")).toBe(
      "CASE WHEN cp.photo IS NOT NULL AND cp.photo_hidden = false AND u.banned = false THEN cp.photo_version END AS photo",
    );
  });

  test("photoOf reads the column as a number or null", () => {
    expect(photoOf(4)).toBe(4);
    expect(photoOf("4")).toBe(4);
    expect(photoOf(null)).toBeNull();
    expect(photoOf(undefined)).toBeNull();
  });
});

/** An entity manager that records each query and answers `rows`. */
const fakeEm = (rows: { userid: number | string; photo_version: number | string }[]) => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const em = {
    execute: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return rows;
    },
  } as unknown as EntityManager;
  return { em, calls };
};

describe("visiblePhotos", () => {
  test("one query for the whole list, each player once, the rule in it", async () => {
    const { em, calls } = fakeEm([{ userid: "5", photo_version: "2" }]);
    const photos = await visiblePhotos(em, [5, 6, 5, 7]);
    expect(photos).toEqual(new Map([[5, 2]]));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual(["{5,6,7}"]);
    expect(calls[0]!.sql).toContain(visiblePhotoWhere("p", "u"));
  });

  test("no query for an empty list, or one of no players (tribes are 0)", async () => {
    const { em, calls } = fakeEm([]);
    expect(await visiblePhotos(em, [])).toEqual(new Map());
    expect(await visiblePhotos(em, [0, -1, Number.NaN])).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });
});

describe("addPhotos", () => {
  test("sets each row's photo, null for the critter", async () => {
    const { em, calls } = fakeEm([{ userid: 1, photo_version: 4 }]);
    const rows: { id: number; photo?: number | null }[] = [{ id: 1 }, { id: 2 }];
    await addPhotos(em, rows, (row) => row.id);
    expect(rows).toEqual([
      { id: 1, photo: 4 },
      { id: 2, photo: null },
    ]);
    expect(calls).toHaveLength(1);
  });
});
