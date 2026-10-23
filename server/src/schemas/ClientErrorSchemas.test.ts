import { describe, expect, test } from "bun:test";

import { CLIENT_ERROR_LIMITS, ClientErrorsSchema } from "./ClientErrorSchemas.js";

describe("a batch of browser errors (ClientErrorSchemas.ts)", () => {
  test("reads a normal batch", () => {
    const body = ClientErrorsSchema.parse({
      errors: [{ kind: "rejection", message: " boom ", place: "/static/a.js:1:2", stack: "at x", count: 3 }],
      gameVersion: "2.0.0-beta.4",
      screen: "yard",
    });
    expect(body).toEqual({
      errors: [{ kind: "rejection", message: "boom", place: "/static/a.js:1:2", stack: "at x", count: 3 }],
      gameVersion: "2.0.0-beta.4",
      screen: "yard",
    });
  });

  test("takes the list as JSON text too (a JSON body's arrays arrive re-stringified)", () => {
    const body = ClientErrorsSchema.parse({ errors: JSON.stringify([{ message: "x" }]) });
    expect(body.errors).toEqual([{ kind: "error", message: "x", place: "", stack: "", count: 1 }]);
    expect(ClientErrorsSchema.parse({ errors: "not json" }).errors).toEqual([]);
  });

  test("never refuses: odd fields become empty, entries without a message are skipped", () => {
    const body = ClientErrorsSchema.parse({
      errors: [null, 5, { message: 7 }, { message: "" }, { message: "ok", place: {}, count: "lots" }],
      gameVersion: 12,
    });
    expect(body).toEqual({
      errors: [{ kind: "error", message: "ok", place: "", stack: "", count: 1 }],
      gameVersion: "",
      screen: "",
    });
    expect(ClientErrorsSchema.parse({}).errors).toEqual([]);
  });

  test("caps the batch, the counts and the lengths", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ message: `e${i}`, count: 10_000 }));
    const body = ClientErrorsSchema.parse({ errors: many, screen: "s".repeat(500) });
    expect(body.errors).toHaveLength(CLIENT_ERROR_LIMITS.batchMax);
    expect(body.errors.every((item) => item.count === CLIENT_ERROR_LIMITS.countMax)).toBe(true);
    expect(body.screen).toHaveLength(64);
    const long = ClientErrorsSchema.parse({ errors: [{ message: "m".repeat(5000), count: 0 }] }).errors[0]!;
    expect(long.message).toHaveLength(CLIENT_ERROR_LIMITS.messageMax);
    expect(long.count).toBe(1);
  });
});
