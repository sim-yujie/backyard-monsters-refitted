import { describe, expect, test } from "bun:test";
import type { Context } from "koa";
import type { Save } from "../../../../database/models/save.model.js";
import { academyHandler } from "./academyHandler.js";
import { ClientSafeError } from "../../../../middleware/clientSafeError.js";

/** The save handler clamps each reported level to what the monster catalogue allows. */
const run = (academy: object) => {
  const save = {} as Save;
  academyHandler({ request: { body: { academy: JSON.stringify(academy) } } } as unknown as Context, save);
  return save.academy;
};

describe("academyHandler", () => {
  test("clamps to the monster's own top level", () => {
    expect(run({ C1: { level: 9 }, C15: { level: 6 }, C2: { level: 4, powerup: 2 } })).toEqual({
      C1: { level: 6 },
      C15: { level: 5 },
      C2: { level: 4, powerup: 2 },
    });
  });

  test("an id the catalogue does not hold (Inferno) is clamped to 6", () => {
    expect(run({ IC1: { level: 8 }, IC2: { level: 3 } })).toEqual({ IC1: { level: 6 }, IC2: { level: 3 } });
  });

  test("malformed JSON is a 400 ClientSafeError, not an uncaught SyntaxError (#224 follow-up)", () => {
    const save = {} as Save;
    const call = () =>
      academyHandler(
        { request: { body: { academy: "{not valid json" } } } as unknown as Context,
        save
      );

    expect(call).toThrow(ClientSafeError);
    try {
      call();
      throw new Error("expected academyHandler to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ClientSafeError);
      const safeErr = err as ClientSafeError;
      expect(safeErr.status).toBe(400);
      expect(safeErr.data).toEqual({ reason: "invalidRequest", field: "academy" });
    }
  });
});
