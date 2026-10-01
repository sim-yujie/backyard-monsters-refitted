import { afterEach, describe, expect, test } from "bun:test";
import type { Context } from "koa";
import { devConfig } from "../../config/GameConfig.js";
import { signUpOptions } from "./signUpOptions.js";

/** `GET /player/signupoptions`: whether the sign-up form offers the test yard (issue #217). */

const run = async () => {
  const ctx = {} as Context;
  await signUpOptions(ctx, async () => {});
  return { status: ctx.status, body: ctx.body };
};

describe("signUpOptions", () => {
  const sandbox = devConfig.devSandbox;
  afterEach(() => {
    devConfig.devSandbox = sandbox;
  });

  test("offers the test yard while DEV_SANDBOX is on", async () => {
    devConfig.devSandbox = true;
    expect(await run()).toEqual({ status: 200, body: { sandboxStart: true } });
  });

  test("does not offer it otherwise, as on a production server", async () => {
    devConfig.devSandbox = false;
    expect(await run()).toEqual({ status: 200, body: { sandboxStart: false } });
  });
});
