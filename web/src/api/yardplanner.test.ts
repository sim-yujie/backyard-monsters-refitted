import { describe, expect, it } from "vitest";
import { ApiError } from "./http";
import { applyConflictIds, MAX_LAYOUT_NAME_LENGTH, normaliseLayoutName } from "./yardplanner";

/** A rejection as the server sends it: a flat body, no `errorDetails`. */
const rejection = (status: number, body: Record<string, unknown>): ApiError =>
  new ApiError(String(body["error"] ?? "failed"), { status, body });

describe("applyConflictIds", () => {
  it("reads the 409 unplaced list", () => {
    const caught = rejection(409, { error: "Some buildings are missing", unplaced: [32, 33] });
    expect(applyConflictIds(caught)).toEqual([32, 33]);
  });

  it("reads the 400 overlapping list", () => {
    const caught = rejection(400, { error: "Two buildings overlap", overlapping: [7, 9] });
    expect(applyConflictIds(caught)).toEqual([7, 9]);
  });

  it("reads the 400 unknown list", () => {
    expect(applyConflictIds(rejection(400, { error: "No such building", unknown: [404] }))).toEqual([
      404,
    ]);
  });

  it("merges several lists and drops duplicates", () => {
    const caught = rejection(400, { error: "Bad layout", overlapping: [1, 2], unknown: [2, 3] });
    expect(applyConflictIds(caught).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("still reads a body nested under errorDetails", () => {
    const caught = new ApiError("Bad layout", {
      status: 400,
      details: { status: 400, data: { overlapping: [5] } },
    });
    expect(applyConflictIds(caught)).toEqual([5]);
  });

  it("is empty when the server named nothing", () => {
    expect(applyConflictIds(rejection(400, { error: "Bad layout" }))).toEqual([]);
    expect(applyConflictIds(rejection(400, {}))).toEqual([]);
  });

  it("ignores anything that is not a number", () => {
    const caught = rejection(409, { error: "x", unplaced: ["32", null, 33, {}] });
    expect(applyConflictIds(caught)).toEqual([33]);
  });

  it("tolerates a body that is a bare string or missing", () => {
    expect(applyConflictIds(new ApiError("down", { status: 500, body: "Server Error" }))).toEqual(
      [],
    );
    expect(applyConflictIds(new ApiError("down", { status: 500 }))).toEqual([]);
  });

  it("returns nothing for a failure that is not an ApiError", () => {
    expect(applyConflictIds(new Error("offline"))).toEqual([]);
    expect(applyConflictIds(null)).toEqual([]);
  });
});

describe("normaliseLayoutName", () => {
  it("trims surrounding space", () => {
    expect(normaliseLayoutName("  Turtle v3  ")).toBe("Turtle v3");
  });

  it("cuts to the maximum length", () => {
    const long = "x".repeat(MAX_LAYOUT_NAME_LENGTH + 10);
    expect(normaliseLayoutName(long)).toHaveLength(MAX_LAYOUT_NAME_LENGTH);
  });

  it("trims before cutting, so trailing space does not eat the limit", () => {
    expect(normaliseLayoutName(`  ${"a".repeat(MAX_LAYOUT_NAME_LENGTH)}  `)).toHaveLength(
      MAX_LAYOUT_NAME_LENGTH,
    );
  });

  it("leaves an empty name empty for the caller to default", () => {
    expect(normaliseLayoutName("   ")).toBe("");
  });
});
