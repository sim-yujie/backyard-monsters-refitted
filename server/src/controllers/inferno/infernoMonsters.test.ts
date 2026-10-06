import { describe, expect, test } from "bun:test";
import z from "zod";
import { InfernoMonstersSchema } from "./infernoMonsters.js";

describe("InfernoMonstersSchema", () => {
  test("a missing imonsters reads as {}", () => {
    expect(InfernoMonstersSchema.parse({ type: "get" }).imonsters).toEqual({});
  });

  test("parses a sent imonsters", () => {
    expect(InfernoMonstersSchema.parse({ type: "set", imonsters: '{"IC1":2}' }).imonsters).toEqual({
      IC1: 2,
    });
  });

  test("malformed JSON is a 400-shaped ZodError, not a thrown SyntaxError (#224 follow-up)", () => {
    try {
      InfernoMonstersSchema.parse({ type: "set", imonsters: "{not valid json" });
      throw new Error("expected schema.parse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(z.ZodError);
      expect((err as z.ZodError).issues[0]!.path).toEqual(["imonsters"]);
    }
  });
});
