import { describe, expect, test } from "bun:test";
import { ALLIANCE_DESC_MAX } from "../config/AllianceConfig.js";
import { CreateAllianceSchema, EditAllianceSchema } from "./AllianceSchemas.js";

/**
 * The About is one short line (owner, 12 Nov 2026): 120 letters on both the
 * Create and the Edit call. The column stays VARCHAR(255), so older, longer
 * Abouts still load; a new save must fit.
 */

const CREATE = { alliance_name: "Goo Farmers", alliance_image: 1 };
const EDIT = { alliance_image: 1 };

describe("the About limit", () => {
  test("is 120 letters", () => {
    expect(ALLIANCE_DESC_MAX).toBe(120);
  });

  for (const [name, schema, base] of [
    ["create", CreateAllianceSchema, CREATE],
    ["edit", EditAllianceSchema, EDIT],
  ] as const) {
    test(`${name} takes exactly 120 letters`, () => {
      expect(schema.safeParse({ ...base, alliance_desc: "x".repeat(120) }).success).toBe(true);
    });

    test(`${name} refuses 121 letters`, () => {
      expect(schema.safeParse({ ...base, alliance_desc: "x".repeat(121) }).success).toBe(false);
    });

    test(`${name} counts the About after trimming`, () => {
      expect(schema.safeParse({ ...base, alliance_desc: `  ${"x".repeat(120)}  ` }).success).toBe(true);
    });

    test(`${name} refuses an empty About`, () => {
      expect(schema.safeParse({ ...base, alliance_desc: "   " }).success).toBe(false);
    });
  }
});
