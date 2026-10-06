import { describe, expect, test } from "bun:test";
import z from "zod";
import { jsonField, optionalJsonField } from "./jsonField.js";

/**
 * A follow-up to issue #224: a schema field that parses JSON out of a text
 * field used to let a malformed value's `JSON.parse` throw straight out of
 * `Schema.parse` as a raw `SyntaxError`, which the global `ErrorInterceptor`
 * could only answer as an unhandled 500. Both helpers turn that into a
 * `ZodError` naming the field, like any other invalid value.
 */
describe("jsonField", () => {
  test("parses valid JSON", () => {
    const schema = z.object({ ids: jsonField("ids must be valid JSON") });
    expect(schema.parse({ ids: "[1,2,3]" }).ids).toEqual([1, 2, 3]);
  });

  test("malformed JSON is a ZodError naming the field, not a thrown SyntaxError", () => {
    const schema = z.object({ ids: jsonField("ids must be valid JSON") });

    expect(() => schema.parse({ ids: "{not json" })).toThrow();
    try {
      schema.parse({ ids: "{not json" });
      throw new Error("expected schema.parse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(z.ZodError);
      const zodErr = err as z.ZodError;
      expect(zodErr.issues[0]!.path).toEqual(["ids"]);
      expect(zodErr.issues[0]!.message).toBe("ids must be valid JSON");
    }
  });

  test("composes with .pipe() to validate the parsed shape", () => {
    const schema = z.object({
      ids: jsonField("ids must be a JSON array of ids").pipe(z.array(z.number()).min(1)),
    });

    expect(schema.parse({ ids: "[1,2]" }).ids).toEqual([1, 2]);
    expect(() => schema.parse({ ids: "[]" })).toThrow();
  });
});

describe("optionalJsonField", () => {
  test("a missing field reads as undefined", () => {
    const schema = z.object({ attackData: optionalJsonField("attackData") });
    expect(schema.parse({}).attackData).toBeUndefined();
  });

  test("an empty string reads as undefined, same as missing", () => {
    const schema = z.object({ attackData: optionalJsonField("attackData") });
    expect(schema.parse({ attackData: "" }).attackData).toBeUndefined();
  });

  test("parses valid JSON", () => {
    const schema = z.object({ attackData: optionalJsonField("attackData") });
    expect(schema.parse({ attackData: '{"monsters":[]}' }).attackData).toEqual({ monsters: [] });
  });

  test("malformed JSON is a ZodError naming the field, not a thrown SyntaxError", () => {
    const schema = z.object({ attackData: optionalJsonField("attackData") });

    try {
      schema.parse({ attackData: "{not json" });
      throw new Error("expected schema.parse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(z.ZodError);
      const zodErr = err as z.ZodError;
      expect(zodErr.issues[0]!.path).toEqual(["attackData"]);
      expect(zodErr.issues[0]!.message).toBe("attackData must be valid JSON");
    }
  });
});
