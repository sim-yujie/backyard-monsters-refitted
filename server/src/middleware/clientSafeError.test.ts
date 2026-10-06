import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The global ErrorInterceptor sends an unexpected error's stack to the client
 * only off production (issue #213): on production the stack (file paths,
 * library versions) stays in the server's log.
 */

mock.module("../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { ClientSafeError, ErrorInterceptor } = await import("./clientSafeError.js");
const { BaseLoadSchema } = await import("../schemas/BaseLoadSchema.js");

interface Body {
  error: string;
  errorDetails: { internalInfo?: string; message: string; status: number; data: Record<string, unknown> };
}

let savedEnv: string | undefined;
let savedConsoleError: typeof console.error;

const failWith = async (thrown: unknown) => {
  const ctx = { method: "POST", path: "/api/v1/player/register" } as unknown as Context & { body: Body };
  await ErrorInterceptor(ctx, async () => {
    throw thrown;
  });
  return ctx;
};

beforeEach(() => {
  savedEnv = process.env.ENV;
  savedConsoleError = console.error;
  console.error = () => {};
});

afterEach(() => {
  console.error = savedConsoleError;
  if (savedEnv === undefined) delete process.env.ENV;
  else process.env.ENV = savedEnv;
});

describe("ErrorInterceptor", () => {
  test("on production an unexpected error reaches the client with no stack", async () => {
    process.env.ENV = "production";
    const ctx = await failWith(new Error("secret internals at /srv/app/src/thing.ts"));

    expect(ctx.status).toBe(500);
    expect(ctx.body.errorDetails.internalInfo).toBeUndefined();
    expect(JSON.stringify(ctx.body)).not.toContain("/srv/app");
    expect(ctx.body.error).toBe("Something went wrong, please contact support.");
  });

  test("off production the stack still comes back, for debugging", async () => {
    process.env.ENV = "local";
    const ctx = await failWith(new Error("local detail"));
    expect(ctx.body.errorDetails.internalInfo).toContain("local detail");
  });

  test("a ClientSafeError carrying an internal error hides it on production too", async () => {
    process.env.ENV = "production";
    const refusal = new ClientSafeError({
      message: "Nope.",
      status: 409,
      data: {},
      internalInfo: new Error("internal detail"),
      isClientFriendly: true,
    });
    expect(refusal.toSafeJson().internalInfo).toBeUndefined();

    const ctx = await failWith(refusal);
    expect(ctx.status).toBe(409);
    expect(ctx.body.errorDetails.internalInfo).toBeUndefined();
  });
});

describe("a request body that fails its route's schema (#224)", () => {
  const schemaError = (body: unknown): unknown => {
    try {
      BaseLoadSchema.parse(body);
    } catch (err) {
      return err;
    }
    throw new Error("the body passed the schema");
  };

  test("answers 400 naming the field, not 500", async () => {
    const ctx = await failWith(schemaError({ userid: "1", type: "build" }));

    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toStartWith("Invalid request: baseid: ");
    expect(ctx.body.errorDetails.data).toEqual({ reason: "invalidRequest", field: "baseid" });
  });

  test("names whichever field is wrong", async () => {
    const ctx = await failWith(schemaError({ userid: "1", baseid: "1", type: "build", attackData: 5 }));

    expect(ctx.status).toBe(400);
    expect(ctx.body.errorDetails.data.field).toBe("attackData");
  });

  test("any other unexpected error is still a 500", async () => {
    const ctx = await failWith(new TypeError("boom"));
    expect(ctx.status).toBe(500);
  });
});
