import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Only the language files that exist are read; a request for any other name
 * (live logs showed `en.json`) is a 404, not a logged server error.
 */

const error = mock((..._args: unknown[]) => {});
mock.module("../utils/logger.js", () => ({
  logger: { debug: mock(() => {}), error, warn: mock(() => {}), info: mock(() => {}) },
}));

const { processLanguagesFile } = await import("./processLanguageFile.js");

const request = async (path: string) => {
  const ctx = { path, status: 0, body: undefined as unknown, type: "" };
  const next = mock(async () => {});
  await processLanguagesFile(ctx as never, next);
  return { ctx, next };
};

beforeEach(() => error.mockClear());

describe("processLanguagesFile", () => {
  test("serves english.json", async () => {
    const { ctx } = await request("/gamestage/assets/english.json");
    expect(ctx.status).toBe(200);
    expect(ctx.type).toBe("application/json");
    expect(JSON.parse(ctx.body as string)).toBeObject();
  });

  test("an unknown language is a 404 and is not logged", async () => {
    const { ctx } = await request("/gamestage/assets/en.json");
    expect(ctx.status).toBe(404);
    expect(error).not.toHaveBeenCalled();
  });

  test("other paths pass through", async () => {
    const { next } = await request("/gamestage/assets/sprites.png");
    expect(next).toHaveBeenCalled();
  });
});
