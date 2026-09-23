import { describe, expect, test } from "bun:test";
import type { Save } from "../../../database/models/save.model.js";
import { emptyAreaResponse, hasWorldPlacement } from "./emptyAreaResponse.js";

/**
 * hasWorldPlacement only ever reads `worldid` off the save, so a plain object
 * standing in for the entity is enough and keeps the test out of the database.
 */
const saveWith = (worldid: string | null | undefined): Save => ({ worldid }) as unknown as Save;

describe("hasWorldPlacement", () => {
  test("false when there is no Save row at all (brand-new account)", () => {
    expect(hasWorldPlacement(null)).toBe(false);
    expect(hasWorldPlacement(undefined)).toBe(false);
  });

  test("false when the Save exists but has never joined a world", () => {
    expect(hasWorldPlacement(saveWith(null))).toBe(false);
    expect(hasWorldPlacement(saveWith(undefined))).toBe(false);
  });

  test("false for an empty string worldid", () => {
    expect(hasWorldPlacement(saveWith(""))).toBe(false);
  });

  test("true once the save carries a world id", () => {
    expect(hasWorldPlacement(saveWith("3cff3884-uuid"))).toBe(true);
  });
});

describe("emptyAreaResponse", () => {
  test("shapes a getarea-compatible response with no cells and no alliances", () => {
    expect(emptyAreaResponse(120, 340)).toEqual({
      error: 0,
      x: 120,
      y: 340,
      data: {},
      alliancedata: [],
    });
  });

  test("echoes back whatever coordinates were requested", () => {
    const response = emptyAreaResponse(0, 799);
    expect(response.x).toBe(0);
    expect(response.y).toBe(799);
  });
});
